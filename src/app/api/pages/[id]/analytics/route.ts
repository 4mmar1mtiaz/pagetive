import { NextResponse } from "next/server";
import { pageAnalytics } from "@/lib/analytics";
import { currentSession } from "@/lib/account";
import { assertCanView } from "@/lib/share";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const variantId = new URL(req.url).searchParams.get("variant");
  try {
    const session = await currentSession();
    // Read, so a viewer the page was shared with is allowed. Everything that
    // writes still goes through the owner-only check.
    await assertCanView(session.accountId, id);
    return NextResponse.json(await pageAnalytics(id, variantId));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }
}
