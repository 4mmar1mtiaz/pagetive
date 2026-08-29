/**
 * Registering a customer hostname with whatever is actually serving HTTPS.
 *
 * DNS is only half of a custom domain. The other half is that the edge in
 * front of this app has to recognise the hostname, or it answers 404 to a
 * Host header it has no project for and, worse, never issues a certificate —
 * so https fails at the handshake, before any of this code runs. That step is
 * invisible from inside the app, which is why a domain can look correct in
 * every panel here and still serve nothing.
 *
 * Doing it by hand does not scale past the first customer and cannot be
 * delegated to them at all, so it happens here, at the moment the hostname is
 * attached to a page.
 *
 * Three routes, in order of preference:
 *
 *  1. A subdomain of WILDCARD_ROOT needs nothing. One wildcard record and one
 *     wildcard certificate cover every one of them forever, which is what
 *     makes the thousandth hostname a database insert. Prefer this.
 *  2. A hostname the customer owns is registered with the platform through its
 *     API. This is the only way their own domain can ever work.
 *  3. Unconfigured, or a host with no API: say so plainly rather than
 *     pretending. Self-hosting behind a proxy that already answers on every
 *     hostname is a legitimate setup and must not be broken by this.
 */
import { wildcardRoot } from "@/lib/hosts";

export type PlatformResult = {
  /** Did the hostname end up registered, by us or by the wildcard. */
  ok: boolean;
  /** One sentence for the domain panel. Written for the person reading it. */
  detail: string;
  /** True when nothing had to be done, so callers can stay quiet about it. */
  noop?: boolean;
};

type VercelConfig = { token: string; projectId: string; teamId?: string };

function vercel(): VercelConfig | null {
  const token = process.env.VERCEL_API_TOKEN?.trim();
  const projectId = process.env.VERCEL_PROJECT_ID?.trim();
  if (!token || !projectId) return null;
  return { token, projectId, teamId: process.env.VERCEL_TEAM_ID?.trim() || undefined };
}

export function platformConfigured(): boolean {
  return vercel() !== null;
}

/** Is this hostname already covered without registering anything? */
export function coveredByWildcard(hostname: string): boolean {
  const root = wildcardRoot();
  return Boolean(root && hostname.toLowerCase().endsWith(`.${root}`));
}

function query(cfg: VercelConfig): string {
  return cfg.teamId ? `?teamId=${encodeURIComponent(cfg.teamId)}` : "";
}

async function call(
  cfg: VercelConfig,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${cfg.token}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

function errorOf(body: Record<string, unknown>): string {
  const err = body.error as { message?: string; code?: string } | undefined;
  return err?.message ?? err?.code ?? "unknown error";
}

/**
 * Register a hostname so the edge answers on it and issues a certificate.
 *
 * Idempotent: a hostname already on the project comes back as success, because
 * re-attaching a domain someone removed and re-added must not fail.
 */
export async function attachHostname(hostname: string): Promise<PlatformResult> {
  if (coveredByWildcard(hostname)) {
    return {
      ok: true,
      noop: true,
      detail: `Covered by the wildcard on *.${wildcardRoot()}. Nothing to register, and it works immediately.`,
    };
  }

  const cfg = vercel();
  if (!cfg) {
    return {
      ok: false,
      detail:
        "DNS is only half of it: the host also has to be told this hostname exists, or it answers 404 and never issues a certificate. Set VERCEL_API_TOKEN and VERCEL_PROJECT_ID to have that happen automatically, or add the hostname to the project by hand.",
    };
  }

  const { status, body } = await call(cfg, `/v10/projects/${cfg.projectId}/domains${query(cfg)}`, {
    method: "POST",
    body: JSON.stringify({ name: hostname }),
  });

  if (status >= 200 && status < 300) {
    return { ok: true, detail: "Registered with the host. The certificate is usually issued within a minute." };
  }

  const code = (body.error as { code?: string } | undefined)?.code;
  if (code === "domain_already_in_use" || code === "domain_taken") {
    return {
      ok: false,
      detail: `${hostname} is already registered to a different project on the host. Remove it there first.`,
    };
  }
  // Already on this project is success, not a conflict.
  if (status === 409) {
    return { ok: true, detail: "Already registered with the host." };
  }

  return { ok: false, detail: `The host refused the hostname: ${errorOf(body)}` };
}

/** Where the certificate has got to, in words the domain panel can print. */
export async function hostnameStatus(hostname: string): Promise<PlatformResult> {
  if (coveredByWildcard(hostname)) {
    return { ok: true, noop: true, detail: `Covered by the wildcard on *.${wildcardRoot()}.` };
  }

  const cfg = vercel();
  if (!cfg) {
    return { ok: false, detail: "The host is not wired up here, so certificate status cannot be read." };
  }

  const { status, body } = await call(
    cfg,
    `/v9/projects/${cfg.projectId}/domains/${encodeURIComponent(hostname)}${query(cfg)}`,
  );

  if (status === 404) {
    return { ok: false, detail: "Not registered with the host yet, so https cannot work on it." };
  }
  if (status >= 400) {
    return { ok: false, detail: `Could not read the hostname from the host: ${errorOf(body)}` };
  }

  if (body.verified === false) {
    return {
      ok: false,
      detail: "Registered with the host, which is still waiting on DNS before it issues the certificate.",
    };
  }
  return { ok: true, detail: "Registered and verified with the host, certificate issued." };
}

/**
 * Best effort, and deliberately not fatal.
 *
 * A hostname left on the platform after its page is gone is untidy. A delete
 * that fails because of it is a page someone cannot detach, which is worse.
 */
export async function detachHostname(hostname: string): Promise<void> {
  if (coveredByWildcard(hostname)) return;
  const cfg = vercel();
  if (!cfg) return;
  await call(cfg, `/v9/projects/${cfg.projectId}/domains/${encodeURIComponent(hostname)}${query(cfg)}`, {
    method: "DELETE",
  }).catch(() => undefined);
}
