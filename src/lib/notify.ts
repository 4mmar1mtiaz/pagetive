import type { PageSettings } from "@/lib/blocks";

/**
 * Getting a lead out of this app and into wherever the owner actually works.
 *
 * Two independent lanes, and neither one is allowed to lose the lead: the row
 * is written to the database before either is attempted, and a failure here is
 * recorded on the row rather than raised at the visitor. A person who filled in
 * a form and got an error page because a CRM webhook was misconfigured is a
 * lead lost twice.
 */

export type Delivery = { ok: boolean; error?: string };

/** POST the lead as JSON. Works with GHL, Zapier, Make, n8n, HubSpot — anything
 *  that accepts an inbound hook, which is every CRM worth integrating. */
export async function forwardToWebhook(
  url: string,
  payload: Record<string, unknown>,
): Promise<Delivery> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 300);
      return { ok: false, error: `webhook returned HTTP ${res.status}${body ? `: ${body}` : ""}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `webhook unreachable: ${(err as Error).message}` };
  }
}

/** Email notification. Silently skipped when no key is configured — email is an
 *  optional convenience, and the webhook plus the stored row are the record. */
export async function emailLead(args: {
  to: string;
  pageName: string;
  data: Record<string, unknown>;
}): Promise<Delivery> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from) return { ok: false, error: "email not configured" };

  const rows = Object.entries(args.data)
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td>${String(v)}</td></tr>`)
    .join("");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: args.to.split(",").map((s) => s.trim()).filter(Boolean),
        subject: `New lead — ${args.pageName}`,
        html: `<p>New form fill on <strong>${args.pageName}</strong>.</p><table>${rows}</table>`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ok: false, error: `resend HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function deliverLead(args: {
  settings: PageSettings;
  pageName: string;
  data: Record<string, unknown>;
  context: Record<string, unknown>;
}): Promise<{ forwarded: boolean; error?: string }> {
  const problems: string[] = [];
  let forwarded = false;

  if (args.settings.crmWebhookUrl) {
    const r = await forwardToWebhook(args.settings.crmWebhookUrl, {
      ...args.data,
      _page: args.pageName,
      ...args.context,
    });
    if (r.ok) forwarded = true;
    else problems.push(r.error ?? "webhook failed");
  }

  if (args.settings.notifyEmail) {
    const r = await emailLead({ to: args.settings.notifyEmail, pageName: args.pageName, data: args.data });
    if (r.ok) forwarded = true;
    else if (r.error !== "email not configured") problems.push(r.error ?? "email failed");
  }

  return { forwarded, error: problems.length ? problems.join("; ") : undefined };
}
