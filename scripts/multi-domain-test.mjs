import "dotenv/config";
import { runTool } from "../src/lib/tools.ts";
import { entitlements } from "../src/lib/plan.ts";
const ctx = { accountId: "acct-ammar", ents: entitlements("unlimited") };

const pages = (await runTool("list_pages", {}, ctx)).pages.filter((p) => !p.slug.startsWith("adaptive"));
console.log(`Testing ${pages.length} pages, each getting a client domain AND a subdomain:\n`);

for (const [i, p] of pages.entries()) {
  const client = `offer.client${i + 1}.com`;
  const sub = `client${i + 1}.lp.local`;
  const a = await runTool("attach_domain", { pageId: p.pageId, hostname: client }, ctx);
  const b = await runTool("attach_domain", { pageId: p.pageId, hostname: sub }, ctx);
  console.log(`${p.slug.slice(0, 34).padEnd(36)}`);
  console.log(`   ${client.padEnd(26)} ${a.error ?? (a.ready ? "ready" : `needs ${a.dns?.[0]?.type} ${a.dns?.[0]?.name} -> ${a.dns?.[0]?.value}`)}`);
  console.log(`   ${sub.padEnd(26)} ${b.error ?? (b.ready ? "ready, no DNS needed" : "needs dns")}`);
}
process.exit(0);
