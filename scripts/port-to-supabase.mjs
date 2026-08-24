/**
 * Copy the local database into the configured remote one.
 *
 * Schema comes from `prisma migrate deploy`, not from here, so this moves data
 * only. Running it twice would duplicate rows, so it refuses if the target
 * already has pages in it.
 *
 * Run after setup-supabase.mjs:  npx tsx scripts/port-to-supabase.mjs
 */
import "dotenv/config";
import { execSync } from "node:child_process";

const LOCAL = "postgresql://ammarimtiaz@localhost:5432/adaptive_lp_dev";
const REMOTE = process.env.DIRECT_URL;
const PG = "/opt/homebrew/opt/postgresql@15/bin";

if (!REMOTE || REMOTE.includes("localhost")) {
  console.error("DIRECT_URL still points at localhost. Run setup-supabase.mjs first.");
  process.exit(1);
}

const count = execSync(`${PG}/psql "${REMOTE}" -At -c 'select count(*) from "Page"'`).toString().trim();
if (count !== "0") {
  console.error(`The target already has ${count} pages. Refusing to duplicate data.`);
  process.exit(1);
}

// Order matters for foreign keys, and --data-only does not sort for you.
const TABLES = ["Account", "Page", "Variant", "Domain", "Assignment", "Event", "Lead", "PageVersion", "Chat", "Message", "Usage"];
const args = TABLES.map((t) => `-t '"${t}"'`).join(" ");

console.log("Dumping local data...");
execSync(`${PG}/pg_dump "${LOCAL}" --data-only --no-owner --disable-triggers ${args} > /tmp/alp-port.sql`, { shell: "/bin/bash" });

console.log("Loading into the remote database...");
execSync(`${PG}/psql "${REMOTE}" -q -v ON_ERROR_STOP=1 -f /tmp/alp-port.sql`, { stdio: "inherit" });

const after = execSync(`${PG}/psql "${REMOTE}" -At -c 'select (select count(*) from "Page")||\\' pages, \\'||(select count(*) from "Event")||\\' events\\''`).toString().trim();
console.log(`\nDone: ${after}`);
