/**
 * Point the app at a Supabase Postgres and bring it fully up.
 *
 * Run either way:
 *   npx tsx scripts/setup-supabase.mjs "postgresql://postgres.ref:pw@host:6543/postgres"
 *   npx tsx scripts/setup-supabase.mjs <project-ref> [region]
 *
 * Prefer pasting the whole string. Supabase's pooler hostname has changed
 * shape more than once (aws-0 vs aws-1, and the region is not always the one
 * you would guess), so the string from their dashboard is authoritative and a
 * reconstructed one is a guess.
 *
 * Two things this gets right that are easy to get wrong by hand:
 *
 *  - The password is URL-encoded. A password containing @ or / or : breaks the
 *    connection string silently, and the error you get back talks about hosts
 *    and authentication rather than about parsing.
 *  - DATABASE_URL uses the transaction pooler on 6543 and DIRECT_URL uses the
 *    session pooler on 5432. Migrations need a real session for advisory locks
 *    and transactional DDL, which a transaction pooler cannot give them, so
 *    pointing both at the same port produces migrations that hang.
 */
import "dotenv/config";
import fs from "node:fs";
import { execSync } from "node:child_process";

const [first, region = "us-east-1"] = process.argv.slice(2);
if (!first) {
  console.error("Usage:");
  console.error('  npx tsx scripts/setup-supabase.mjs "postgresql://postgres.ref:pw@host:6543/postgres"');
  console.error("  npx tsx scripts/setup-supabase.mjs <project-ref> [region]");
  process.exit(1);
}

let pooled;
let direct;

if (first.startsWith("postgres")) {
  // A pasted string is authoritative. Only two things are adjusted: the
  // password is re-encoded in case it was pasted raw, and the direct URL is
  // derived by moving to the session port.
  const url = new URL(first);
  if (process.env.SUPABASE_DB_PASSWORD && !url.password) {
    url.password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD);
  }
  url.searchParams.set("pgbouncer", "true");
  url.searchParams.set("connection_limit", "1");
  pooled = url.toString();

  const session = new URL(pooled);
  session.port = "5432";
  session.search = "";
  direct = session.toString();
} else {
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    console.error("Set SUPABASE_DB_PASSWORD in .env first (the database password, not an API key).");
    process.exit(1);
  }
  const enc = encodeURIComponent(password);
  const host = `aws-0-${region}.pooler.supabase.com`;
  pooled = `postgresql://postgres.${first}:${enc}@${host}:6543/postgres?pgbouncer=true&connection_limit=1`;
  direct = `postgresql://postgres.${first}:${enc}@${host}:5432/postgres`;
}

let env = fs.readFileSync(".env", "utf8");
const set = (key, value) => {
  const line = `${key}="${value}"`;
  env = new RegExp(`^${key}=.*$`, "m").test(env)
    ? env.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : `${env}\n${line}`;
};
set("DATABASE_URL", pooled);
set("DIRECT_URL", direct);
fs.writeFileSync(".env", env);

console.log("Wrote DATABASE_URL (pooler :6543) and DIRECT_URL (session :5432).");
console.log("Applying migrations...\n");

try {
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
} catch {
  console.error(`
Migration failed. The three things that cause this, in order of likelihood:
  1. Wrong region. Check the host in Supabase's own connection string and pass
     the region as the second argument.
  2. Wrong password. It is the database password, not an API key.
  3. The project is paused. Free Supabase projects pause after inactivity and
     have to be resumed in the dashboard first.`);
  process.exit(1);
}

console.log("\nDone. Check /api/health for the rest.");
