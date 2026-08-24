import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Move an account between plans from outside the app.
 *
 * Payment does not happen in here, and deliberately so — the checkout, the
 * invoice and the dunning all live wherever you already collect money. This
 * endpoint is the one line that has to connect them: your payment processor,
 * GHL, Zapier, or you by hand, POSTs an email and a plan.
 *
 * It works before the person has ever signed in. An email with no matching
 * Clerk user creates a pending row, and the first sign-in with that address
 * claims it — so somebody who pays and then registers lands on the plan they
 * bought instead of a trial and a support ticket.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.PLAN_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "PLAN_WEBHOOK_SECRET is not set, so this endpoint is disabled." },
      { status: 503 },
    );
  }
  // Compared in full rather than by prefix, and the endpoint says nothing about
  // which part was wrong.
  if (req.headers.get("x-plan-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { email?: string; plan?: string };
  const email = body.email?.trim().toLowerCase();
  const plan = body.plan === "unlimited" ? "unlimited" : "trial";
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

  const existing = await prisma.account.findFirst({ where: { email } });
  if (existing) {
    await prisma.account.update({ where: { id: existing.id }, data: { plan } });
    return NextResponse.json({ ok: true, email, plan, status: "updated" });
  }

  await prisma.account.create({ data: { email, plan } });
  return NextResponse.json({
    ok: true,
    email,
    plan,
    status: "pending — will apply the moment they sign in with that address",
  });
}
