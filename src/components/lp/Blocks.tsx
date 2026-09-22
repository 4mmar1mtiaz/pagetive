import { cloneElement } from "react";
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

/**
 * A section's own background.
 *
 * Returned as inline style rather than a class because the values are the
 * user's: an arbitrary image URL and an arbitrary colour cannot be enumerated
 * in a stylesheet. Everything that *can* be a class still is one, so a page
 * remains restyleable by tokens.
 *
 * bgSlice is the deliberate exception to the continuity rule. It sizes the
 * image to the number of sections sharing it and offsets this one's share, so
 * `{part: 2, of: 3}` shows the middle third. The builder only reaches for it
 * after telling the user why it breaks when sections move.
 */
function background(block: Block): React.CSSProperties | undefined {
  const { bgImageUrl, bgColor, bgFocus, bgFixed, bgSlice } = block;
  if (!bgImageUrl && !bgColor) return undefined;

  const style: React.CSSProperties = {};
  if (bgColor) style.backgroundColor = bgColor;
  if (!bgImageUrl) return style;

  style.backgroundImage = `url(${JSON.stringify(bgImageUrl)})`;
  style.backgroundRepeat = "no-repeat";
  // A fixed background cannot also be a slice: the slice is positioned against
  // the section, and `fixed` positions it against the viewport instead.
  const of = Math.max(1, Math.floor(bgSlice?.of ?? 1));
  const part = Math.min(of, Math.max(1, Math.floor(bgSlice?.part ?? 1)));

  if (of > 1) {
    style.backgroundSize = `${of * 100}% 100%`;
    style.backgroundPosition = of === 1 ? "center" : `${((part - 1) / (of - 1)) * 100}% center`;
  } else {
    style.backgroundSize = "cover";
    style.backgroundPosition = bgFocus && bgFocus !== "center" ? bgFocus : "center";
    if (bgFixed) style.backgroundAttachment = "fixed";
  }
  return style;
}

/**
 * The visual payload of a block, whatever kind it is.
 *
 * A picture, a video, an embedded form or scheduler, or the lead form itself.
 * One function for all of them so that placing it is one decision made in one
 * place: the alternative is `layout` meaning something slightly different on
 * each of fourteen block types, which is the same as it meaning nothing.
 *
 * Returning null is normal. Most blocks are copy.
 */
function Figure({
  block,
  ctx,
}: {
  block: Block;
  ctx: { pageId: string; variantId: string | null; settings: PageSettings };
}) {
  // A menu's imageUrl is its logo, already drawn at logo size inside the bar.
  // Treating it as a figure as well drew the logo a second time at full width
  // under a sticky menu, covering the page.
  if (block.type === "menu") return null;

  const cap: React.CSSProperties = block.mediaHeight ? { maxHeight: block.mediaHeight } : {};
  const fit = block.mediaFit === "cover" ? " fit-cover" : "";

  if (block.type === "form") {
    const fields =
      block.fields && block.fields.length > 0
        ? block.fields
        : [
            { name: "name", label: "Name", type: "text" as const, required: true },
            { name: "email", label: "Email", type: "email" as const, required: true },
            { name: "phone", label: "Phone", type: "tel" as const },
          ];
    return (
      <div className="card form-card">
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
    );
  }

  // A calendar block with no URL of its own falls back to the page's scheduler.
  // Any other block only embeds what it was actually given.
  const src = block.embedUrl || (block.type === "calendar" ? ctx.settings.calendarUrl || "" : "");
  if (src) {
    const height = block.height ?? block.mediaHeight ?? (block.type === "calendar" ? 720 : 620);
    return (
      <iframe
        className="cal-frame"
        src={src}
        height={height}
        style={{ height }}
        title={block.headline || (block.type === "calendar" ? "Book a time" : "Embedded content")}
        loading="lazy"
        allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
      />
    );
  }
  if (block.type === "calendar") {
    return (
      <div className="cal-frame cal-empty">
        No scheduler connected yet. Add a Cal.com, Calendly or TidyCal link in this page&apos;s
        settings and it appears here.
      </div>
    );
  }

  const url = block.mediaUrl || block.imageUrl;
  if (!url) return null;

  if (block.mediaKind === "video") {
    return (
      <video
        className={`lp-media${fit}`}
        src={url}
        poster={block.poster}
        style={cap}
        controls={block.controls !== false && !block.autoplay}
        autoPlay={block.autoplay === true}
        muted={block.autoplay === true || block.muted === true}
        loop={block.loop === true}
        playsInline
        preload={block.autoplay ? "auto" : "metadata"}
      />
    );
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      className={`lp-media${fit}`}
      src={url}
      alt={block.alt ?? ""}
      style={cap}
      loading={block.type === "hero" ? "eager" : "lazy"}
    />
  );
}

/** A video behind a section, in place of a background picture. */
function BgVideo({ url }: { url: string }) {
  return (
    <video className="lp-bgvideo" src={url} autoPlay muted loop playsInline preload="auto" aria-hidden="true" />
  );
}

/** The scrim between a photograph and the copy on top of it. */
function Scrim({ block }: { block: Block }) {
  const amount = block.bgOverlay;
  if ((!block.bgImageUrl && !block.bgVideoUrl) || !amount || amount <= 0) return null;
  return <span className="lp-scrim" style={{ opacity: Math.min(1, amount) }} aria-hidden="true" />;
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

function Body({
  block,
  index,
  ctx,
}: {
  block: Block;
  index: number;
  ctx: { pageId: string; variantId: string | null; settings: PageSettings };
}) {
  const align =
    block.align === "center"
      ? "center"
      : block.align === "left"
        ? ""
        : block.type === "hero" || block.type === "cta"
          ? "center"
          : "";
  // A block that paints its own background must not also take the alternating
  // surface: two backgrounds on one section is the surface winning and the
  // user's picture disappearing.
  const own = Boolean(block.bgImageUrl || block.bgColor);
  const alt = index % 2 === 1 && !own && !["hero", "footer", "cta"].includes(block.type) ? " alt" : "";
  const attrs = { "data-block-id": block.id, "data-block-type": block.type };

  switch (block.type) {
    /**
     * The menu.
     *
     * Placement is the user's, not the template's. A pinned top bar is what a
     * page gets when nobody said otherwise; a box down the left edge is what it
     * gets when somebody did. The fixed placements leave the flow entirely, so
     * the menu keeps working in a page that scrolls sideways, and the root
     * reserves the gutter for it.
     */
    case "menu": {
      const placement = block.placement ?? "top";
      const sticky = block.sticky !== false && (placement === "top" || placement === "bottom");
      return (
        <nav className={`lp-menu at-${placement}${sticky ? " sticky" : ""}`} {...attrs}>
          <div className="menu-inner">
            {block.imageUrl || block.headline ? (
              <a className="menu-brand" href="#lp-root">
                {block.imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img className="menu-logo" src={block.imageUrl} alt={block.alt ?? ""} />
                ) : null}
                {block.headline ? <span>{block.headline}</span> : null}
              </a>
            ) : null}
            <div className="menu-links">
              {(block.links ?? []).map((l, i) => (
                <a key={i} href={l.href ? resolveHref(l.href) : "#lp-root"}>
                  {l.label}
                </a>
              ))}
            </div>
            {block.ctaText ? (
              <a className="btn menu-cta" href={resolveHref(block.ctaHref)} data-cta="menu">
                {block.ctaText}
              </a>
            ) : null}
          </div>
        </nav>
      );
    }

    case "hero":
      return (
        <section className={`hero ${align}`} {...attrs}>
          <div className="wrap">
            {block.eyebrow ? <span className="eyebrow">{block.eyebrow}</span> : null}
            {block.headline ? <h1>{block.headline}</h1> : null}
            {block.subhead ? <p className="lead">{block.subhead}</p> : null}
            <Cta block={block} />
          </div>
        </section>
      );

    case "media":
    case "embed":
      return (
        <section className={alt} {...attrs}>
          <div className={`wrap ${block.align === "left" ? "" : "center"}`}>
            <Heading block={block} />
          </div>
        </section>
      );

    case "logos":
      return (
        <section className={own ? "" : "alt"} {...attrs}>
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
                      simply do not render it. A real picture is a different
                      matter, and an item that was given one shows it. */}
                  {it.imageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img className="item-media" src={it.imageUrl} alt={it.title ?? ""} loading="lazy" />
                  ) : null}
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
                    {it.imageUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img className="who-face" src={it.imageUrl} alt={it.author ?? ""} loading="lazy" />
                    ) : null}
                    <span>
                      {it.author}
                      {it.role ? `, ${it.role}` : ""}
                    </span>
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

    case "form":
      return (
        <section id="form" className={alt} {...attrs}>
          <div className={`narrow ${block.align === "left" ? "" : "center"}`}>
            <Heading block={block} />
          </div>
        </section>
      );

    case "calendar":
      return (
        <section id="calendar" className={alt} {...attrs}>
          <div className={`wrap ${block.align === "left" ? "" : "center"}`}>
            <Heading block={block} />
          </div>
        </section>
      );

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

type Painted = React.ReactElement<{
  id?: string;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}>;

/**
 * Each block, with its own background painted behind it.
 *
 * Done here rather than inside every case so that a background is a property of
 * a block, not of the fourteen places a block can be rendered. The section is
 * cloned rather than wrapped: the heatmap finds a block by walking up to
 * data-block-id, and an extra element between the click and that attribute is
 * the kind of change nobody notices until the heatmap is empty.
 *
 * Every section also becomes an anchor named after its block id, which is what
 * a menu links to.
 */
function One(props: {
  block: Block;
  index: number;
  ctx: { pageId: string; variantId: string | null; settings: PageSettings };
}) {
  const el = Body(props) as Painted | null;
  if (!el) return null;

  const { block, ctx } = props;
  const bg = background(block);
  const figure = Figure({ block, ctx });
  const layout = block.layout ?? "stack";

  if (!bg && !block.panel && !figure && !block.bgVideoUrl) {
    // Nothing to paint and nothing to place. Still give it its anchor.
    return el.props.id ? el : cloneElement(el, { id: block.id });
  }

  const classes = [
    el.props.className ?? "",
    bg ? "has-bg" : "",
    block.bgImageUrl ? "has-bg-image" : "",
    block.bgVideoUrl ? "has-bg-video" : "",
    block.panel ? "panel" : "",
    figure ? `has-fig fig-${layout}` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  // Beside the copy, or under it. The split puts the two in one row and lets
  // them fall back to one column on a narrow screen; the stacked layouts leave
  // the block's own content untouched and add the figure after it.
  const content =
    figure && (layout === "left" || layout === "right") ? (
      <div className={`split to-${layout}`}>
        {/* Copy first in the markup whichever side it ends up on. A screen
            reader gets the headline before the photograph, and on a phone the
            columns collapse into that same order rather than opening the page
            with an image and the promise below the fold. */}
        <div className="split-body">{el.props.children}</div>
        <div className="split-fig">
          {figure}
          {block.caption ? <p className="lp-caption">{block.caption}</p> : null}
        </div>
      </div>
    ) : (
      <>
        {el.props.children}
        {figure ? (
          <div className={`fig fig-${layout}`}>
            {figure}
            {block.caption ? <p className="lp-caption">{block.caption}</p> : null}
          </div>
        ) : null}
      </>
    );

  return cloneElement(
    el,
    {
      id: el.props.id ?? block.id,
      className: classes,
      style: { ...(el.props.style ?? {}), ...(bg ?? {}) },
    },
    <>
      {block.bgVideoUrl ? <BgVideo url={block.bgVideoUrl} /> : null}
      <Scrim block={block} />
      {content}
    </>,
  );
}

/**
 * Sideways scrolling, made to work with an ordinary mouse.
 *
 * A trackpad can already scroll a row horizontally; a wheel cannot, and a page
 * that only moves for half the visitors is not a page. The handler hands the
 * gesture back to any section that still has somewhere vertical to go, so a
 * tall panel inside a sideways page keeps reading normally.
 */
export const HSCROLL = `(function(){var r=document.getElementById("lp-root");if(!r)return;var s=r.getAttribute("data-scroll")==="right"?-1:1;r.addEventListener("wheel",function(e){if(!e.deltaY)return;var n=e.target;while(n&&n!==r){if(n.scrollHeight>n.clientHeight+1&&n.scrollTop+n.clientHeight<n.scrollHeight-1&&e.deltaY>0)return;if(n.scrollHeight>n.clientHeight+1&&n.scrollTop>1&&e.deltaY<0)return;n=n.parentNode}e.preventDefault();r.scrollLeft+=e.deltaY*s;},{passive:false});})();`;

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

  // Where the menu sits decides how much room the page has to leave for it.
  const menu = blocks.find((b) => b.type === "menu");
  const menuAt = menu ? (menu.placement ?? "top") : "";

  const scroll = t.scroll === "left" || t.scroll === "right" ? t.scroll : "down";
  const pageImage = t.bgImageUrl ? t.bgImageUrl.trim() : "";
  const pageVideo = t.bgVideoUrl ? t.bgVideoUrl.trim() : "";

  const vars = {
    "--lp-bg": t.bg,
    "--lp-surface": t.surface,
    "--lp-text": t.text,
    "--lp-muted": t.muted,
    "--lp-accent": t.accent,
    "--lp-accent-soft": t.accentSoft,
    "--lp-radius": `${t.radius}px`,
    "--lp-font": `${t.font}, ui-sans-serif, system-ui, sans-serif`,
    ...(pageImage ? { "--lp-page-image": `url(${JSON.stringify(pageImage)})` } : {}),
    ...((pageImage || pageVideo) && t.bgOverlay
      ? { "--lp-page-scrim": String(Math.min(1, t.bgOverlay)) }
      : {}),
  } as React.CSSProperties;

  return (
    <>
      <div
        id="lp-root"
        className="lp"
        data-mode={t.mode}
        data-density={t.density}
        data-scroll={scroll}
        {...(pageImage || pageVideo
          ? { "data-page-bg": t.bgFixed === false ? "scroll" : "fixed" }
          : {})}
        {...(t.panels ? { "data-panels": "1" } : {})}
        {...(menuAt ? { "data-menu": menuAt } : {})}
        style={vars}
      >
        {pageVideo ? (
          <video
            className="lp-pagevideo"
            src={pageVideo}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            aria-hidden="true"
          />
        ) : null}
        {blocks.map((b, i) => (
          <One key={b.id} block={b} index={i} ctx={ctx} />
        ))}
      </div>
      {scroll === "down" ? null : <script dangerouslySetInnerHTML={{ __html: HSCROLL }} />}
    </>
  );
}
