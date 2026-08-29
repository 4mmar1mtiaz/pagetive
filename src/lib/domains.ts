import dns from "node:dns/promises";
import { appHosts, appUrl, wildcardRoot } from "@/lib/hosts";

export { appHosts, wildcardRoot };

/**
 * DNS instructions and verification.
 *
 * The instruction generator matters more than it looks. "Point a CNAME at us"
 * is where most self-serve hosting onboarding dies — the customer creates the
 * wrong record type, on the wrong name, at a registrar with its own vocabulary,
 * and then concludes the product is broken. So the copy here is the exact
 * record, split into the fields their registrar will actually ask for.
 */

export type DnsPlan = {
  kind: "wildcard" | "cname" | "apex";
  ready: boolean;
  records: { type: string; name: string; value: string }[];
  explain: string;
};

/**
 * What a customer's CNAME should actually point at.
 *
 * The app's own hostname, not the wildcard root. A subdomain of the wildcard
 * root never gets here — it is answered by the wildcard branch below with no
 * record to create at all — so by the time a CNAME is being written the target
 * has to be a name that is guaranteed to route and to hold a certificate, and
 * that is the app itself. Pointing at the wildcard root instead only works if
 * that root separately resolves and is on the certificate, which is exactly the
 * assumption that produces a customer staring at "CNAME -> lp.local".
 */
function cnameTarget(): string {
  let fromAppUrl: string | null = null;
  try {
    fromAppUrl = new URL(appUrl()).hostname.toLowerCase();
  } catch {
    fromAppUrl = null;
  }
  const usable = (h: string | null) => Boolean(h && h !== "localhost" && h !== "127.0.0.1" && h.includes("."));
  if (usable(fromAppUrl)) return fromAppUrl as string;

  const fromHosts = appHosts().find((h) => usable(h));
  if (fromHosts) return fromHosts;

  const root = wildcardRoot();
  return root ?? "your-app-host";
}

export function dnsPlan(hostname: string): DnsPlan {
  const host = hostname.toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  const root = wildcardRoot();
  const target = cnameTarget();

  if (root && host.endsWith(`.${root}`)) {
    return {
      kind: "wildcard",
      ready: true,
      records: [],
      explain: `Covered by the wildcard record on *.${root}. Nothing to create — this hostname works the moment you save it.`,
    };
  }

  const labels = host.split(".");
  // Two labels means an apex (acme.com); anything longer is a subdomain. Apex
  // domains cannot legally hold a CNAME, which is why they get different advice.
  const isApex = labels.length <= 2;

  if (isApex) {
    return {
      kind: "apex",
      ready: false,
      records: [
        { type: "A", name: "@", value: process.env.APP_IP || "<your server IP>" },
      ],
      explain:
        "An apex domain cannot hold a CNAME, so it needs an A record to the server IP. If you would rather not pin an IP, ask the customer to use a subdomain (go.acme.com) instead — that is what most SaaS hosting does.",
    };
  }

  return {
    kind: "cname",
    ready: false,
    records: [{ type: "CNAME", name: labels[0], value: target }],
    explain: `At ${labels.slice(1).join(".")}, create a CNAME on "${labels[0]}" pointing to ${target}. Propagation is usually minutes.`,
  };
}

/** Does this hostname actually resolve to us yet? */
export async function verifyDomain(hostname: string): Promise<{ ok: boolean; detail: string }> {
  const host = hostname.toLowerCase();
  const root = wildcardRoot();
  const target = cnameTarget();

  if (root && host.endsWith(`.${root}`)) {
    return { ok: true, detail: `Covered by the wildcard on *.${root}.` };
  }

  try {
    const cnames = (await dns.resolveCname(host).catch(() => [] as string[])).map((c) =>
      c.toLowerCase().replace(/\.$/, ""),
    );
    if (cnames.some((c) => c === target || c.endsWith(`.${target}`))) {
      return { ok: true, detail: `CNAME resolves to ${cnames[0]}.` };
    }

    const a = await dns.resolve4(host).catch(() => [] as string[]);
    if (process.env.APP_IP && a.includes(process.env.APP_IP)) {
      return { ok: true, detail: `A record resolves to ${process.env.APP_IP}.` };
    }

    // A registrar that flattens CNAMEs, and every apex, hand back A records
    // instead. Comparing them to the app's own addresses is the only way to
    // recognise a correctly pointed domain that simply is not a CNAME any more.
    if (a.length) {
      const ours = await dns.resolve4(target).catch(() => [] as string[]);
      if (ours.length && a.some((ip) => ours.includes(ip))) {
        return { ok: true, detail: `Resolves to ${a[0]}, which is this app.` };
      }
    }

    if (cnames.length === 0 && a.length === 0) {
      return {
        ok: false,
        detail: `Nothing resolves for ${host} yet. The record has not been created, or has not propagated.`,
      };
    }
    return {
      ok: false,
      detail: `Resolves to ${[...cnames, ...a].join(", ")}, which is not ${target}. Check the record value.`,
    };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}
