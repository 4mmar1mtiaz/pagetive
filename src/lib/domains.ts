import dns from "node:dns/promises";
import { appHosts, wildcardRoot } from "@/lib/hosts";

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

export function dnsPlan(hostname: string): DnsPlan {
  const host = hostname.toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  const root = wildcardRoot();
  const target = root ?? appHosts().find((h) => h !== "localhost" && h !== "127.0.0.1") ?? "your-app-host";

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
  const target = root ?? appHosts().find((h) => h !== "localhost" && h !== "127.0.0.1");

  if (root && host.endsWith(`.${root}`)) {
    return { ok: true, detail: `Covered by the wildcard on *.${root}.` };
  }

  try {
    const cnames = await dns.resolveCname(host).catch(() => [] as string[]);
    if (target && cnames.some((c) => c.toLowerCase().replace(/\.$/, "").endsWith(target))) {
      return { ok: true, detail: `CNAME resolves to ${cnames[0]}.` };
    }
    const a = await dns.resolve4(host).catch(() => [] as string[]);
    if (process.env.APP_IP && a.includes(process.env.APP_IP)) {
      return { ok: true, detail: `A record resolves to ${process.env.APP_IP}.` };
    }
    if (cnames.length === 0 && a.length === 0) {
      return { ok: false, detail: "Nothing resolves for this hostname yet. The record has not been created, or has not propagated." };
    }
    return {
      ok: false,
      detail: `Resolves to ${[...cnames, ...a].join(", ")}, which is not this app. Check the record value.`,
    };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}
