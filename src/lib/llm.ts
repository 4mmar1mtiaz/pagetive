import Anthropic from "@anthropic-ai/sdk";

/**
 * The single place this app talks to Anthropic.
 *
 * No key means an error, not a mock. A fake page that looks plausible is worse
 * than an outage here, because it gets published to a real domain and starts
 * receiving real ad traffic before anyone notices it is nonsense.
 */

export const MODEL = "claude-opus-5";

/** USD per million tokens. Cache reads bill at ~0.1x, writes at ~1.25x. */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export function priceOf(model: string, usage: Usage): number {
  // An unrecognised model is a config mistake, not a free one. Bill it at the
  // most expensive known rate so a budget check still fires.
  const rate = PRICING[model] ?? { input: 5, output: 25 };
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return (
    (usage.input_tokens / 1_000_000) * rate.input +
    (cacheRead / 1_000_000) * rate.input * 0.1 +
    (cacheWrite / 1_000_000) * rate.input * 1.25 +
    (usage.output_tokens / 1_000_000) * rate.output
  );
}

/** Write one spend row. Never throws — a failed accounting write must not kill
 *  a page build that already succeeded. */
export async function recordUsage(args: {
  kind: "chat" | "variants" | "import";
  usage: Usage;
  chatId?: string | null;
  pageId?: string | null;
  accountId?: string | null;
}): Promise<void> {
  try {
    const { prisma } = await import("@/lib/db");
    await prisma.usage.create({
      data: {
        kind: args.kind,
        model: MODEL,
        accountId: args.accountId ?? null,
        chatId: args.chatId ?? null,
        pageId: args.pageId ?? null,
        inputTokens: args.usage.input_tokens,
        outputTokens: args.usage.output_tokens,
        cacheRead: args.usage.cache_read_input_tokens ?? 0,
        cacheWrite: args.usage.cache_creation_input_tokens ?? 0,
        costUsd: priceOf(MODEL, args.usage),
      },
    });
  } catch {
    /* accounting is not worth failing a build over */
  }
}

/**
 * A client for a specific key.
 *
 * Takes the key rather than reading the environment, because whose key pays for
 * a turn is now a per-account decision (see src/lib/byok.ts). Passing it in
 * keeps that decision in one place instead of scattering env reads through the
 * call sites.
 */
export function client(apiKey?: string): Anthropic {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "No Anthropic API key available. Add one in settings, or set ANTHROPIC_API_KEY — there is no mock fallback.",
    );
  }
  return new Anthropic({ apiKey: key });
}

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** One JSON-constrained call. Streams because page-sized output plus thinking
 *  routinely runs long enough to risk an HTTP timeout on a plain request. */
export async function structured<T>(opts: {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Spend attribution. Omitted only where there is nothing to attribute to. */
  kind?: "variants" | "import";
  pageId?: string | null;
  accountId?: string | null;
  /** Whose key pays. Falls back to the environment when omitted. */
  apiKey?: string;
}): Promise<T> {
  const stream = client(opts.apiKey).messages.stream({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 32000,
    system: opts.system,
    thinking: { type: "adaptive" },
    output_config: {
      effort: opts.effort ?? "high",
      format: { type: "json_schema", schema: opts.schema },
    },
    messages: [{ role: "user", content: opts.prompt }],
  });

  const msg = await stream.finalMessage();

  if (msg.stop_reason === "refusal") {
    throw new Error(`Anthropic declined the request (${msg.stop_details?.category ?? "unknown"}).`);
  }
  if (msg.stop_reason === "max_tokens") {
    // Truncated JSON is unparseable; say why rather than throwing a SyntaxError
    // three frames down.
    throw new Error(`Response hit max_tokens before finishing. Raise maxTokens for this call.`);
  }

  await recordUsage({
    kind: opts.kind ?? "variants",
    usage: msg.usage,
    pageId: opts.pageId,
    accountId: opts.accountId,
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return JSON.parse(text) as T;
}
