# Deploying

Two documented targets. **If you have Vercel Pro, use Vercel** — the difference
is not close, and the reason is domains. See the comparison at the bottom.

# Deploying to Railway

The app is Postgres-backed and binds to `$PORT`, so Railway needs no special
handling. Migrations run automatically on every boot — `start` is
`prisma migrate deploy && next start`.

I have not touched your Railway or GitHub account. These are the steps to run
yourself.

## 1. Get the code into a repo

```bash
cd ~/adaptive-lp/app
git init && git add -A && git commit -m "adaptive lp"
# then push to a new private repo
```

`.env` is not in `.gitignore` yet and **contains your Anthropic key** — add it
before the first commit:

```bash
printf '.env\nnode_modules\n.next\n' >> .gitignore
```

## 2. Create the project

Railway → New Project → Deploy from GitHub repo → pick it.

Then **+ New → Database → PostgreSQL** in the same project.

## 3. Environment variables

On the app service, Variables tab. The two database ones use Railway's
reference syntax so they track the database service:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `DIRECT_URL` | `${{Postgres.DATABASE_URL}}` |
| `ANTHROPIC_API_KEY` | your key |
| `APP_URL` | the Railway domain, once generated — see step 4 |

Optional, add when you want the feature:

| Variable | What it turns on |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` | sign-in, accounts, plan limits |
| `ADMIN_EMAILS` | comma-separated; who can open `/admin` |
| `WILDCARD_ROOT` | e.g. `lp.yourdomain.com` — instant subdomains |
| `APP_HOSTS` | extra hostnames the app itself answers on, comma separated |
| `PLAN_WEBHOOK_SECRET` | the upgrade webhook |
| `RESEND_API_KEY` + `RESEND_FROM` | emailed lead notifications |

`DIRECT_URL` is the same value as `DATABASE_URL` on Railway, which hands out one
connection string. The field exists because the schema declares it, and because
on Supabase or Neon the two genuinely differ (pooled vs session). **The Prisma
client refuses to start if it is missing**, even though only migrations use it.

## 4. Domain

Settings → Networking → Generate Domain. Copy it into `APP_URL` and redeploy —
`APP_URL` is what export links, published URLs and DNS instructions print.

## 5. Verify

Open `/api/health`. It reports every environment variable (presence, never the
value), the database connection, every table's row count, and whether a pool
starved. Safe to open publicly and paste into a chat.

Expect one warning until you add Clerk:

> **Clerk NOT configured — the workspace is OPEN to anyone with the URL.**

That is accurate. Published pages are meant to be public; the workspace is not.
Add the Clerk keys before you share the URL with anyone, or keep the deployment
private while testing.

### Clerk: test keys are not production keys

`pk_test_` / `sk_test_` keys belong to a Clerk **development instance**. They
work, and they are what is configured now, but before real customers:

- Development instances are capped at 100 users and their sessions are not
  meant for production traffic.
- Create a **production instance** in Clerk, point it at your domain, and
  replace both keys. They start `pk_live_` / `sk_live_`.
- Users do not transfer between instances. Do the swap before anyone signs up
  who matters, or you will be migrating accounts by hand.

## 6. Who can administer it

`ADMIN_EMAILS` decides who sees `/admin` — the screen listing every account with
its plan, page limit, usage and AI spend, where you change plans, override
limits per account, and suspend people.

It is an environment variable rather than a database flag on purpose: there is
no first-admin bootstrapping problem, and promoting someone is a deploy rather
than a button. For a role that can change everyone's billing, that is the right
amount of friction. Nobody can promote themselves through the app.

## 7. Subdomains, and what your Railway plan allows

Railway's custom-domain allowance is the binding constraint here, and it is per
plan, not per project:

| Railway plan | Custom domains per service |
|---|---|
| Trial | **1** |
| Hobby ($5/mo) | 2 (no increase available) |
| Pro | 20, increasable on request |

A **wildcard counts as one domain**, and Railway supports wildcards at any
subdomain depth (`*.lp.yourdomain.com` is fine; `*.*.yourdomain.com` is not).
A wildcard needs both the CNAME **and** the TXT record Railway shows, or it
never verifies.

That single fact decides your setup.

### On the Trial plan: one wildcard, and it works

You get one slot. Spend it on the wildcard, not on the app:

- Run the app on the free `*.up.railway.app` hostname Railway gives you, or on
  a Cloudflare-proxied host.
- Point your one custom domain at `*.lp.yourdomain.com`.
- Set `WILDCARD_ROOT="lp.yourdomain.com"`.

Every published page then gets `its-slug.lp.yourdomain.com` **automatically, on
publish, with no DNS work by anybody** — that is what `WILDCARD_ROOT` plus the
auto-assignment in `publish_page` is for. One record, unlimited customer pages,
zero marginal cost. This is the configuration a self-serve product on a free
plan should run.

A wildcard does **not** cover the bare domain, so `lp.yourdomain.com` itself is
a separate entry. On Trial you cannot have both; on Hobby you can.

### What does NOT work on a free plan

A customer pointing **their own** domain at you (`offer.theircompany.com`)
needs its own certificate, which means its own entry in Railway. One slot means
one such customer, ever. The app builds the whole DNS side of this — it prints
the exact CNAME and verifies it live — but the certificate is Railway's job and
Railway is counting.

If that becomes a real requirement, the answer is not a bigger Railway plan, it
is **Cloudflare for SaaS** in front: customers CNAME to Cloudflare, Cloudflare
issues per-hostname certificates, and Railway keeps seeing one origin. That is
the product built for this exact problem. Until somebody actually asks for it,
your own wildcard subdomains cover the self-serve case completely.

## Things that will bite

**Do not scale past one replica yet.** The spam rate limiter keeps its counters
in memory (`src/lib/ratelimit.ts`), so two instances each allow the full budget.
Swap it for a shared store before scaling out.

**Turn on database backups.** Railway's Postgres has them; the leads in there
are the whole point of the product.

**Watch event volume.** Analytics are computed live from raw events. Past a few
hundred thousand events on a single page the report gets slow and needs a
nightly rollup table. `/api/health` shows the row count.

**The first deploy runs migrations against an empty database.** That is normal;
`prisma migrate deploy` creates every table. Your local Postgres data does not
travel with the code.


---

# Deploying to Vercel

Everything the app needs works on Vercel, and the domain allowance is the reason
to prefer it. Three things differ from Railway.

## 1. Postgres is not included

Vercel does not host the database. Use Neon or Supabase, both of which have a
free tier that suits this. Take the **pooled** connection string for
`DATABASE_URL` and the **direct** one for `DIRECT_URL`. Getting these the wrong
way round produces migrations that hang and no useful error.

## 2. Function duration

The chat route runs a multi-turn agent loop, and a page build with the editor
pass takes 60 to 120 seconds. Vercel's limits with fluid compute:

| Plan | Default | Maximum |
|---|---|---|
| Hobby | 300s | 300s |
| Pro | 300s | 800s (1800s extended) |

`src/app/api/chat/route.ts` already exports `maxDuration = 300`, which is inside
the default on every plan. Raise it toward 800 only if you start seeing long
builds cut off.

## 3. Serverless changes two things in the code, and both are handled

- **Connection pooling inverts.** On a long-lived server a bigger client pool is
  better; on serverless each concurrent invocation is its own process with its
  own pool, so a large floor exhausts the database. `src/lib/db.ts` detects
  `VERCEL` and leaves the pooler URL exactly as given.
- **In-memory rate limiting stops working**, because an attacker's requests land
  on fresh instances. The lead endpoint therefore also counts prior submissions
  in the database against a salted hash of the address, which is correct on any
  number of instances. Set `IP_HASH_SALT` to anything private.

## Domains: the actual reason to choose Vercel

| | Railway Trial | Railway Hobby | **Vercel Pro** |
|---|---|---|---|
| Custom domains | 1 | 2 | **100,000 per project** |
| Wildcard | yes, counts as 1 | yes | yes |
| Customer-owned domains | not viable | not viable | **viable** |

A wildcard on Vercel must use the **nameserver method**: Vercel has to control
DNS for that domain in order to answer the challenge a wildcard certificate
requires. Two ways to satisfy that without moving your main site's DNS:

- Delegate only the subdomain. Add `lp.yourdomain.com` in Vercel and point NS
  records for `lp` at the nameservers it gives you. Your root domain keeps the
  DNS it has now.
- Or move the whole domain's nameservers to Vercel, which is the path their
  documentation describes directly.

Confirm which one your setup allows in the dashboard before relying on it.

With Pro, customer-owned hostnames also stop being a special case: 100,000
domains means every client can point their own domain at you, and Vercel's
Domains API can register each hostname programmatically as it is attached. The
app already does the DNS half. Wiring the registration call is a small piece of
work and needs a `VERCEL_API_TOKEN`.
