import { NextResponse } from "next/server";
import { clearSimulation, simulateTraffic } from "@/lib/simulate";
import { assertOwns, currentSession } from "@/lib/account";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  // Capped: past a few thousand rows SQLite is doing more work than the answer
  // is worth, and the bandit has long since resolved.
  const visitors = Math.min(5000, Math.max(10, Number(body.visitors ?? 500)));
  const days = Math.min(90, Math.max(1, Number(body.days ?? 14)));
  try {
    const session = await currentSession();
    await assertOwns(session.accountId, id);
    if (!session.ents.canSimulate) {
      return NextResponse.json({ error: "Not available on this plan." }, { status: 402 });
    }
    return NextResponse.json(await simulateTraffic(id, visitors, days));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const session = await currentSession();
  await assertOwns(session.accountId, id);
  const removed = await clearSimulation(id);
  return NextResponse.json({ ok: true, removed });
}
