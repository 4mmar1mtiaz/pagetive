import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { currentSession } from "@/lib/account";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

type Block = { type: string; text?: string; name?: string; input?: unknown };

/**
 * Replay a stored thread for the UI.
 *
 * The database holds raw Anthropic content blocks — thinking, tool_use,
 * tool_result — because that is what has to go back to the model verbatim on
 * the next turn. The UI wants something much simpler, so the flattening happens
 * here rather than teaching the client about the API's content model.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const session = await currentSession();
  const chat = await prisma.chat.findUnique({ where: { id }, select: { ownerId: true } });
  if (!chat || chat.ownerId !== session.accountId) {
    return NextResponse.json({ messages: [] }, { status: 404 });
  }
  const rows = await prisma.message.findMany({ where: { chatId: id }, orderBy: { createdAt: "asc" } });

  const items: { role: "user" | "assistant"; text: string; tools: string[] }[] = [];
  for (const row of rows) {
    const parsed = parseJson<Block[] | null>(row.content, null);
    if (!Array.isArray(parsed)) {
      items.push({ role: row.role as "user", text: row.content, tools: [] });
      continue;
    }
    // A user row holding blocks is a tool-result payload — machine traffic, not
    // something a person typed. Skip it.
    if (row.role === "user") continue;

    const text = parsed
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    const tools = parsed.filter((b) => b.type === "tool_use").map((b) => b.name ?? "tool");
    if (text || tools.length) items.push({ role: "assistant", text, tools });
  }

  return NextResponse.json({ messages: items });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const session = await currentSession();
  const chat = await prisma.chat.findUnique({ where: { id }, select: { ownerId: true } });
  if (!chat || chat.ownerId !== session.accountId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await prisma.chat.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
