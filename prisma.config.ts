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
  datasource: { url: process.env.DATABASE_URL ?? "file:./dev.db" },
});
