import { NextResponse } from "next/server";
import { currentSession } from "@/lib/account";
import { claimShare, resolveShare } from "@/lib/share";

/**
 * "Add this page to my account."
 *
 * The link proves someone has been let in; the session proves who they are.
 * Both are required, because a grant is attached to an account and an anonymous
 * visitor has none — they can read the shared page all day, they just cannot
 * keep it.
 */

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await resolveShare(token);
  if (!share) return NextResponse.json({ error: "This link is no longer active." }, { status: 404 });

  const session = await currentSession();
  if (session.anonymous) {
    return NextResponse.json(
      { error: "Sign in first — a page has to belong to an account to stay in your workspace." },
      { status: 401 },
    );
  }
  if (session.suspended) {
    return NextResponse.json({ error: "This account is suspended." }, { status: 402 });
  }

  await claimShare(share, session.accountId);
  return NextResponse.json({ ok: true, pageId: share.pageId });
}
