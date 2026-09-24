import { NextResponse } from "next/server";
import { TOOLS } from "@/lib/tools";
import { systemPrompt } from "@/lib/prompt";
import { appUrl } from "@/lib/hosts";
import { authenticateAgent } from "@/lib/agent-api";

/**
 * Discovery for external agents.
 *
 * Returns everything an agent needs to build pages without reading this
 * codebase: the tool list with JSON schemas (the same TOOLS the chat agent is
 * given, so the two never drift), the builder brief with the block reference,
 * and how to call them. Behind the key like everything else under /api/v1.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authenticateAgent(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const base = appUrl();
  return NextResponse.json({
    usage: {
      call: `POST ${base}/api/v1/tools/{name} with the tool's input as the JSON body`,
      auth: "Authorization: Bearer <your API key> (or x-api-key: <your API key>)",
      result:
        "200 with the tool's result object on success. A tool that refuses (bad id, plan limit, bad input) returns 422 with { error } - read it and adjust, as the chat agent would.",
      flow: "read_brand on their website -> create_page with the full block array and brandUrl -> review previewUrl -> publish_page when told to.",
    },
    plan: auth.ents.label,
    tools: TOOLS,
    guide: systemPrompt(base),
  });
}
