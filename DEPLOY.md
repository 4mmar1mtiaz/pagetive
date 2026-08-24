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

## 7. Custom domains for landing pages

Two different things:

- **Your own subdomains.** Set `WILDCARD_ROOT=lp.yourdomain.com` and point
  `*.lp.yourdomain.com` at the Railway domain with one CNAME. Every subdomain
  then works instantly with no further DNS. Check whether your Railway plan
  supports a wildcard custom domain; if it does not, add each hostname in
  Railway individually — the app handles either.
- **A client's own domain.** They add the CNAME the app prints. You must also
  add that hostname in Railway's Settings → Networking so a certificate is
  issued for it. That is the one step the app cannot do for you without a
  Railway API token.

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
