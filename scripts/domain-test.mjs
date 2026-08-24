import "dotenv/config";
import { runTool } from "../src/lib/tools.ts";
import { entitlements } from "../src/lib/plan.ts";
const ctx = { accountId: "acct-ammar", ents: entitlements("unlimited") };
const MARKETING = "cmt6jqntg0003kbq42akphmcg";

const fresh = await runTool("attach_domain", { pageId: MARKETING, hostname: "try.lp.local" }, ctx);
console.log("attach try.lp.local     ->", fresh.error ?? `${fresh.ready ? "ready (wildcard)" : "needs dns"}: ${fresh.explain}`);

const taken = await runTool("attach_domain", { pageId: MARKETING, hostname: "detailing.lp.local" }, ctx);
console.log("re-attach a taken host  ->", taken.error ?? "ALLOWED (bug)");

const outside = await runTool("attach_domain", { pageId: MARKETING, hostname: "offer.clientsite.com" }, ctx);
console.log("attach a client domain  ->", JSON.stringify(outside.dns), "|", outside.explain);
process.exit(0);
