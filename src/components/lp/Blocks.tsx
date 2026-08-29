import { LeadForm } from "@/components/lp/LeadForm";
import { appUrl } from "@/lib/hosts";
import { theme as resolveTheme, type Block, type PageSettings, type ThemeTokens } from "@/lib/blocks";

/**
 * The renderer. One component per block type, all reading the same tokens.
 *
 * Every section carries data-block-id — that attribute is what turns a generic
 * coordinate heatmap into "the pricing block is where people stop reading". The
 * tracker walks up from the clicked element to find it.
 */

/** Routes that belong to the app itself rather than to the page being served. */
const APP_ROUTES = ["/sign-in", "/sign-up", "/admin"];

/**
 * Point app links at the app, wherever this page is being served from.
 *
 * A published page can answer on its own hostname, and on that hostname a
 * relative "/sign-in" is a page on the customer's domain, not the workspace —
 * the proxy has no database at the edge, so it treats the unknown path as
 * content and the button 404s. Rewriting these few paths to absolute URLs is
 * what makes a marketing page on one domain able to send someone to an app on
 * another. Every other href is left exactly as written.
 */
function resolveHref(href: string | undefined): string {
  const target = href || "#form";
  if (!APP_ROUTES.some((r) => target === r || target.startsWith(`${r}?`) || target.startsWith(`${r}/`))) {
    return target;
  }
  return `${appUrl().replace(/\/+$/, "")}${target}`;
}

function Cta({ block }: { block: Block }) {
  if (!block.ctaText) return null;
  return (
    <>
      <div className="cta-row">
        <a className="btn" href={resolveHref(block.ctaHref)} data-cta="primary">
          {block.ctaText}
        </a>
        {block.secondaryCtaText ? (
          <a className="btn ghost" href={resolveHref(block.secondaryCtaHref)} data-cta="secondary">
            {block.secondaryCtaText}
          </a>
        ) : null}
      </div>
      {block.ctaNote ? <p className="cta-note">{block.ctaNote}</p> : null}
    </>
  );
}

function Heading({ block }: { block: Block }) {
  return (
    <>
      {block.eyebrow ? <span className="eyebrow">{block.eyebrow}</span> : null}
      {block.headline ? <h2>{block.headline}</h2> : null}
      {block.subhead ? <p className="lead">{block.subhead}</p> : null}
    </>
  );
}

function paragraphs(body: string) {
  return body
    .split(/\n{2,}|\r\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function One({
  block,
  index,
  ctx,
}: {
  block: Block;
  index: number;
  ctx: { pageId: string; variantId: string | null; settings: PageSettings };
}) {
  const align = block.align === "center" ? "center" : block.type === "hero" || block.type === "cta" ? "center" : "";
  const alt = index % 2 === 1 && !["hero", "footer", "cta"].includes(block.type) ? " alt" : "";
  const attrs = { "data-block-id": block.id, "data-block-type": block.type };

  switch (block.type) {
    case "hero":
      return (
        <section className={`hero ${align}`} {...attrs}>
          <div className="wrap">
            {block.eyebrow ? <span className="eyebrow">{block.eyebrow}</span> : null}
            {block.headline ? <h1>{block.headline}</h1> : null}
            {block.subhead ? <p className="lead">{block.subhead}</p> : null}
            <Cta block={block} />
            {block.imageUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img className="lp-media" src={block.imageUrl} alt={block.alt ?? ""} loading="eager" />
            ) : null}
          </div>
        </section>
      );

    case "media":
      return (
        <section className={alt} {...attrs}>
          <div className="wrap center">
            <Heading block={block} />
            {block.mediaUrl ? (
              block.mediaKind === "video" ? (
                <video
                  className="lp-media"
                  src={block.mediaUrl}
                  controls
                  playsInline
                  preload="metadata"
                />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img className="lp-media" src={block.mediaUrl} alt={block.alt ?? ""} loading="lazy" />
              )
            ) : null}
            {block.caption ? <p className="lp-caption">{block.caption}</p> : null}
          </div>
        </section>
      );

    case "logos":
      return (
        <section className={`alt`} {...attrs}>
          <div className="wrap center">
            {block.headline ? <p>{block.headline}</p> : null}
            <div className="logos">
              {(block.items ?? []).map((it, i) =>
                it.imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img key={i} className="lp-logo" src={it.imageUrl} alt={it.name ?? it.title ?? ""} loading="lazy" />
                ) : (
                  <span key={i}>{it.name ?? it.title}</span>
                ),
              )}
            </div>
          </div>
        </section>
      );

    case "features":
      return (
        <section className={alt} {...attrs}>
          <div className="wrap">
            <div className={align}>
              <Heading block={block} />
            </div>
            <div className="grid g3" style={{ marginTop: 40 }}>
              {(block.items ?? []).map((it, i) => (
                <div className="card" key={i}>
                  {/* The icon field is deprecated: emoji in a paid landing page
                      reads as a side project. Legacy pages that still carry one
                      simply do not render it. */}
                  {it.title ? <h3>{it.title}</h3> : null}
                  {it.body ? <p>{it.body}</p> : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      );

    case "steps":
      return (
        <section className={alt} {...attrs}>
          <div className="wrap">
            <Heading block={block} />
            <div className="grid g3" style={{ marginTop: 40 }}>
              {(block.items ?? []).map((it, i) => (
                <div className="card step" key={i}>
                  <div className="n">{i + 1}</div>
                  <div>
                    {it.title ? <h3>{it.title}</h3> : null}
                    {it.body ? <p>{it.body}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      );

    case "stats":
      return (
        <section className={alt} {...attrs}>
          <div className="wrap">
            {block.headline ? (
              <div className="center">
                <h2>{block.headline}</h2>
              </div>
            ) : null}
            <div className="grid g4" style={{ marginTop: 32 }}>
              {(block.items ?? []).map((it, i) => (
                <div className="stat" key={i}>
                  <div className="value">{it.value}</div>
                  <div className="label">{it.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      );

    case "proof":
      return (
        <section className={alt} {...attrs}>
          <div className="wrap">
            <div className="center">
              <Heading block={block} />
            </div>
            <div className="grid g3" style={{ marginTop: 40 }}>
              {(block.items ?? []).map((it, i) => (
                <div className="card" key={i}>
                  <blockquote>“{it.quote}”</blockquote>
                  <div className="who">
                    {it.author}
                    {it.role ? `, ${it.role}` : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      );

    case "pricing":
      return (
        <section className={alt} {...attrs}>
          <div className="wrap">
            <div className="center">
              <Heading block={block} />
            </div>
            <div className="grid g3" style={{ marginTop: 40 }}>
              {(block.plans ?? []).map((p, i) => (
                <div className={`card plan${p.highlight ? " highlight" : ""}`} key={i}>
                  <h3>{p.name}</h3>
                  <div className="price">{p.price}</div>
                  {p.period ? <div className="period">{p.period}</div> : null}
                  {p.blurb ? <p style={{ marginTop: 12 }}>{p.blurb}</p> : null}
                  <ul>
                    {(p.features ?? []).map((f, j) => (
                      <li key={j}>{f}</li>
                    ))}
                  </ul>
                  <a className="btn" href={resolveHref(p.ctaHref)} data-cta="pricing">
                    {p.ctaText || "Get started"}
                  </a>
                </div>
              ))}
            </div>
          </div>
        </section>
      );

    case "faq":
      return (
        <section className={alt} {...attrs}>
          <div className="narrow">
            <Heading block={block} />
            <div style={{ marginTop: 24 }}>
              {(block.items ?? []).map((it, i) => (
                <details key={i}>
                  <summary>{it.q ?? it.title}</summary>
                  <p>{it.a ?? it.body}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      );

    case "form": {
      const fields =
        block.fields && block.fields.length > 0
          ? block.fields
          : [
              { name: "name", label: "Name", type: "text" as const, required: true },
              { name: "email", label: "Email", type: "email" as const, required: true },
              { name: "phone", label: "Phone", type: "tel" as const },
            ];
      return (
        <section id="form" className={alt} {...attrs}>
          <div className="narrow center">
            <Heading block={block} />
          </div>
          <div className="card form-card" style={{ marginTop: 32 }}>
            <LeadForm
              pageId={ctx.pageId}
              variantId={ctx.variantId}
              blockId={block.id}
              fields={fields}
              submitText={block.submitText || "Send"}
              successMessage={block.successMessage || "Got it. We'll be in touch shortly."}
              redirectUrl={ctx.settings.redirectUrl}
            />
          </div>
        </section>
      );
    }

    case "calendar": {
      const src = block.embedUrl || ctx.settings.calendarUrl || "";
      return (
        <section id="calendar" className={alt} {...attrs}>
          <div className="wrap center">
            <Heading block={block} />
          </div>
          <div className="wrap" style={{ marginTop: 32 }}>
            {src ? (
              <iframe
                className="cal-frame"
                src={src}
                height={block.height ?? 720}
                style={{ height: block.height ?? 720 }}
                title="Book a time"
                loading="lazy"
              />
            ) : (
              <div className="cal-frame cal-empty">
                No scheduler connected yet. Add a Cal.com, Calendly or TidyCal link in this page&apos;s
                settings and it appears here.
              </div>
            )}
          </div>
        </section>
      );
    }

    case "cta":
      return (
        <section className={`center ${alt}`} {...attrs}>
          <div className="narrow">
            {block.headline ? <h2>{block.headline}</h2> : null}
            {block.subhead ? <p className="lead">{block.subhead}</p> : null}
            <Cta block={block} />
          </div>
        </section>
      );

    case "richtext":
      return (
        <section className={alt} {...attrs}>
          <div className="narrow">
            {block.headline ? <h2>{block.headline}</h2> : null}
            {paragraphs(block.body ?? "").map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </section>
      );

    case "footer":
      return (
        <footer {...attrs}>
          <div className="wrap">
            <span>{block.body}</span>
            <span>
              {(block.links ?? []).map((l, i) => (
                <a key={i} href={l.href ? resolveHref(l.href) : "#"}>
                  {l.label}
                </a>
              ))}
            </span>
          </div>
        </footer>
      );

    default:
      return null;
  }
}

export function LandingPage({
  blocks,
  theme,
  ctx,
}: {
  blocks: Block[];
  theme: ThemeTokens;
  ctx: { pageId: string; variantId: string | null; settings: PageSettings };
}) {
  const t = resolveTheme(theme);
  const vars = {
    "--lp-bg": t.bg,
    "--lp-surface": t.surface,
    "--lp-text": t.text,
    "--lp-muted": t.muted,
    "--lp-accent": t.accent,
    "--lp-accent-soft": t.accentSoft,
    "--lp-radius": `${t.radius}px`,
    "--lp-font": `${t.font}, ui-sans-serif, system-ui, sans-serif`,
  } as React.CSSProperties;

  return (
    <div id="lp-root" className="lp" data-mode={t.mode} data-density={t.density} style={vars}>
      {blocks.map((b, i) => (
        <One key={b.id} block={b} index={i} ctx={ctx} />
      ))}
    </div>
  );
}
