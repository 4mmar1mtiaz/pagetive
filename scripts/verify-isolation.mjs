/**
 * Proof that two accounts cannot see each other.
 *
 * Runs the real tool layer with two different sessions and asserts that every
 * page-scoped operation refuses a page it does not own. Written as a script
 * rather than a note in a README because "tenancy is enforced" is the kind of
 * claim that quietly stops being true after a refactor, and this fails loudly
 * when it does.
 *
 * Run: npm run verify:isolation
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { runTool } from "../src/lib/tools.ts";
import { entitlements } from "../src/lib/plan.ts";

const prisma = new PrismaClient();
const unlimited = entitlements("unlimited");

let failures = 0;
function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const stamp = Date.now();
const alice = await prisma.account.create({
  data: { email: `alice-${stamp}@test.local`, plan: "unlimited" },
});
const bob = await prisma.account.create({
  data: { email: `bob-${stamp}@test.local`, plan: "unlimited" },
});

const ctxA = { accountId: alice.id, ents: unlimited };
const ctxB = { accountId: bob.id, ents: unlimited };

const blocks = [{ type: "hero", headline: "Alice's private offer" }];
const created = await runTool("create_page", { name: `Alice ${stamp}`, blocks }, ctxA);
const alicePage = created.pageId;
check("Alice can create a page", Boolean(alicePage), created.error ?? "");

await runTool("simulate_traffic", { pageId: alicePage, visitors: 20, days: 2 }, ctxA);
await prisma.lead.create({
  data: { pageId: alicePage, data: JSON.stringify({ email: "secret-buyer@alice.com" }) },
});

console.log("\nBob tries to reach Alice's page:");
const probes = [
  ["get_page", { pageId: alicePage }],
  ["update_page", { pageId: alicePage, name: "hijacked" }],
  ["patch_block", { pageId: alicePage, blockId: "hero-1", fields: { headline: "hijacked" } }],
  ["publish_page", { pageId: alicePage }],
  ["set_integrations", { pageId: alicePage, crmWebhookUrl: "https://evil.example" }],
  ["add_variant", { pageId: alicePage, name: "x", angle: "x", overrides: {} }],
  ["generate_variants", { pageId: alicePage, angles: ["x"] }],
  ["attach_domain", { pageId: alicePage, hostname: "evil.example.com" }],
  ["simulate_traffic", { pageId: alicePage, visitors: 10 }],
  ["get_analytics", { pageId: alicePage }],
  ["get_report", { pageId: alicePage }],
  ["list_leads", { pageId: alicePage }],
  ["run_optimizer", { pageId: alicePage }],
  ["export_page", { pageId: alicePage }],
];
for (const [tool, input] of probes) {
  const result = await runTool(tool, input, ctxB);
  const refused = Boolean(result.error);
  const leaked = JSON.stringify(result).includes("Alice's private offer")
    || JSON.stringify(result).includes("secret-buyer@alice.com");
  check(`${tool} refused`, refused && !leaked, refused ? "" : JSON.stringify(result).slice(0, 90));
}

console.log("\nListing is scoped:");
const bobList = await runTool("list_pages", {}, ctxB);
check("Bob's page list excludes Alice's page",
  !JSON.stringify(bobList).includes(alicePage), JSON.stringify(bobList).slice(0, 90));
const aliceList = await runTool("list_pages", {}, ctxA);
check("Alice's own list includes it", JSON.stringify(aliceList).includes(alicePage));

console.log("\nPlan limits are per account:");
const trialCtx = { accountId: bob.id, ents: entitlements("trial") };
await prisma.account.update({ where: { id: bob.id }, data: { pagesCreated: 1 } });
const overQuota = await runTool("create_page", { name: "second", blocks }, trialCtx);
check("Trial account blocked at its page limit", Boolean(overQuota.upgradeRequired), overQuota.error ?? "");
const suspended = { accountId: bob.id, ents: entitlements("unlimited", { suspended: true }) };
const whileSuspended = await runTool("publish_page", { pageId: alicePage }, suspended);
check("Suspended account cannot publish", Boolean(whileSuspended.error));

// Clean up everything this created.
await prisma.account.deleteMany({ where: { id: { in: [alice.id, bob.id] } } });
await prisma.$disconnect();

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
