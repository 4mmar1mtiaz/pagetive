import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assertOwns, currentSession } from "@/lib/account";
import { verifyDomain } from "@/lib/domains";
import { attachHostname, hostnameStatus } from "@/lib/platform";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  const domain = await prisma.domain.findUnique({ where: { id } });
  if (!domain) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await assertOwns(session.accountId, domain.pageId);

  // Two separate questions, and a domain is only live when both answer yes:
  // does DNS point here, and does the edge in front of this app know the
  // hostname and hold a certificate for it. Checking only the first is how a
  // domain reads as verified in this panel while the browser gets a TLS error.
  const dns = await verifyDomain(domain.hostname);
  let platform = await hostnameStatus(domain.hostname);

  // DNS is right but the host never learned the hostname — usually a domain
  // attached before the platform credentials existed. Register it now instead
  // of reporting a problem the user cannot act on.
  if (dns.ok && !platform.ok) {
    const retry = await attachHostname(domain.hostname);
    if (retry.ok) platform = await hostnameStatus(domain.hostname);
    else platform = retry;
  }

  const ok = dns.ok && platform.ok;
  const detail = ok
    ? `${dns.detail} ${platform.detail}`.trim()
    : !dns.ok
      ? dns.detail
      : platform.detail;

  await prisma.domain.update({
    where: { id },
    data: { verified: ok, lastCheck: new Date(), note: detail },
  });
  return NextResponse.json({ ok, detail, dns, platform });
}
