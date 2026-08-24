# Adaptive LP

Describe a landing page in chat. It gets built, hosted, tracked, and it keeps
testing itself.

One Postgres database, one Next process. No analytics vendor, no CDN, no page
builder — the only outbound calls are to Anthropic for generation and whatever
CRM webhook you configure yourself.

## Run it

```bash
cd ~/adaptive-lp/app
createdb adaptive_lp_dev            # local Postgres
npx prisma migrate deploy
# put your key in .env: ANTHROPIC_API_KEY="sk-ant-..."
npm run dev                         # http://localhost:4400
```

Deploying: see `DEPLOY.md` (Railway). `/api/health` reports what a deployment is
missing, in one request, without printing any secret's value.

## What the three panes are

**Left** — pages you have built and past chat threads.
**Middle** — the chat. This is the whole authoring interface; there is no
separate editor to learn.
**Right** — the page itself: live preview, live numbers, and the four settings
that decide where a form fill ends up.

Full analytics with the heatmap live at `/pages/{id}` (the "Heatmap" button
under the preview).

## What you can say to it

- "Booking page for a mobile detailing business in Dallas, same-day slots, form and calendar."
- "Import https://theirsite.com/offer and tell me what's weak about it."
- "Generate variants for price, speed and guarantee, then publish."
- "Send form fills to https://hooks.zapier.com/... and email me at me@co.com."
- "Which section loses people?"

It builds as a **draft**. Nothing is public until you say publish.

## How the adaptive part actually works

A page is stored as **typed blocks, never HTML**. That single constraint is what
makes everything else possible: a variant overrides one field of one block
instead of replacing a document.

Routing is two layers, and keeping them separate is the point:

> **Intent decides which angle is allowed. Statistics decide which version of
> that angle gets served.**

1. `?v=<variantId>` — explicit preview, always wins.
2. **Match rules select the eligible pool.** A variant with a rule is served
   only when its rule fires (`utm_content` contains "same-day", `seg` is
   "cold", anything), and is **withheld from everyone else** — so a promise
   written for one ad never leaks into general traffic, and the optimizer can
   never overrule a promise you actually made.
3. **Sticky assignment** — a returning visitor keeps their version if it is
   still eligible. General assignments survive a detour through a campaign
   link, so a browse → ad click → browse sequence does not re-roll them.
4. **Thompson sampling within the pool** — traffic goes to each eligible
   variant in proportion to how likely it is to be best. New variants get 100
   guaranteed impressions first, and nothing ever takes more than 80%, so a
   decaying winner is still detectable. Run three versions of one angle and
   you still learn which of the three works.

All of it resolves server-side before first paint. No flicker, ever.

## What gets measured

The tracker (`/api/tracker`, injected only on live pages) records: view, scroll
depth, per-block attention via IntersectionObserver, clicks with normalised
coordinates, CTA clicks, and form starts. Conversions are written server-side by
the lead endpoint — the browser is not trusted to report those.

Because this app renders the page, every click knows which **block** it hit. The
heatmap has two layers:

- **Click map** — the conventional coordinate view, overlaid on the real live page.
- **Attention** — sections shaded by dwell time, labelled with reach and seconds.
  This is the one that answers "where do people stop reading".

Both can be filtered to a single variant, so you can see how visitors arriving
on the speed angle read the page differently from the guarantee angle.

## The front door

`/` serves two audiences from one route: signed in, it is the workspace; signed
out, it is the product's own landing page — **itself a page built and published
by this product**, set with `MARKETING_SLUG`. It gets variants, a funnel and
heatmaps like any customer page, so if the marketing page stops converting, the
tool that fixes that is the one serving it.

That route being public is why `currentSession()` returns an explicit anonymous
session rather than falling back to the single-user local account: the local
account is unlimited *and* admin, and handing it to a stranger would be handing
over the keys. Everything else — workspace, `/admin`, every API — stays behind
Clerk.

## Accounts and plans

Auth is Clerk, and it is optional. With no keys in `.env` the app runs as one
local account on the unlimited plan — which is how you develop and how you
self-host for yourself. Add the two keys and it becomes multi-tenant: every
account sees only its own pages, chats, leads and analytics, enforced on every
query rather than by hiding buttons.

**Today everything is free and unlimited.** `DEFAULT_PLAN` in `src/lib/plan.ts`
decides what a new account gets, and it is `"unlimited"`. The metered tier below
is fully built and enforced — it is simply not the default. Flip `DEFAULT_PLAN`
to `"trial"` and set prices on the marketing page to turn this into a business;
nothing else has to move.

| | Free trial | Unlimited |
|---|---|---|
| Landing pages | 1 (lifetime — deleting it does not refill) | unlimited |
| Build, edit, restyle, variants | yes | yes |
| Simulated traffic, heatmap, optimizer | yes | yes |
| Publish / go live | **no** | yes |
| HTML export | **no** | yes |
| Custom domains | **no** | yes |

The trial is shaped so the product proves itself first: you get a complete page
and every piece of the analytics, and the only things withheld are the two that
turn it into an asset you own. Limits are enforced in the tool layer *and* the
HTTP layer — the chat agent is a client, not a security boundary — and the agent
is told the plan up front so it explains a limit instead of hitting an error.

### The admin screen

`/admin`, visible only to addresses in `ADMIN_EMAILS`. Everyone else gets a 404
— the existence of the page is not something a customer needs confirmed.

Per account: plan, effective page limit, pages, visitors, leads, and AI spend.
You can change the plan, **override the page limit for one account** without
inventing a new plan for them, reset a lifetime page count (which hands a trial
back), and suspend or reactivate.

Suspension stops new work and deletes nothing — their live pages keep serving
and keep capturing leads. There is no delete button: it would cascade through
every page, lead and event a customer has, and the recoverable version of "make
this stop" is suspension.

Isolation is verified, not asserted — `npm run verify:isolation` creates two
accounts and asserts that all fourteen page-scoped tools refuse a page they do
not own, that listings are scoped, and that plan limits and suspension apply per
account. It exits non-zero if any of that stops being true.

**Upgrading** is a POST from wherever you collect money:

```bash
curl -X POST https://yourapp.com/api/webhooks/plan \
  -H "x-plan-secret: $PLAN_WEBHOOK_SECRET" \
  -H "content-type: application/json" \
  -d '{"email":"buyer@company.com","plan":"unlimited"}'
```

An email with no account yet creates a pending row that the first sign-in with
that address claims — so someone who pays and *then* registers lands on the plan
they bought, instead of on a trial and a support ticket.

## Spam

Three defences on the public lead endpoint, and they are not treated alike.

- **Honeypot** - a field positioned off-canvas and removed from the tab order
  and the accessibility tree, so no person can reach it. Filled means a bot.
- **Time to submit** - under 1.5 seconds from render is not a human reading a
  form.
- **Flood limit** - 8 submissions a minute or 40 an hour from one address.

The first two are certainties, and those submissions are discarded. The third
is not: an IP address is a poor identifier for a person, because mobile
carriers put thousands of subscribers behind one and offices put a whole
company behind one. On a page whose traffic is mostly phones, a tight per-IP
quota rejects real buyers.

So over the flood limit a lead is **stored and flagged**, not dropped - it
appears in the report as "held", but it is not forwarded to the CRM and does
not count as a conversion. That last part is the point: a junk submission does
not merely dirty the CRM, it teaches the optimizer. Enough of them and the page
genuinely optimises toward whichever variant the bots happened to land on.

Every rejected path returns success. Telling a bot why it failed tells it what
to change.

Rate-limit state is in memory, so it is per instance and resets on deploy. That
is deliberate - it stops a script, which is the job, without adding a Redis
dependency to a product that otherwise needs no external services. Swap
`src/lib/ratelimit.ts` for a shared store the day this runs on more than one
instance.

## Domains — serving pages on their own hostname

A page can live on `/p/{slug}`, or on a hostname of its own. Attach one in the
setup tab, or say "put this on offer.acme.com".

Two cases, and only one of them involves work:

**Subdomains of a root you own.** Set `WILDCARD_ROOT="lp.yourdomain.com"` in
`.env` and point one wildcard DNS record — `*.lp.yourdomain.com` — at the app,
once. Every subdomain then works the instant you attach it: no DNS per page, no
API call, no waiting. This is the setting that makes 200 client pages practical.

**A customer's own domain** (`offer.theircompany.com`). They create a CNAME at
their registrar — the app shows the exact record, split into the fields the
registrar will ask for — and "Check DNS" resolves it live to confirm. The one
thing this app cannot do for you is issue the TLS certificate: whatever hosts
this (Vercel, Cloudflare for SaaS, Caddy on a VPS) has to be told the hostname
exists. On Vercel that is one API call with a token; on Caddy it is automatic
with `on_demand_tls`.

Requests are routed by `Host` header in `src/proxy.ts`, which rewrites an
unrecognised host to `/h/{host}`; that route resolves the hostname to a page and
renders it with the same variant logic as the path route. The app's own
surfaces (`/api/*`, the workspace) stay reachable on every host, so a hosted
page can still post its leads home.

## Testing before you have traffic

You do not have to wait weeks. **Simulate 600 visitors** in the data tab (or ask
the chat for it) manufactures a realistic population: scroll depth that decays,
attention that concentrates on the conversion block, clicks that cluster on
CTAs, and a hidden true conversion rate per variant so the optimizer has a
genuine winner to find. Clear removes it without touching real traffic.

Simulated click coordinates are approximated from block order rather than
measured pixels — real traffic reports true positions. That is the one place a
simulated heatmap differs from a real one.

## Export

Unlimited accounts can download any page — or any single variant — as one
self-contained HTML file: styles inline, no build step, no framework. Drop it on
any host or hand it to a client. The form in the exported file still posts back
to this app, so leads still reach the CRM and still count as conversions; an
export that silently stopped capturing leads would be worse than no export.

The markup is produced by asking the app to render its own page and slicing out
the landing container, rather than by a second renderer that would drift from
the real one.

## What it costs

Every model call is priced and stored. `GET /api/usage` totals it; the chat
header shows the running cost of the current turn, and the setup tab shows
lifetime spend on that page.

Measured, on Opus 5: **a full page build — 8 blocks, 3 generated variants,
traffic simulation and an analytics read — is about $0.35.** Roughly 42k input
tokens and 5.5k output across six calls. Importing an existing page costs a
little more, because the source page goes into the prompt.

## Deploying

The app *is* the host. Publishing is a database flag, not a build — a new page
is live in milliseconds, and adding the thousandth page does not redeploy
anything.

`start` is `prisma migrate deploy && next start -p $PORT`, so migrations run on
every boot and the port is whatever the host assigns. Set `APP_URL` to the
deployed origin, and `WILDCARD_ROOT` if you are hosting pages on your own
subdomains. Full steps in `DEPLOY.md`.

Two things that bite: do not scale past one replica until the in-memory spam
limiter is swapped for a shared store, and the workspace is **open to anyone
with the URL** until the Clerk keys are set.

## The report

`/pages/{id}` is the dashboard. A date range across the top — 7 / 30 / 90 days,
all time, or a custom pair of dates — and every number below it respects the
range, including a comparison against the same length of time immediately
before. The range lives in the URL, so a view is shareable and survives a
reload. It can also be filtered to a single version.

What it shows:

- **Headline numbers** — people, conversions, conversion rate, median time on
  page, returning visitors, leads captured, each with its change vs the previous
  period.
- **Two time charts** — people per day and conversions per day, hover for any
  day. Deliberately two single-series charts rather than one with two y-axes:
  the measures are two orders of magnitude apart, and a second axis invents a
  crossing point that is not in the data.
- **The funnel** — landed → read past the first quarter → saw the form or
  booker → clicked a CTA → started the form → converted. Counted in **unique
  people, not events**, with each step shown as a share of everyone and a share
  of the previous step. The biggest single drop is called out by name, because
  that is the thing to go and fix.
- **Where they came from** — resolved from `utm_content`, `utm_campaign`, `seg`,
  `utm_source`, then referrer, then direct. Attributed to a visitor's *first*
  view, so a conversion is credited to the campaign that brought them.
- **Devices**, **section-by-section attention**, **scroll depth**, **per-version
  results**, and **recent leads with a CSV export** for the selected range.

Everything is computed live from raw events. There is no aggregation job to be
stale, and no second definition of "a visitor" to drift out of step with the
first.

## Leads

Order is: store → count the conversion → forward. A misconfigured CRM webhook
loses nothing; the row keeps the error and the visitor still sees a thank-you.

- **CRM webhook** — every lead POSTs as JSON. Works with GHL, Zapier, Make, n8n,
  HubSpot, anything with an inbound hook.
- **Email** — optional, needs `RESEND_API_KEY` + `RESEND_FROM` in `.env`.
- **Calendar** — paste any Cal.com / Calendly / TidyCal link; a `calendar` block
  embeds it, and any CTA pointing at `#calendar` scrolls to it.

## Layout

```
src/lib/blocks.ts      the block vocabulary + the reference the model is given
src/lib/compose.ts     which version of a page this request sees
src/lib/bandit.ts      Thompson sampling, exploration quota, 80% cap
src/lib/analytics.ts   raw events -> sections, scroll curve, heat points
src/lib/tools.ts       everything the chat agent can do
src/lib/importer.ts    somebody else's live page -> our blocks
src/app/p/[slug]       the published page
src/app/api/tracker    the tracker script, served not bundled
```

## Not built yet

Meta Ad Library ingestion (read their live ads and extract angles
automatically), automatic TLS provisioning for customer domains (the DNS half
is built, the certificate half needs your host's API token), and the weekly
agent that retires losers on its own. The optimizer exists but runs on demand —
ask the chat to "run the optimizer".
