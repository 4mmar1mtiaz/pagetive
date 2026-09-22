/**
 * The published-page stylesheet, as a string rather than a .css file.
 *
 * It lives here so there is exactly one copy of it. The page injects it inline
 * (a landing page should not make a second request before it can paint), and
 * the exporter writes the same string into the downloaded HTML. A .css file
 * would need to be read off disk at runtime, which stops working the moment
 * this is bundled for a serverless host.
 */
export const LP_CSS = `/* Published landing page styling.
 *
 * Every visual decision reads from a CSS variable that the theme tokens set, so
 * one stylesheet renders every customer's page. That is what makes the block
 * model worth having: restyling a page is a token change, not a rebuild, and a
 * variant can change copy without touching layout. */

.lp {
  --lp-bg: #0a0c10;
  --lp-surface: #12151b;
  --lp-text: #eef1f5;
  --lp-muted: #98a2b0;
  --lp-accent: #c9d2dc;
  --lp-accent-soft: #7d8794;
  --lp-radius: 16px;
  --lp-pad: 96px;
  --lp-maxw: 1080px;

  background: var(--lp-bg);
  color: var(--lp-text);
  font-family: var(--lp-font, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, sans-serif);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

.lp[data-density="tight"] { --lp-pad: 64px; }
.lp[data-density="roomy"] { --lp-pad: 128px; }
.lp[data-mode="light"] { --lp-shade: rgba(0, 0, 0, 0.06); }
.lp { --lp-shade: rgba(255, 255, 255, 0.06); }

.lp * { box-sizing: border-box; }
.lp section { padding: var(--lp-pad) 24px; position: relative; }
.lp .wrap { max-width: var(--lp-maxw); margin: 0 auto; }
.lp .narrow { max-width: 760px; margin: 0 auto; }

.lp h1, .lp h2, .lp h3 { margin: 0 0 .5em; line-height: 1.1; letter-spacing: -0.02em; font-weight: 650; }
.lp h1 { font-size: clamp(2.4rem, 5.5vw, 4rem); }
.lp h2 { font-size: clamp(1.8rem, 3.4vw, 2.6rem); }
.lp h3 { font-size: 1.15rem; }
.lp p { margin: 0 0 1em; color: var(--lp-muted); font-size: 1.05rem; }
.lp .lead { font-size: 1.2rem; max-width: 60ch; }
.lp a { color: inherit; }

.lp .eyebrow {
  display: inline-block;
  font-size: .78rem;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: var(--lp-accent);
  border: 1px solid var(--lp-shade);
  border-radius: 999px;
  padding: 6px 14px;
  margin-bottom: 20px;
  background: var(--lp-shade);
}

.lp .btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 15px 28px;
  border-radius: calc(var(--lp-radius) * .75);
  background: var(--lp-accent);
  color: #0a0c10;
  font-weight: 600;
  font-size: 1rem;
  text-decoration: none;
  border: 0;
  cursor: pointer;
  transition: transform .15s ease, box-shadow .15s ease, opacity .15s ease;
  box-shadow: 0 10px 30px -12px rgba(0, 0, 0, .8);
}
.lp .btn:hover { transform: translateY(-1px); opacity: .93; }
.lp .btn.ghost {
  background: transparent;
  color: var(--lp-text);
  border: 1px solid var(--lp-shade);
  box-shadow: none;
}
.lp .cta-row { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; margin-top: 8px; }
.lp .cta-note { color: var(--lp-muted); font-size: .88rem; margin: 14px 0 0; }

.lp .center { text-align: center; }
.lp .center .cta-row { justify-content: center; }
.lp .block-cta { margin-top: 32px; }
.lp .wrap.center .block-cta .cta-row, .lp .narrow .block-cta .cta-row { justify-content: center; }
.lp .center .lead { margin-left: auto; margin-right: auto; }

.lp .hero { padding-top: calc(var(--lp-pad) * 1.3); }
.lp .hero::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(1200px 520px at 50% -10%, var(--lp-shade), transparent 70%);
}
.lp .hero.has-bg-image::after { display: none; }
.lp .hero > *:not(.lp-scrim, .lp-bgvideo) { position: relative; z-index: 1; }

.lp .grid { display: grid; gap: 20px; }
.lp .g2 { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
.lp .g3 { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.lp .g4 { grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }

.lp .card {
  background: var(--lp-surface);
  border: 1px solid var(--lp-shade);
  border-radius: var(--lp-radius);
  padding: 26px;
}
.lp .card h3 { margin-bottom: 8px; }
.lp .card p { margin: 0; font-size: .97rem; }
.lp .icon { font-size: 1.6rem; display: block; margin-bottom: 12px; }

.lp .alt { background: var(--lp-surface); }

.lp .stat { text-align: center; }
.lp .stat .value {
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 680;
  letter-spacing: -0.03em;
  color: var(--lp-text);
}
.lp .stat .label { color: var(--lp-muted); font-size: .92rem; }

.lp .step { display: flex; gap: 18px; align-items: flex-start; }
.lp .step .n {
  flex: 0 0 40px;
  height: 40px;
  border-radius: 999px;
  border: 1px solid var(--lp-shade);
  display: grid;
  place-items: center;
  font-weight: 650;
  color: var(--lp-accent);
}

.lp blockquote { margin: 0; font-size: 1.05rem; }
.lp .who { margin-top: 14px; color: var(--lp-muted); font-size: .9rem; }

.lp .plan { display: flex; flex-direction: column; }
.lp .plan .price { font-size: 2.4rem; font-weight: 680; letter-spacing: -0.03em; }
.lp .plan .period { color: var(--lp-muted); font-size: .95rem; }
.lp .plan ul { list-style: none; padding: 0; margin: 18px 0; display: grid; gap: 10px; }
.lp .plan li { color: var(--lp-muted); font-size: .95rem; padding-left: 22px; position: relative; }
.lp .plan li::before { content: "✓"; position: absolute; left: 0; color: var(--lp-accent); }
.lp .plan.highlight { border-color: var(--lp-accent); box-shadow: 0 0 0 1px var(--lp-accent) inset; }
.lp .plan .btn { margin-top: auto; justify-content: center; }

.lp details {
  border-bottom: 1px solid var(--lp-shade);
  padding: 18px 0;
}
.lp summary { cursor: pointer; font-weight: 600; list-style: none; display: flex; justify-content: space-between; gap: 16px; }
.lp summary::-webkit-details-marker { display: none; }
.lp summary::after { content: "+"; color: var(--lp-accent); }
.lp details[open] summary::after { content: "-"; }
.lp details p { margin: 12px 0 0; }

.lp form { display: grid; gap: 14px; }
.lp label { display: grid; gap: 6px; font-size: .88rem; color: var(--lp-muted); }
.lp input, .lp textarea, .lp select {
  width: 100%;
  padding: 14px 16px;
  border-radius: calc(var(--lp-radius) * .6);
  border: 1px solid var(--lp-shade);
  background: rgba(255, 255, 255, .03);
  color: var(--lp-text);
  font: inherit;
  font-size: 1rem;
}
.lp[data-mode="light"] input, .lp[data-mode="light"] textarea, .lp[data-mode="light"] select {
  background: rgba(0, 0, 0, .03);
}
.lp input:focus, .lp textarea:focus, .lp select:focus { outline: 2px solid var(--lp-accent); outline-offset: 1px; }
.lp textarea { min-height: 120px; resize: vertical; }
.lp .form-card { max-width: 560px; margin: 0 auto; }
.lp .form-error { color: #ff8f8f; font-size: .9rem; margin: 0; }
.lp .form-done { text-align: center; padding: 32px 0; }
.lp .form-done .tick { font-size: 2.4rem; display: block; margin-bottom: 12px; color: var(--lp-accent); }

.lp .cal-frame {
  width: 100%;
  border: 1px solid var(--lp-shade);
  border-radius: var(--lp-radius);
  background: var(--lp-surface);
  overflow: hidden;
}
.lp .cal-empty { padding: 48px 24px; text-align: center; color: var(--lp-muted); }

.lp footer { padding: 40px 24px; border-top: 1px solid var(--lp-shade); color: var(--lp-muted); font-size: .9rem; }
.lp footer .wrap { display: flex; flex-wrap: wrap; gap: 16px; justify-content: space-between; align-items: center; }
.lp footer a { color: var(--lp-muted); text-decoration: none; margin-right: 16px; }
.lp footer a:hover { color: var(--lp-text); }

.lp .logos { display: flex; flex-wrap: wrap; gap: 28px 44px; justify-content: center; align-items: center; opacity: .7; }
.lp .logos span { font-size: 1.05rem; font-weight: 600; letter-spacing: .02em; }
.lp .logos .lp-logo { height: 34px; width: auto; object-fit: contain; }

/* Uploaded media. Height is capped rather than fixed so a portrait phone photo
   and a 4K screenshot both sit inside the section instead of one of them
   taking over the page. */
.lp .lp-media { display: block; width: 100%; max-width: 900px; max-height: 70vh; height: auto; margin: 0 auto; border-radius: var(--lp-radius); object-fit: contain; }
.lp .lp-media.fit-cover { object-fit: cover; height: 100%; }
.lp .lp-caption { margin: 12px 0 0; font-size: .95rem; opacity: .7; }

/* ---------------------------------------------------------------------------
 * Placement.
 *
 * Where a block's picture, video, embed or form goes. The block itself does not
 * know: it renders its copy, and the placement wraps the two together. That is
 * what makes "a photograph down the left of the features grid" a field rather
 * than a new block type.
 */
.lp .fig { margin: 36px auto 0; max-width: var(--lp-maxw); }
.lp .fig.fig-wide > .lp-media { max-width: none; max-height: 78vh; }
/* Edge to edge: the section gives its own side padding back. */
.lp .fig.fig-full { max-width: none; margin-left: -24px; margin-right: -24px; }
.lp .fig.fig-full > .lp-media { max-width: none; max-height: none; border-radius: 0; }
.lp .fig.fig-full > .lp-caption { padding: 0 24px; }
/* A side menu has already taken that padding for itself. */
.lp[data-menu="left"] .fig.fig-full, .lp[data-menu="right"] .fig.fig-full { margin-left: 0; margin-right: 0; }
.lp .fig .form-card, .lp .fig .cal-frame { margin-left: auto; margin-right: auto; }

.lp .split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: clamp(28px, 4vw, 56px);
  align-items: center;
  max-width: var(--lp-maxw);
  margin: 0 auto;
}
.lp .split > .split-fig { min-width: 0; }
.lp .split > .split-body { min-width: 0; }
/* The copy is written first; "left" moves the figure across it. */
.lp .split.to-left > .split-fig { order: -1; }
.lp .split .lp-media { max-width: 100%; max-height: 70vh; }
.lp .split .wrap, .lp .split .narrow { max-width: none; margin: 0; }
.lp .split .form-card { max-width: none; margin: 0; }
/* Half a page is a column, and a column reads left. Centred copy is a full
 * width decision; carrying it into a split is how a heading ends up floating in
 * the middle of nothing with a photograph next to it. */
.lp .split > .split-body, .lp .split > .split-body .center { text-align: left; }
.lp .split > .split-body .cta-row { justify-content: flex-start; }
.lp .split > .split-body .lead { margin-left: 0; margin-right: 0; }
.lp .split .grid { margin-top: 0 !important; }
/* One column. Three cards in half a page is two columns and an orphan, which is
 * the thing the grid rules exist to prevent. */
.lp .split .grid { grid-template-columns: 1fr; }

@media (max-width: 720px) {
  /* One column, copy first. Nothing sits beside anything on a phone. */
  .lp .split { grid-template-columns: 1fr; }
  .lp .split.to-left > .split-fig { order: 0; }
}

/* A picture on a grid item: a screenshot above a feature, a face beside a
 * quote, a logo in a row. All three were always in the block reference. */
.lp .card .item-media {
  display: block;
  width: 100%;
  height: 160px;
  object-fit: cover;
  border-radius: calc(var(--lp-radius) * .6);
  margin-bottom: 16px;
}
.lp .who { display: flex; align-items: center; gap: 10px; }
.lp .who-face { width: 36px; height: 36px; border-radius: 999px; object-fit: cover; flex: 0 0 36px; }

/* Video behind a section, and behind the whole page. Muted, looping, and
 * underneath everything: it is a background, not a player. */
.lp .lp-bgvideo, .lp .lp-pagevideo {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  border: 0;
}
.lp .lp-pagevideo { position: fixed; z-index: -1; }
.lp[data-page-bg="scroll"] .lp-pagevideo { position: absolute; }
.lp section.has-bg-video { background: var(--lp-bg); }
.lp .hero.has-bg-video::after { display: none; }

@media (prefers-reduced-motion: reduce) {
  /* A looping video behind the copy is motion nobody asked for twice. */
  .lp .lp-bgvideo, .lp .lp-pagevideo { display: none; }
}

/* ---------------------------------------------------------------------------
 * Backgrounds.
 *
 * The image itself is an inline style, because its URL is the user's and cannot
 * live in a stylesheet. Everything around it is a class, so a picture behaves
 * the same way on every block that carries one.
 *
 * The scrim is a real element rather than a gradient on the section, because a
 * section's background is already spoken for by the picture. It sits first in
 * the section and is the only positioned child without a z-index, so the copy
 * paints over it by document order.
 */
.lp .lp-scrim {
  position: absolute;
  inset: 0;
  background: var(--lp-bg);
  pointer-events: none;
}
.lp footer.has-bg, .lp .lp-menu.has-bg { position: relative; }
.lp section.has-bg > *:not(.lp-scrim, .lp-bgvideo),
.lp footer.has-bg > *:not(.lp-scrim, .lp-bgvideo),
.lp .lp-menu.has-bg > *:not(.lp-scrim, .lp-bgvideo) { position: relative; }
.lp section.has-bg-video > *:not(.lp-scrim, .lp-bgvideo) { position: relative; }
.lp section.has-bg-image { color: var(--lp-text); }

/* A glass panel. The content floats; the picture behind it stays readable as a
 * picture, which is the whole point of asking for one. */
.lp section.panel > .wrap,
.lp section.panel > .narrow,
.lp section.panel > .form-card,
.lp[data-panels="1"] section > .wrap,
.lp[data-panels="1"] section > .narrow,
.lp[data-panels="1"] section > .form-card {
  background: color-mix(in srgb, var(--lp-surface) 62%, transparent);
  border: 1px solid var(--lp-shade);
  border-radius: var(--lp-radius);
  padding: clamp(24px, 4vw, 48px);
  backdrop-filter: blur(14px) saturate(120%);
  -webkit-backdrop-filter: blur(14px) saturate(120%);
}
.lp section.panel > .form-card,
.lp[data-panels="1"] section > .form-card { max-width: 620px; }

/* Cards inside a glass panel would be glass on glass. */
.lp[data-panels="1"] .card,
.lp section.panel .card { background: color-mix(in srgb, var(--lp-surface) 70%, transparent); }

/* One picture behind the entire page. Fixed by default: it is the thing the
 * content is supposed to float over. */
.lp[data-page-bg] { position: relative; isolation: isolate; }
.lp[data-page-bg]::before,
.lp[data-page-bg]::after {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
}
.lp[data-page-bg]::before {
  background-image: var(--lp-page-image);
  background-size: cover;
  background-position: center;
}
.lp[data-page-bg]::after { background: var(--lp-bg); opacity: var(--lp-page-scrim, 0); }
.lp[data-page-bg="scroll"]::before,
.lp[data-page-bg="scroll"]::after { position: absolute; }
/* With a picture behind the whole page, the alternating surface would cover it
 * up section by section. The page background wins; a section that was given its
 * own picture or colour still wins over the page. */
.lp[data-page-bg] section:not(.has-bg) { background: transparent; }
.lp[data-page-bg] .hero::after { display: none; }

/* ---------------------------------------------------------------------------
 * The menu.
 *
 * Five placements, because a menu is one of the few things people have a real
 * opinion about. Top and bottom are bars; left and right are boxes down the
 * edge of the screen and the page reserves a gutter for them; inline simply
 * renders where the block sits.
 */
.lp .lp-menu {
  z-index: 40;
  padding: 14px 24px;
  background: color-mix(in srgb, var(--lp-bg) 78%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--lp-shade);
  border-width: 0 0 1px;
}
.lp .menu-inner {
  max-width: var(--lp-maxw);
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
}
.lp .menu-brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 650; text-decoration: none; }
.lp .menu-logo { height: 28px; width: auto; display: block; }
.lp .menu-links { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; }
.lp .menu-links a { color: var(--lp-muted); text-decoration: none; font-size: .95rem; }
.lp .menu-links a:hover { color: var(--lp-text); }
.lp .menu-cta { margin-left: auto; padding: 10px 18px; font-size: .92rem; }

.lp .lp-menu.at-top.sticky { position: sticky; top: 0; }
.lp .lp-menu.at-bottom {
  border-width: 1px 0 0;
  order: 999;
}
.lp .lp-menu.at-bottom.sticky { position: sticky; bottom: 0; }

.lp .lp-menu.at-left,
.lp .lp-menu.at-right {
  position: fixed;
  top: 24px;
  bottom: 24px;
  width: 232px;
  border-width: 1px;
  border-radius: var(--lp-radius);
  padding: 24px;
  overflow-y: auto;
}
.lp .lp-menu.at-left { left: 24px; }
.lp .lp-menu.at-right { right: 24px; }
.lp .lp-menu.at-left .menu-inner,
.lp .lp-menu.at-right .menu-inner { flex-direction: column; align-items: flex-start; gap: 18px; height: 100%; }
.lp .lp-menu.at-left .menu-links,
.lp .lp-menu.at-right .menu-links { flex-direction: column; align-items: flex-start; gap: 14px; }
.lp .lp-menu.at-left .menu-cta,
.lp .lp-menu.at-right .menu-cta { margin: auto 0 0; }

/* The gutter a side menu needs. Without it the first column of every section
 * sits under the menu, which looks like a rendering bug rather than a layout.
 *
 * On the sections rather than on the page, because in a sideways page the page
 * is the scroll container: padding at its start is scrolled straight past the
 * moment the first column snaps into place, and the menu lands on the
 * headline. Padding each section survives the snap. */
.lp[data-menu="left"] section,
.lp[data-menu="left"] footer { padding-left: 288px; }
.lp[data-menu="right"] section,
.lp[data-menu="right"] footer { padding-right: 288px; }

/* ---------------------------------------------------------------------------
 * Sideways pages.
 *
 * Sections become columns. Each one is its own scroll container vertically, so
 * a panel with more in it than fits still reads, and the row snaps so a column
 * does not come to rest halfway off the screen.
 */
.lp[data-scroll="left"],
.lp[data-scroll="right"] {
  display: flex;
  flex-direction: row;
  height: 100vh;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x proximity;
  scroll-behavior: smooth;
}
.lp[data-scroll="right"] { flex-direction: row-reverse; }
.lp[data-scroll="left"] > section,
.lp[data-scroll="right"] > section,
.lp[data-scroll="left"] > footer,
.lp[data-scroll="right"] > footer {
  flex: 0 0 auto;
  width: min(100vw, 1100px);
  height: 100vh;
  overflow-y: auto;
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
/* A menu in a sideways page is pinned, never a column of its own. */
.lp[data-scroll="left"] > .lp-menu.at-top,
.lp[data-scroll="right"] > .lp-menu.at-top { position: fixed; top: 0; left: 0; right: 0; }
.lp[data-scroll="left"] > .lp-menu.at-bottom,
.lp[data-scroll="right"] > .lp-menu.at-bottom { position: fixed; bottom: 0; left: 0; right: 0; }
.lp[data-scroll="left"] > .lp-menu.at-inline,
.lp[data-scroll="right"] > .lp-menu.at-inline { flex: 0 0 auto; align-self: flex-start; }

@media (max-width: 900px) {
  /* A fixed side menu on a phone is a wall. It becomes a bar at the top, and
     the page stops reserving a gutter that no longer exists. */
  .lp .lp-menu.at-left,
  .lp .lp-menu.at-right {
    position: static;
    width: auto;
    border-radius: 0;
    border-width: 0 0 1px;
    padding: 14px 18px;
  }
  .lp .lp-menu.at-left .menu-inner,
  .lp .lp-menu.at-right .menu-inner { flex-direction: row; align-items: center; gap: 16px; }
  .lp .lp-menu.at-left .menu-links,
  .lp .lp-menu.at-right .menu-links { flex-direction: row; gap: 16px; }
  .lp .lp-menu.at-left .menu-cta,
  .lp .lp-menu.at-right .menu-cta { margin: 0 0 0 auto; }
  .lp[data-menu="left"] section,
  .lp[data-menu="left"] footer { padding-left: 24px; }
  .lp[data-menu="right"] section,
  .lp[data-menu="right"] footer { padding-right: 24px; }

  /* Sideways reads badly in one hand. A narrow screen gets the ordinary page. */
  .lp[data-scroll="left"],
  .lp[data-scroll="right"] { display: block; height: auto; overflow: visible; }
  .lp[data-scroll="left"] > section,
  .lp[data-scroll="right"] > section,
  .lp[data-scroll="left"] > footer,
  .lp[data-scroll="right"] > footer { width: auto; height: auto; overflow: visible; display: block; }
}

@media (max-width: 640px) {
  .lp { --lp-pad: 56px; }
  .lp section { padding-left: 18px; padding-right: 18px; }
}

@media (prefers-reduced-motion: reduce) {
  .lp[data-scroll="left"],
  .lp[data-scroll="right"] { scroll-behavior: auto; }
  .lp section.has-bg-image { background-attachment: scroll !important; }
}
`;
