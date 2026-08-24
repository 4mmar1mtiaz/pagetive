import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/account";

/**
 * Change one account.
 *
 * Deleting is not offered here. It would cascade through every page, lead and
 * event the customer has, and the recoverable version of "make this stop" is
 * suspension — which this does support. Anything truly destructive should be a
 * deliberate act in the database, not a button next to a dropdown.
 */

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const data: Record<string, unknown> = {};
    if (body.plan === "trial" || body.plan === "unlimited") data.plan = body.plan;
    if (typeof body.suspended === "boolean") data.suspended = body.suspended;
    if (typeof body.note === "string") data.note = body.note.slice(0, 500);
    if (body.maxPages === null || body.maxPages === "") data.maxPages = null;
    else if (body.maxPages !== undefined) {
      const n = Number(body.maxPages);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: "maxPages must be a number, or blank for the plan default." }, { status: 400 });
      }
      data.maxPages = Math.floor(n);
    }
    // Resetting the lifetime counter is how you hand somebody their trial back.
    if (body.resetPageCount === true) data.pagesCreated = 0;

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    }

    // An admin locking themselves out is a support call to nobody.
    if (data.suspended === true && id === admin.accountId) {
      return NextResponse.json({ error: "You cannot suspend your own account." }, { status: 400 });
    }

    const account = await prisma.account.update({ where: { id }, data });
    return NextResponse.json({ ok: true, account });
  } catch (err) {
    const message = (err as Error).message;
    return NextResponse.json({ error: message }, { status: message === "Not found" ? 404 : 500 });
  }
}
