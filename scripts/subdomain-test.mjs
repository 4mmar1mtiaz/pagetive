import "dotenv/config";
import { runTool } from "../src/lib/tools.ts";
import { entitlements } from "../src/lib/plan.ts";
const ctx = { accountId: "acct-ammar", ents: entitlements("unlimited") };
const PHOENIX = (await runTool("list_pages", {}, ctx)).pages.find((p) => p.slug.includes("phoenix"));

console.log("publishing:", PHOENIX.slug);
const r = await runTool("publish_page", { pageId: PHOENIX.pageId }, ctx);
console.log("  url:      ", r.url);
console.log("  subdomain:", r.subdomain);
console.log("  path url: ", r.pathUrl);
process.exit(0);
