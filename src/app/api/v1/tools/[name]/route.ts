import { NextResponse } from "next/server";
import { runTool, TOOLS } from "@/lib/tools";
import { countMessage, resolveKey } from "@/lib/byok";
import { rateLimit } from "@/lib/ratelimit";
import { absolutize, authenticateAgent, GENERATING_TOOLS } from "@/lib/agent-api";

/**
 * Run one builder tool as the account the presented key belongs to.
 *
 * This is the chat agent's tool layer (src/lib/tools.ts) exposed over HTTP, not
 * a second implementation of it. Ownership scoping, plan limits and input
 * normalisation all happen inside runTool exactly as they do for the chat, so
 * an external agent can do precisely what the in-app agent can and nothing
 * more.
 */

export const dynamic = "force-dynamic";
// create_page runs an editor pass and import_page reads a whole site; both
// are model calls that can take a minute.
export const maxDuration = 300;

const KNOWN = new Set(TOOLS.map((t) => t.name));

type Ctx = { params: Promise<{ name: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const auth = await authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { name } = await params;
  if (!KNOWN.has(name)) {
    return NextResponse.json({ error: `Unknown tool "${name}". GET /api/v1 lists them.` }, { status: 404 });
  }

  // Per account rather than per address: the key is the identity here, and a
  // runaway agent loop is the thing this is guarding against.
  const limited = rateLimit(`agent:${auth.accountId}`, 60, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: `Rate limited. Try again in ${limited.retryIn}s.` },
      { status: 429, headers: { "retry-after": String(limited.retryIn) } },
    );
  }

  const body = await req.json().catch(() => null);
  if (body !== null && (typeof body !== "object" || Array.isArray(body))) {
    return NextResponse.json({ error: "Body must be a JSON object of the tool's input." }, { status: 400 });
  }
  const input = (body ?? {}) as Record<string, unknown>;

  // Only the generating tools need a model key, and only they are metered.
  // Same rule as the chat: turns on the operator's key count, an account's own
  // key is unmetered.
  let apiKey: string | undefined;
  let ownKey = true;
  if (GENERATING_TOOLS.has(name)) {
    const key = await resolveKey(auth.accountId);
    if (!key.ok) return NextResponse.json({ error: key.reason }, { status: 402 });
    apiKey = key.apiKey;
    ownKey = key.own;
  }

  const result = await runTool(name, input, { accountId: auth.accountId, ents: auth.ents, apiKey });
  const failed = typeof (result as { error?: unknown }).error === "string";
  if (GENERATING_TOOLS.has(name) && !failed) await countMessage(auth.accountId, ownKey);

  return NextResponse.json(absolutize(result), { status: failed ? 422 : 200 });
}
