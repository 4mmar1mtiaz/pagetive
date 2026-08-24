import "dotenv/config";
import { runTool } from "../src/lib/tools.ts";
import { entitlements } from "../src/lib/plan.ts";

const [pageId, live] = process.argv.slice(2);
const result = await runTool(
  "publish_page",
  { pageId, live: live !== "false" },
  { accountId: "acct-ammar", ents: entitlements("unlimited") },
);
console.log(result);
process.exit(result.error ? 1 : 0);
