import "dotenv/config";
import { defineConfig } from "prisma/config";

// Same reasoning as the SEO Machine app: read the URL off process.env rather
// than through Prisma's env() helper so `prisma generate` works with no
// environment at all (the postinstall hook runs before .env exists on a fresh
// clone). Commands that genuinely need a database still fail where it matters.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  engine: "classic",
  // Migrations get DIRECT_URL, never DATABASE_URL.
  //
  // Setting `datasource.url` here overrides the schema's datasource block
  // wholesale, `directUrl` included — so pointing this at DATABASE_URL sends
  // DDL through the transaction pooler, where advisory locks do not exist and
  // `prisma migrate deploy` hangs with no error and no timeout. Prefer the
  // direct URL and fall back only when there isn't one.
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || "file:./dev.db",
  },
});
