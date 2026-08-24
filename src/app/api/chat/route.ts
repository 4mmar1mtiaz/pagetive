import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { parseJson, toJson } from "@/lib/json";
import { client, MODEL, priceOf, recordUsage } from "@/lib/llm";
import { countMessage, resolveKey } from "@/lib/byok";
import { systemPrompt } from "@/lib/prompt";
import { runTool, TOOLS } from "@/lib/tools";
import { currentSession } from "@/lib/account";

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
  const body = (await req.json().catch(() => ({}))) as { chatId?: string; message?: string };
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

  const chat = body.chatId
    ? await prisma.chat.findUnique({ where: { id: body.chatId } })
    : await prisma.chat.create({ data: { title: text.slice(0, 60), ownerId: session.accountId } });
  if (!chat || chat.ownerId !== session.accountId) {
    return new Response("Unknown chat", { status: 404 });
  }

  const history = await prisma.message.findMany({
    where: { chatId: chat.id },
    orderBy: { createdAt: "asc" },
  });

  await prisma.message.create({ data: { chatId: chat.id, role: "user", content: text } });

  const messages: Anthropic.MessageParam[] = [
    ...toMessages(history as Stored[]),
    { role: "user", content: text },
  ];

  const appUrl = process.env.APP_URL || "http://localhost:4400";
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

        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const run = anthropic.messages.stream({
            model: MODEL,
            max_tokens: 32000,
            system: systemPrompt(appUrl) + planNote,
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
