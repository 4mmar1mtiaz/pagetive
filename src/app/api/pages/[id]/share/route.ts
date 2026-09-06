import { NextResponse } from "next/server";
import { currentSession } from "@/lib/account";
import { accessTo, createShare, revokeShare, shareState } from "@/lib/share";
import { appUrl } from "@/lib/hosts";

/**
 * The share link for one page.
 *
 * Owner only, on every verb. A viewer who was given the page must not be able
 * to read the link, rotate it, or revoke it — passing on access you were lent
 * is exactly the thing the owner did not agree to.
 */

export const dynamic = "force-dynamic";

async function requireOwner(pageId: string): Promise<string> {
  const session = await currentSession();
  const access = await accessTo(session.accountId, pageId);
  // "Not found" for a viewer as well as a stranger: that this page has a share
  // link is the owner's business.
  if (access !== "owner") throw new Error("Page not found");
  return session.accountId;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireOwner(id);
    return NextResponse.json({ share: await shareState(id, appUrl()) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireOwner(id);
    const body = await req.json().catch(() => ({}));
    // Defaults to sharing the numbers too, because that is what the button is
    // for; sending only the page is the deliberate, narrower choice.
    const withReport = body.withReport !== false;
    await createShare(id, withReport);
    return NextResponse.json({ share: await shareState(id, appUrl()) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireOwner(id);
    await revokeShare(id);
    // Deliberately does not remove the page from workspaces that already added
    // it. Revoking stops new people getting in; it is not a way to quietly
    // delete a page out from under a colleague. See lib/share.ts.
    return NextResponse.json({ share: null });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }
}
