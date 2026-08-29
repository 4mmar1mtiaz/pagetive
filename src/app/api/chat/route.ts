import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { parseJson, toJson } from "@/lib/json";
import { client, MODEL, priceOf, recordUsage } from "@/lib/llm";
import { countMessage, resolveKey } from "@/lib/byok";
import { systemPrompt } from "@/lib/prompt";
import { runTool, TOOLS } from "@/lib/tools";
import { currentSession } from "@/lib/account";
import { appUrl as resolvedAppUrl } from "@/lib/hosts";

/**
 * The chat endpoint — the whole interface, really.
 *
 * Streams Server-Sent Events rather than returning a finished reply, because a
 * single turn here can build a page, generate four variants and publish: that
 * is a minute of model time, and a spinner for a minute reads as broken. The
 * client sees the text as it is written and each tool call as it fires.
 *
 * The loop is written out rather than using the SDK's tool runner so that every
 * tool call can be narrated to the UI and persisted as it happens. A turn that
 * dies halfway still leaves the completed work in the database.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** A page build is 2-4 tool calls; anything past this is a loop, not work. */
const MAX_TURNS = 14;

type Stored = { role: "user" | "assistant"; content: string };

function toMessages(rows: Stored[]): Anthropic.MessageParam[] {
  return rows.map((r) => {
    const parsed = parseJson<unknown>(r.content, null);
    return {
      role: r.role,
      // Older rows and plain user turns are stored as a bare string; tool
      // results and assistant turns are stored as content-block arrays.
      content: (Array.isArray(parsed) ? parsed : r.content) as Anthropic.MessageParam["content"],
    };
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    chatId?: string;
    message?: string;
    pageId?: string | null;
    assetIds?: string[];
  };
  const text = (body.message ?? "").trim();
  if (!text) return new Response("Nothing to say", { status: 400 });

  const session = await currentSession();

  if (session.suspended) {
    return new Response(
      `data: ${JSON.stringify({
        type: "error",
        message: "This account is suspended. Your pages are untouched — contact support to reactivate.",
      })}\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
  }

  // Whose key pays for this turn, and whether they have any turns left.
  const key = await resolveKey(session.accountId);
  if (!key.ok) {
    return new Response(
      `data: ${JSON.stringify({ type: "needs_key", message: key.reason, used: key.used, limit: key.limit })}\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
  }

  // A thread belongs to a page. The client sends whichever page is selected in
  // the rail, and that is what this turn operates on — the agent no longer has
  // to guess which of someone's pages "the page" means.
  const selectedPageId = body.pageId ?? null;

  const chat = body.chatId
    ? await prisma.chat.findUnique({ where: { id: body.chatId } })
    : await prisma.chat.create({
        data: { title: text.slice(0, 60), ownerId: session.accountId, pageId: selectedPageId },
      });
  if (!chat || chat.ownerId !== session.accountId) {
    return new Response("Unknown chat", { status: 404 });
  }

  // An existing thread follows the selection. Reopening an old thread against a
  // different page is a legitimate thing to do, and silently keeping the old
  // binding would send the edits to the wrong page.
  if (selectedPageId && chat.pageId !== selectedPageId) {
    chat.pageId = selectedPageId;
    await prisma.chat.update({ where: { id: chat.id }, data: { pageId: selectedPageId } });
  }

  // Media attached to this turn. Scoped by owner for the same reason pages are:
  // an id in a request body is a claim, not a permission.
  const attached = Array.isArray(body.assetIds) && body.assetIds.length
    ? await prisma.asset.findMany({
        where: { id: { in: body.assetIds.slice(0, 20) }, ownerId: session.accountId },
        orderBy: { createdAt: "asc" },
      })
    : [];

  // Only pages this account owns. A stale or forged id must not widen access.
  const selectedPage = chat.pageId
    ? await prisma.page.findFirst({
        where: { id: chat.pageId, ownerId: session.accountId },
        select: { id: true, name: true, slug: true, status: true },
      })
    : null;

  const history = await prisma.message.findMany({
    where: { chatId: chat.id },
    orderBy: { createdAt: "asc" },
  });

  await prisma.message.create({ data: { chatId: chat.id, role: "user", content: text } });

  const messages: Anthropic.MessageParam[] = [
    ...toMessages(history as Stored[]),
    { role: "user", content: text },
  ];

  const appUrl = resolvedAppUrl();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      send({ type: "chat", chatId: chat.id });
      let spent = 0;

      try {
        const anthropic = client(key.apiKey);
        // The plan is stated in the prompt so the agent stops before hitting a
        // limit and explains it, rather than calling a tool and relaying an
        // error it did not see coming.
        const planNote = session.ents.maxPages
          ? `\n\nThis user is on the ${session.ents.label}: ${session.ents.maxPages} landing page total, and they cannot publish, export, or attach a domain. Build freely — everything else works, including variants, simulated traffic and the heatmap. If they ask to go live or download, say plainly that it needs the unlimited plan; do not apologise repeatedly or pitch.`
          : "";

        // Which page this turn is about, stated rather than inferred. Without
        // it the agent calls list_pages and picks, which is how an edit meant
        // for one page lands on another.
        const pageNote = selectedPage
          ? `\n\nThe user has "${selectedPage.name}" selected (pageId ${selectedPage.id}, slug ${selectedPage.slug}, ${selectedPage.status}). Every page tool this turn takes that pageId unless they name a different page outright. Do not call list_pages to work out which page they mean, and do not create a new page when they ask to change something — they are looking at this one.`
          : `\n\nNo page is selected. The user is starting something new, so build rather than edit: ask for their website and their offer in one message, call read_brand, then create_page. Do not go hunting through their existing pages.`;

        // Attached media, given as URLs the blocks can use directly. The
        // description is the user's own words about what each file is for, and
        // it is the only thing that lets a file be placed correctly without
        // asking them where it goes.
        const mediaNote = attached.length
          ? `\n\nThe user attached ${attached.length} file${attached.length === 1 ? "" : "s"} to this message. Use ${attached.length === 1 ? "it" : "them"} on the page — a hero image goes on the hero block as imageUrl, a logo row goes on logos items as imageUrl, and anything standing on its own goes in a media block with mediaUrl and mediaKind. Set alt from the description. Use these URLs exactly as written; do not invent, shorten or re-host them, and never use a stock photo URL instead.\n\n${attached
              .map(
                (a) =>
                  `- ${a.kind} ${a.url}\n  filename: ${a.name}\n  what it is for: ${a.description || "(not said — place it where it fits and say where you put it)"}`,
              )
              .join("\n")}`
          : "";

        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const run = anthropic.messages.stream({
            model: MODEL,
            max_tokens: 32000,
            system: systemPrompt(appUrl) + planNote + pageNote + mediaNote,
            thinking: { type: "adaptive" },
            output_config: { effort: "high" },
            tools: TOOLS,
            messages,
          });

          run.on("text", (delta) => send({ type: "text", text: delta }));

          const msg = await run.finalMessage();

          if (msg.stop_reason === "refusal") {
            send({ type: "error", message: "Anthropic declined that request." });
            break;
          }

          await recordUsage({
            kind: "chat",
            usage: msg.usage,
            chatId: chat.id,
            accountId: session.accountId,
          });
          // One assistant turn spent. Only metered on the shared key.
          await countMessage(session.accountId, key.own);
          spent += priceOf(MODEL, msg.usage);
          send({ type: "cost", usd: Number(spent.toFixed(4)) });

          messages.push({ role: "assistant", content: msg.content });
          await prisma.message.create({
            data: { chatId: chat.id, role: "assistant", content: toJson(msg.content) },
          });

          const calls = msg.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );
          if (calls.length === 0) break;

          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const call of calls) {
            send({ type: "tool", name: call.name, input: call.input });
            const result = await runTool(call.name, call.input as Record<string, unknown>, {
              accountId: session.accountId,
              ents: session.ents,
              apiKey: key.apiKey,
            });
            send({ type: "tool_done", name: call.name, result });

            // First page this thread touches becomes the thread's page, so the
            // rail can reopen the conversation that built it.
            const producedId = (result as { pageId?: unknown }).pageId;
            if (!chat.pageId && typeof producedId === "string") {
              chat.pageId = producedId;
              await prisma.chat.update({ where: { id: chat.id }, data: { pageId: producedId } });
            }
            results.push({
              type: "tool_result",
              tool_use_id: call.id,
              content: JSON.stringify(result),
              is_error: Boolean((result as { error?: string }).error),
            });
          }

          // Every result goes back in one user message. Splitting them teaches
          // the model to stop making parallel calls.
          messages.push({ role: "user", content: results });
          await prisma.message.create({
            data: { chatId: chat.id, role: "user", content: toJson(results) },
          });
        }

        await prisma.chat.update({ where: { id: chat.id }, data: { updatedAt: new Date() } });
        send({
          type: "done",
          // So the UI can warn before the wall rather than at it.
          freeRemaining: key.own ? null : Math.max(0, (key.remaining ?? 0) - 1),
        });
      } catch (err) {
        send({ type: "error", message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
