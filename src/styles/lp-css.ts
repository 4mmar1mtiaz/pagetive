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
.lp .center .lead { margin-left: auto; margin-right: auto; }

.lp .hero { padding-top: calc(var(--lp-pad) * 1.3); }
.lp .hero::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(1200px 520px at 50% -10%, var(--lp-shade), transparent 70%);
}
.lp .hero > * { position: relative; z-index: 1; }

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

@media (max-width: 640px) {
  .lp { --lp-pad: 56px; }
  .lp section { padding-left: 18px; padding-right: 18px; }
}
`;
