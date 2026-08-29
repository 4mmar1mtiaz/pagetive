import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { LP_CSS } from "@/styles/lp-css";
import { normalizeBlocks, type Block, type PageSettings } from "@/lib/blocks";
import { currentSession } from "@/lib/account";
import { upgradeMessage } from "@/lib/plan";
import { appUrl as resolvedAppUrl } from "@/lib/hosts";

/**
 * Download a page as one self-contained HTML file.
 *
 * The export is genuinely standalone — inline styles, no build step, no
 * framework — so it can be dropped on any host, handed to a client, or checked
 * into their own repo. The one thing it keeps a connection to is the lead
 * endpoint: the form posts back here so submissions still land in the CRM and
 * still count as conversions. An export that silently stops capturing leads
 * would be worse than no export.
 *
 * A variant can be exported instead of the master, which is how a winning
 * version becomes the customer's new default elsewhere.
 *
 * The markup comes from asking the app to render its own page and slicing out
 * the landing container, rather than re-rendering the component tree here.
 * Next refuses `react-dom/server` inside app code, and a second hand-written
 * renderer would drift from the real one within a release — an export that
 * quietly stops matching the page it claims to be is the worst kind of bug,
 * because it only shows up on the customer's server.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();

  if (!session.ents.canExport) {
    return new Response(upgradeMessage("export"), { status: 402 });
  }

  const page = await prisma.page.findUnique({
    where: { id },
    include: { variants: { orderBy: { createdAt: "asc" } } },
  });
  if (!page || page.ownerId !== session.accountId) {
    return new Response("Not found", { status: 404 });
  }

  const variantId = new URL(req.url).searchParams.get("v");
  const variant = variantId ? (page.variants.find((v) => v.id === variantId) ?? null) : null;

  const settings = parseJson<PageSettings>(page.settings, {});
  const blocks = normalizeBlocks(parseJson<Block[]>(page.blocks, []));
  const origin = resolvedAppUrl();

  // hm=1 suppresses the tracker; preview=1 lets a draft export.
  const rendered = await fetch(
    `${origin}/p/${page.slug}?preview=1&hm=1${variant ? `&v=${variant.id}` : ""}`,
    { headers: { "user-agent": "adaptive-lp-export" }, cache: "no-store" },
  );
  if (!rendered.ok) {
    return new Response(`Could not render the page for export (HTTP ${rendered.status}).`, { status: 500 });
  }
  const full = await rendered.text();

  const start = full.indexOf('<div id="lp-root"');
  if (start === -1) {
    return new Response("Rendered page did not contain the landing container.", { status: 500 });
  }
  // Next appends its own scripts after the body content; everything before the
  // first of them, trimmed back to the last closing tag, is the page itself.
  const afterScripts = full.indexOf("<script", start);
  const slice = full.slice(start, afterScripts === -1 ? undefined : afterScripts);
  const body = slice.slice(0, slice.lastIndexOf("</div>") + 6);

  // The React form handler does not survive static markup, so the exported file
  // carries its own. Plain DOM, no dependencies, same endpoint.
  const formScript = `
<script>
(function () {
  var endpoint = ${JSON.stringify(`${origin}/api/lead`)};
  var pageId = ${JSON.stringify(page.id)};
  var variantId = ${JSON.stringify(variant?.id ?? null)};
  var redirect = ${JSON.stringify(settings.redirectUrl ?? "")};
  var renderedAt = Date.now();
  document.querySelectorAll("form").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = form.querySelector("button[type=submit]");
      if (btn) { btn.disabled = true; btn.textContent = "Sending\\u2026"; }
      var data = {};
      var honeypot = "";
      new FormData(form).forEach(function (v, k) {
        if (k === "company_website") { honeypot = String(v); return; }
        data[k] = String(v);
      });
      fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pageId: pageId, variantId: variantId, data: data, url: location.href,
          _hp: honeypot, _elapsed: Date.now() - renderedAt
        })
      }).then(function (r) {
        if (!r.ok) throw new Error("failed");
        if (redirect) { location.href = redirect; return; }
        var done = document.createElement("div");
        done.className = "form-done";
        done.innerHTML = '<span class="tick">\\u2713</span><p>' +
          ${JSON.stringify(
            blocks.find((b) => b.type === "form")?.successMessage ?? "Got it. We'll be in touch shortly.",
          )} + '</p>';
        form.replaceWith(done);
      }).catch(function () {
        if (btn) { btn.disabled = false; btn.textContent = "Try again"; }
      });
    });
  });
})();
</script>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${page.name.replace(/[<>&]/g, "")}</title>
${page.goal ? `<meta name="description" content="${page.goal.replace(/["<>&]/g, "")}" />` : ""}
<style>${LP_CSS}</style>
</head>
<body style="margin:0">
${body}
${formScript}
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${page.slug}${variant ? `-${variant.name.replace(/\W+/g, "-").toLowerCase()}` : ""}.html"`,
    },
  });
}
