import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { parseJson, toJson } from "@/lib/json";
import {
  BLOCK_REFERENCE,
  normalizeBlocks,
  type Block,
  type Overrides,
  type PageSettings,
  type ThemeTokens,
} from "@/lib/blocks";
import { ensureControl, uniqueSlug } from "@/lib/pages";
import { importPage } from "@/lib/importer";
import { pageAnalytics } from "@/lib/analytics";
import { pageReport, resolveRange } from "@/lib/report";
import { structured } from "@/lib/llm";
import { EXPLORE_MIN } from "@/lib/bandit";
import { clearSimulation, simulateTraffic } from "@/lib/simulate";
import { dnsPlan, verifyDomain } from "@/lib/domains";
import { readBrand } from "@/lib/brand";
import { wildcardRoot } from "@/lib/hosts";
import { lintBlocks, reviewCopy } from "@/lib/copyreview";
import { upgradeMessage, type Entitlements } from "@/lib/plan";

/**
 * What the chat agent can actually do.
 *
 * The tools are deliberately coarse — one call builds a whole page, one call
 * rewrites one block. Fine-grained tools ("set_headline", "add_feature_item")
 * read well in a list and cost a round trip each; a page then takes thirty
 * turns to build and the model loses the thread halfway through. The split here
 * is by intent, not by field.
 *
 * Every executor returns a plain object that gets JSON-stringified back to the
 * model. Errors come back as { error } rather than thrown, so the model can
 * apologise and try something else instead of the whole turn dying.
 */

export type ToolResult = Record<string, unknown>;

/**
 * Who the agent is acting for.
 *
 * Passed in rather than resolved inside each tool so there is exactly one place
 * the caller's identity is established, and so a tool can never accidentally
 * run unscoped. Plan limits are enforced here as well as in the HTTP layer —
 * the model is a client like any other, and a client is not a security
 * boundary.
 */
export type ToolCtx = {
  accountId: string;
  ents: Entitlements;
  /** Whose Anthropic key the generating tools should bill. */
  apiKey?: string;
};

const okBlocks = { type: "array", items: { type: "object", additionalProperties: true } } as const;

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_pages",
    description: "List every landing page in this workspace with its status, slug and headline stats.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_page",
    description:
      "Read one page in full: its blocks, theme, settings and variants. Call this before editing a page you did not just create.",
    input_schema: {
      type: "object",
      properties: { pageId: { type: "string" } },
      required: ["pageId"],
      additionalProperties: false,
    },
  },
  {
    name: "read_brand",
    description:
      "Read a company's website and extract its real palette, typeface, light/dark register and self-description. Call this BEFORE building a page whenever you know their domain. It is what stops a generated page looking nothing like the business it belongs to.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string", description: "Their main website, e.g. acme.com" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "create_page",
    description:
      "Create a new landing page from scratch. Supply the complete block array — this is the main build tool.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Internal name, e.g. 'Roof repair — storm damage'" },
        goal: { type: "string", description: "One sentence: what the page is trying to make the visitor do" },
        blocks: okBlocks,
        brandUrl: {
          type: "string",
          description:
            "Their website. When given, the palette and typeface are read from it and applied automatically, which you should almost always prefer over choosing colours yourself.",
        },
        theme: {
          type: "object",
          additionalProperties: true,
          description:
            "Optional theme tokens: mode (dark|light), accent, bg, surface, text, muted, radius, font, density. Ignored for anything brandUrl already supplied.",
        },
        settings: {
          type: "object",
          additionalProperties: true,
          description: "Optional: crmWebhookUrl, notifyEmail, calendarUrl, redirectUrl",
        },
      },
      required: ["name", "blocks"],
      additionalProperties: false,
    },
  },
  {
    name: "update_page",
    description:
      "Replace a page's blocks, theme, settings, name or goal. Send only the parts you are changing. Use patch_block for a single-field edit.",
    input_schema: {
      type: "object",
      properties: {
        pageId: { type: "string" },
        name: { type: "string" },
        goal: { type: "string" },
        blocks: okBlocks,
        theme: { type: "object", additionalProperties: true },
        settings: { type: "object", additionalProperties: true },
      },
      required: ["pageId"],
      additionalProperties: false,
    },
  },
  {
    name: "patch_block",
    description:
      "Change specific fields on one block, leaving everything else alone. Cheapest way to reword a headline or swap a CTA.",
    input_schema: {
      type: "object",
      properties: {
        pageId: { type: "string" },
        blockId: { type: "string", description: "e.g. hero-1, pricing-1" },
        fields: { type: "object", additionalProperties: true },
      },
      required: ["pageId", "blockId", "fields"],
      additionalProperties: false,
    },
  },
  {
    name: "import_page",
    description:
      "Import an existing live landing page by URL and convert it into editable blocks. Use whenever the user already has a page.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "publish_page",
    description:
      "Take a page live at /p/{slug} and snapshot the current version. Ask the user before publishing unless they already said to.",
    input_schema: {
      type: "object",
      properties: { pageId: { type: "string" }, live: { type: "boolean", description: "false unpublishes" } },
      required: ["pageId"],
      additionalProperties: false,
    },
  },
  {
    name: "set_integrations",
    description:
      "Configure where form fills go and what the page books: CRM webhook, notification email, calendar embed, post-submit redirect.",
    input_schema: {
      type: "object",
      properties: {
        pageId: { type: "string" },
        crmWebhookUrl: { type: "string" },
        notifyEmail: { type: "string" },
        calendarUrl: { type: "string" },
        redirectUrl: { type: "string" },
        tracking: { type: "boolean" },
      },
      required: ["pageId"],
      additionalProperties: false,
    },
  },
  {
    name: "add_variant",
    description:
      "Add one variant by hand: an angle plus the block fields it overrides. Optionally hard-route it from a URL parameter.",
    input_schema: {
      type: "object",
      properties: {
        pageId: { type: "string" },
        name: { type: "string" },
        angle: { type: "string", description: "The strategic promise, e.g. 'same-day callout'" },
        overrides: {
          type: "object",
          additionalProperties: true,
          description: 'Map of blockId to changed fields, e.g. {"hero-1": {"headline": "..."}}',
        },
        match: {
          type: "object",
          additionalProperties: true,
          description: 'Optional hard route, e.g. {"param": "utm_content", "contains": "storm"}',
        },
      },
      required: ["pageId", "name", "angle", "overrides"],
      additionalProperties: false,
    },
  },
  {
    name: "set_match_rule",
    description:
      "Hard-route a variant to traffic whose URL carries a given parameter value — so people who clicked a specific ad, email segment or campaign always see the promise that was made to them, regardless of what converts best on average. This is how message match is enforced. Pass clear:true to remove the rule and return the variant to general traffic.",
    input_schema: {
      type: "object",
      properties: {
        variantId: { type: "string" },
        param: { type: "string", description: "URL parameter, e.g. utm_content, utm_campaign, seg" },
        contains: { type: "string", description: "Case-insensitive substring the parameter must contain" },
        clear: { type: "boolean" },
      },
      required: ["variantId"],
      additionalProperties: false,
    },
  },
  {
    name: "generate_variants",
    description:
      "Write variants automatically for a list of angles. Each becomes a testable version of the page competing in the bandit.",
    input_schema: {
      type: "object",
      properties: {
        pageId: { type: "string" },
        angles: {
          type: "array",
          items: { type: "string" },
          description: "Strategic promises, e.g. ['price', 'speed', 'guarantee']",
        },
      },
      required: ["pageId", "angles"],
      additionalProperties: false,
    },
  },
  {
    name: "attach_domain",
    description:
      "Serve a page on its own hostname — a subdomain of your own root, or the customer's own domain. Returns the exact DNS record to create.",
    input_schema: {
      type: "object",
      properties: {
        pageId: { type: "string" },
        hostname: { type: "string", description: "e.g. acme.lp.yourdomain.com or offer.acme.com" },
        verify: { type: "boolean", description: "true re-checks DNS for a hostname already attached" },
      },
      required: ["pageId", "hostname"],
      additionalProperties: false,
    },
  },
  {
    name: "simulate_traffic",
    description:
      "Send synthetic visitors through a page so the bandit, heatmap and section report have data to show. Use when the user wants to see how the analytics work before they have real traffic. Say clearly that the numbers are simulated.",
    input_schema: {
      type: "object",
      properties: {
        pageId: { type: "string" },
        visitors: { type: "number", description: "Default 500, max 5000" },
        days: { type: "number", description: "Spread the traffic over this many past days. Default 14." },
        clear: { type: "boolean", description: "true removes previously simulated traffic instead of adding more" },
      },
      required: ["pageId"],
      additionalProperties: false,
    },
  },
  {
    name: "export_page",
    description:
      "Give the user a download link for the page as one self-contained HTML file they can host anywhere. The exported form still posts leads back here.",
    input_schema: {
      type: "object",
      properties: {
        pageId: { type: "string" },
        variantId: { type: "string", description: "Export a specific variant instead of the master" },
      },
      required: ["pageId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_analytics",
    description:
      "Read live performance for a page: variant results with chance-to-win, section attention and reach, scroll depth, lead count.",
    input_schema: {
      type: "object",
      properties: { pageId: { type: "string" } },
      required: ["pageId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_report",
    description:
      "The full report for a page over a date range: people, conversions, the step-by-step funnel with drop-off, traffic sources, devices, per-version results and section attention. Use this for any question about performance over a period. Prefer it over get_analytics.",
    input_schema: {
      type: "object",
      properties: {
        pageId: { type: "string" },
        range: { type: "string", description: "7d | 30d | 90d | all. Default 30d." },
        from: { type: "string", description: "YYYY-MM-DD, for a custom range" },
        to: { type: "string", description: "YYYY-MM-DD" },
        variantId: { type: "string", description: "Limit the report to one version" },
      },
      required: ["pageId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_leads",
    description: "Read recent form fills for a page, including whether each one reached the CRM.",
    input_schema: {
      type: "object",
      properties: { pageId: { type: "string" }, limit: { type: "number" } },
      required: ["pageId"],
      additionalProperties: false,
    },
  },
  {
    name: "run_optimizer",
    description:
      "Retire variants the data has ruled out and report what should be scaled. Only acts on variants past their exploration quota.",
    input_schema: {
      type: "object",
      properties: { pageId: { type: "string" }, apply: { type: "boolean", description: "false = dry run" } },
      required: ["pageId"],
      additionalProperties: false,
    },
  },
];

async function loadPage(pageId: string, ctx: ToolCtx) {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    include: { variants: { orderBy: { createdAt: "asc" } } },
  });
  // A page belonging to someone else is reported as missing rather than
  // forbidden: the id should not be confirmable.
  if (!page || page.ownerId !== ctx.accountId) return null;
  return page;
}

/** Ownership check for tools that only need to know the page is theirs. */
async function ownedPage(pageId: string, ctx: ToolCtx) {
  const page = await prisma.page.findUnique({ where: { id: pageId } });
  return page && page.ownerId === ctx.accountId ? page : null;
}

/** Lifetime page count, so deleting a page does not refill the trial. */
async function pageQuotaError(ctx: ToolCtx): Promise<ToolResult | null> {
  if (ctx.ents.maxPages === null) return null;
  const account = await prisma.account.findUnique({ where: { id: ctx.accountId } });
  const used = account?.pagesCreated ?? 0;
  if (used < ctx.ents.maxPages) return null;
  return { error: upgradeMessage("page"), upgradeRequired: true };
}

async function countPage(ctx: ToolCtx): Promise<void> {
  await prisma.account
    .update({ where: { id: ctx.accountId }, data: { pagesCreated: { increment: 1 } } })
    .catch(() => undefined);
}

export async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolCtx,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "list_pages": {
        const pages = await prisma.page.findMany({
          where: { ownerId: ctx.accountId },
          orderBy: { updatedAt: "desc" },
          include: { variants: true, _count: { select: { leads: true } } },
        });
        return {
          pages: pages.map((p) => ({
            pageId: p.id,
            name: p.name,
            slug: p.slug,
            status: p.status,
            url: `/p/${p.slug}`,
            variants: p.variants.length,
            impressions: p.variants.reduce((n, v) => n + v.impressions, 0),
            conversions: p.variants.reduce((n, v) => n + v.conversions, 0),
            leads: p._count.leads,
          })),
        };
      }

      case "get_page": {
        const page = await loadPage(String(input.pageId), ctx);
        if (!page) return { error: "No page with that id." };
        return {
          pageId: page.id,
          name: page.name,
          slug: page.slug,
          status: page.status,
          goal: page.goal,
          url: `/p/${page.slug}`,
          blocks: parseJson<Block[]>(page.blocks, []),
          theme: parseJson<ThemeTokens>(page.theme, {}),
          settings: parseJson<PageSettings>(page.settings, {}),
          variants: page.variants.map((v) => ({
            variantId: v.id,
            name: v.name,
            angle: v.angle,
            active: v.active,
            isControl: v.isControl,
            impressions: v.impressions,
            conversions: v.conversions,
            overrides: parseJson<Overrides>(v.overrides, {}),
          })),
        };
      }

      case "read_brand": {
        const brand = await readBrand(String(input.url));
        return {
          siteName: brand.siteName,
          theyDescribeThemselvesAs: brand.description,
          palette: brand.palette,
          fonts: brand.fonts,
          theme: brand.theme,
          brief: brand.brief,
          note: "Pass this url as brandUrl on create_page and the theme is applied for you. Use the brief to match their register; do not describe the colours in the copy.",
        };
      }

      case "create_page": {
        const blocked = await pageQuotaError(ctx);
        if (blocked) return blocked;
        const name = String(input.name ?? "Untitled page");
        let blocks = normalizeBlocks(input.blocks);
        if (blocks.length === 0) return { error: "No usable blocks were supplied." };

        // Brand first, so the theme is theirs rather than a guess.
        let theme = (input.theme as Record<string, unknown>) ?? {};
        let brandNote: string | undefined;
        if (input.brandUrl) {
          try {
            const brand = await readBrand(String(input.brandUrl));
            theme = { ...brand.theme, ...theme };
            brandNote = brand.brief;
          } catch (err) {
            brandNote = `Could not read ${String(input.brandUrl)}: ${(err as Error).message}. Default theme used.`;
          }
        }

        // Second pass over the copy. Generation optimises for coherence across
        // the whole page; this reads it back looking only for the sentence that
        // any competitor could have written.
        let editorNotes: string | undefined;
        try {
          const reviewed = await reviewCopy({
            blocks,
            context: `Page name: ${name}. Goal: ${String(input.goal ?? "not stated")}.${brandNote ? ` ${brandNote}` : ""}`,
            apiKey: ctx.apiKey,
            accountId: ctx.accountId,
          });
          blocks = reviewed.blocks;
          editorNotes = reviewed.notes;
        } catch (err) {
          // A failed edit must not lose a good page.
          editorNotes = `Copy review skipped: ${(err as Error).message}`;
        }
        const page = await prisma.page.create({
          data: {
            name,
            slug: await uniqueSlug(name),
            goal: String(input.goal ?? ""),
            blocks: toJson(blocks),
            theme: toJson(theme),
            settings: toJson(input.settings ?? { tracking: true }),
            source: "chat",
            ownerId: ctx.accountId,
          },
        });
        await countPage(ctx);
        await ensureControl(page.id);
        return {
          pageId: page.id,
          slug: page.slug,
          previewUrl: `/p/${page.slug}?preview=1`,
          status: page.status,
          blockIds: blocks.map((b) => b.id),
          brand: brandNote,
          editorPass: editorNotes,
          remainingFaults: lintBlocks(blocks),
          note: "Created as a draft. Nothing is public until you publish it.",
        };
      }

      case "update_page": {
        const pageId = String(input.pageId);
        const page = await loadPage(pageId, ctx);
        if (!page) return { error: "No page with that id." };

        const data: Record<string, string> = {};
        if (input.name) data.name = String(input.name);
        if (input.goal !== undefined) data.goal = String(input.goal);
        if (input.blocks) data.blocks = toJson(normalizeBlocks(input.blocks));
        if (input.theme) {
          data.theme = toJson({ ...parseJson<ThemeTokens>(page.theme, {}), ...(input.theme as object) });
        }
        if (input.settings) {
          data.settings = toJson({ ...parseJson<PageSettings>(page.settings, {}), ...(input.settings as object) });
        }
        const updated = await prisma.page.update({ where: { id: pageId }, data });
        return {
          pageId,
          updated: Object.keys(data),
          blockIds: normalizeBlocks(parseJson<Block[]>(updated.blocks, [])).map((b) => b.id),
          previewUrl: `/p/${updated.slug}?preview=1`,
        };
      }

      case "patch_block": {
        const pageId = String(input.pageId);
        const blockId = String(input.blockId);
        const page = await ownedPage(pageId, ctx);
        if (!page) return { error: "No page with that id." };
        const blocks = normalizeBlocks(parseJson<Block[]>(page.blocks, []));
        const idx = blocks.findIndex((b) => b.id === blockId);
        if (idx === -1) {
          return { error: `No block "${blockId}". This page has: ${blocks.map((b) => b.id).join(", ")}` };
        }
        blocks[idx] = { ...blocks[idx], ...(input.fields as Partial<Block>), id: blockId, type: blocks[idx].type };
        await prisma.page.update({ where: { id: pageId }, data: { blocks: toJson(blocks) } });
        return { pageId, blockId, block: blocks[idx] };
      }

      case "import_page": {
        const blocked = await pageQuotaError(ctx);
        if (blocked) return blocked;
        const result = await importPage(String(input.url), ctx.accountId, ctx.apiKey);
        const page = await prisma.page.create({
          data: {
            name: result.name,
            slug: await uniqueSlug(result.name),
            goal: result.goal,
            blocks: toJson(result.blocks),
            theme: toJson(result.theme),
            settings: toJson({ tracking: true }),
            source: "import",
            sourceUrl: String(input.url),
            ownerId: ctx.accountId,
          },
        });
        await countPage(ctx);
        await ensureControl(page.id);
        return {
          pageId: page.id,
          slug: page.slug,
          previewUrl: `/p/${page.slug}?preview=1`,
          name: page.name,
          blockIds: result.blocks.map((b) => b.id),
          importNotes: result.notes,
          note: "Imported as a draft. Review the notes — imports lose layout and sometimes lose the offer.",
        };
      }

      case "publish_page": {
        const pageId = String(input.pageId);
        const live = input.live === undefined ? true : Boolean(input.live);
        if (live && !ctx.ents.canPublish) return { error: upgradeMessage("publish"), upgradeRequired: true };
        const page = await ownedPage(pageId, ctx);
        if (!page) return { error: "No page with that id." };

        if (live) {
          // Snapshot on publish, not on edit: this is the version that faced real
          // traffic, so it is the one worth being able to roll back to.
          await prisma.pageVersion.create({
            data: {
              pageId,
              label: `Published ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
              blocks: page.blocks,
              theme: page.theme,
            },
          });
        }
        await prisma.page.update({ where: { id: pageId }, data: { status: live ? "live" : "draft" } });
        await ensureControl(pageId);

        // Give every published page a hostname of its own, automatically.
        //
        // This is what makes the product self-serve on a single wildcard DNS
        // record: the operator creates *.root once, and from then on every
        // customer page gets its own subdomain with no DNS work by anybody and
        // no per-hostname certificate. Without this, a self-serve user's only
        // option is a shared /p/ path, which nobody wants to put in an ad.
        const root = wildcardRoot();
        let assignedHost: string | null = null;
        if (live && root) {
          const existing = await prisma.domain.findFirst({ where: { pageId } });
          if (existing) {
            assignedHost = existing.hostname;
          } else {
            const candidate = `${page.slug}.${root}`.toLowerCase();
            const clash = await prisma.domain.findUnique({ where: { hostname: candidate } });
            if (!clash) {
              await prisma.domain.create({
                data: { hostname: candidate, pageId, verified: true },
              });
              assignedHost = candidate;
            }
          }
        }

        const base = process.env.APP_URL || "http://localhost:4400";
        return {
          pageId,
          status: live ? "live" : "draft",
          url: live ? (assignedHost ? `https://${assignedHost}` : `${base}/p/${page.slug}`) : null,
          pathUrl: live ? `${base}/p/${page.slug}` : null,
          subdomain: assignedHost,
          note: assignedHost
            ? `Live on its own subdomain immediately. The path URL keeps working too.`
            : undefined,
        };
      }

      case "set_integrations": {
        const pageId = String(input.pageId);
        const page = await ownedPage(pageId, ctx);
        if (!page) return { error: "No page with that id." };
        const current = parseJson<PageSettings>(page.settings, {});
        const next: PageSettings = { ...current };
        for (const key of ["crmWebhookUrl", "notifyEmail", "calendarUrl", "redirectUrl"] as const) {
          if (input[key] !== undefined) next[key] = String(input[key]);
        }
        if (input.tracking !== undefined) next.tracking = Boolean(input.tracking);
        await prisma.page.update({ where: { id: pageId }, data: { settings: toJson(next) } });
        return {
          pageId,
          settings: next,
          note: next.crmWebhookUrl
            ? "Every form fill will POST as JSON to that webhook. Leads are stored here either way."
            : "No CRM webhook set — leads are stored in this app only.",
        };
      }

      case "add_variant": {
        const pageId = String(input.pageId);
        const page = await loadPage(pageId, ctx);
        if (!page) return { error: "No page with that id." };
        await ensureControl(pageId);
        const variant = await prisma.variant.create({
          data: {
            pageId,
            name: String(input.name),
            angle: String(input.angle),
            overrides: toJson(input.overrides ?? {}),
            match: toJson(input.match ?? {}),
            origin: "manual",
          },
        });
        return { variantId: variant.id, name: variant.name, angle: variant.angle };
      }

      case "set_match_rule": {
        const variantId = String(input.variantId);
        const variant = await prisma.variant.findUnique({ where: { id: variantId } });
        if (!variant || !(await ownedPage(variant.pageId, ctx))) {
          return { error: "No variant with that id." };
        }
        if (input.clear) {
          await prisma.variant.update({ where: { id: variantId }, data: { match: toJson({}) } });
          return { variantId, match: null, note: "Rule removed — this variant is back in general traffic." };
        }
        const param = String(input.param ?? "").trim();
        const contains = String(input.contains ?? "").trim();
        if (!param || !contains) return { error: "Both param and contains are required." };
        await prisma.variant.update({
          where: { id: variantId },
          data: { match: toJson({ param, contains }) },
        });
        return {
          variantId,
          match: { param, contains },
          note: `Anyone arriving with ${param} containing "${contains}" now sees this variant. It is also withheld from everyone else, so the promise never leaks to the wrong audience.`,
          testUrl: `/p/${(await prisma.page.findUnique({ where: { id: variant.pageId } }))?.slug}?${param}=${encodeURIComponent(contains)}`,
        };
      }

      case "generate_variants": {
        const pageId = String(input.pageId);
        const angles = (input.angles as string[]) ?? [];
        if (angles.length === 0) return { error: "No angles given." };
        const page = await ownedPage(pageId, ctx);
        if (!page) return { error: "No page with that id." };
        await ensureControl(pageId);

        const blocks = normalizeBlocks(parseJson<Block[]>(page.blocks, []));
        // Overrides come back as a JSON *string* rather than a nested object.
        // Structured outputs reject `additionalProperties: true`, and an
        // override map is open by definition — its keys are this page's block
        // ids and its values are arbitrary subsets of a block. Handing back a
        // string is the only closed schema that can express it.
        const generated = await structured<{
          variants: { name: string; angle: string; overridesJson: string }[];
        }>({
          system: `You write landing page variants.

${BLOCK_REFERENCE}

You are given the master blocks of a live page and a list of angles. For each angle produce a set of OVERRIDES — a map of block id to only the fields that change. Do not resend unchanged fields, and never change a block's id or type.

What makes a variant worth running:
- The promise in the hero changes. A variant that only reorders adjectives is not a test, it is noise.
- The proof and the CTA follow the promise. If the angle is speed, the CTA is "Get a same-day slot", not "Learn more".
- Every claim must be supported by something already on the master page. Inventing a guarantee, a price or a statistic to fit an angle is how a customer gets sued.
- Usually 1 to 4 blocks change per variant. Overriding everything means you wrote a different page, and the test tells you nothing about why it won.

Return overridesJson as a JSON string: an object keyed by block id, whose values contain only the changed fields. Example: "{\"hero-1\":{\"headline\":\"Fixed today or you don't pay\",\"ctaText\":\"Get today's last slot\"}}"`,
          prompt: `Page: ${page.name}
Goal: ${page.goal || "(not stated)"}

Master blocks:
${JSON.stringify(blocks, null, 2)}

Write one variant for each of these angles: ${angles.join(", ")}`,
          kind: "variants",
          pageId,
          accountId: ctx.accountId,
          apiKey: ctx.apiKey,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["variants"],
            properties: {
              variants: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["name", "angle", "overridesJson"],
                  properties: {
                    name: { type: "string" },
                    angle: { type: "string" },
                    overridesJson: {
                      type: "string",
                      description: "JSON object mapping block id to only the fields that change.",
                    },
                  },
                },
              },
            },
          },
        });

        const known = new Set(blocks.map((b) => b.id));
        const created = [];
        const skipped: string[] = [];
        for (const v of generated.variants) {
          const parsed = parseJson<Overrides>(v.overridesJson, {});
          // An override keyed to a block that does not exist is silently dead
          // at render time, which is the worst possible failure: the variant
          // runs, looks identical to control, and quietly wastes traffic.
          const overrides: Overrides = {};
          for (const [id, fields] of Object.entries(parsed)) {
            if (known.has(id)) overrides[id] = fields;
            else skipped.push(`${v.name}: ${id}`);
          }
          if (Object.keys(overrides).length === 0) {
            skipped.push(`${v.name}: nothing changed, not created`);
            continue;
          }
          const row = await prisma.variant.create({
            data: {
              pageId,
              name: v.name,
              angle: v.angle,
              overrides: toJson(overrides),
              match: toJson({}),
              origin: "generated",
            },
          });
          created.push({
            variantId: row.id,
            name: row.name,
            angle: row.angle,
            changedBlocks: Object.keys(overrides),
            previewUrl: `/p/${page.slug}?preview=1&v=${row.id}`,
          });
        }
        return {
          created,
          ignored: skipped.length ? skipped : undefined,
          note: `${created.length} variants added. Each gets ${EXPLORE_MIN} guaranteed impressions before the optimizer is allowed to judge it.`,
        };
      }

      case "attach_domain": {
        const pageId = String(input.pageId);
        if (!ctx.ents.canAttachDomain) return { error: upgradeMessage("domain"), upgradeRequired: true };
        if (!(await ownedPage(pageId, ctx))) return { error: "No page with that id." };
        const hostname = String(input.hostname).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

        if (input.verify) {
          const existing = await prisma.domain.findUnique({ where: { hostname } });
          if (!existing) return { error: `${hostname} is not attached to anything yet.` };
          const result = await verifyDomain(hostname);
          await prisma.domain.update({
            where: { id: existing.id },
            data: { verified: result.ok, lastCheck: new Date(), note: result.detail },
          });
          return { hostname, verified: result.ok, detail: result.detail };
        }

        const clash = await prisma.domain.findUnique({ where: { hostname } });
        if (clash) {
          return {
            error:
              clash.pageId === pageId
                ? `${hostname} is already on this page.`
                : `${hostname} already serves a different page. One hostname, one page.`,
          };
        }

        const plan = dnsPlan(hostname);
        await prisma.domain.create({ data: { hostname, pageId, verified: plan.kind === "wildcard" } });
        return {
          hostname,
          dns: plan.records,
          ready: plan.ready,
          explain: plan.explain,
          note: plan.ready
            ? `Live at https://${hostname} as soon as the page is published.`
            : "Create that record, then ask me to verify the domain.",
        };
      }

      case "simulate_traffic": {
        const pageId = String(input.pageId);
        if (!(await ownedPage(pageId, ctx))) return { error: "No page with that id." };
        if (input.clear) {
          const removed = await clearSimulation(pageId);
          return { cleared: removed, note: "Simulated traffic removed. Real traffic was not touched." };
        }
        const result = await simulateTraffic(
          pageId,
          Math.min(5000, Number(input.visitors ?? 500)),
          Number(input.days ?? 14),
        );
        return {
          ...result,
          note: "SIMULATED traffic, not real visitors. Each variant was given a hidden true conversion rate so the optimizer has something genuine to find. Click coordinates are approximated by block position.",
        };
      }

      case "export_page": {
        const pageId = String(input.pageId);
        if (!ctx.ents.canExport) return { error: upgradeMessage("export"), upgradeRequired: true };
        const page = await ownedPage(pageId, ctx);
        if (!page) return { error: "No page with that id." };
        const base = process.env.APP_URL || "http://localhost:4400";
        const query = input.variantId ? `?v=${String(input.variantId)}` : "";
        return {
          downloadUrl: `${base}/api/pages/${pageId}/export${query}`,
          note: "One HTML file, styles inline, no build step. The form posts back to this app so leads and conversions still land here.",
        };
      }

      case "get_analytics": {
        if (!(await ownedPage(String(input.pageId), ctx))) return { error: "No page with that id." };
        const stats = await pageAnalytics(String(input.pageId));
        return {
          totals: stats.totals,
          variants: stats.variants,
          sections: stats.sections.map((s) => ({
            block: s.blockId,
            label: s.label,
            seenBy: `${Math.round(s.reach * 100)}%`,
            dwellSeconds: s.dwellSeconds,
            clicks: s.clicks,
            ctaClicks: s.ctaClicks,
          })),
          scrollDepth: stats.scroll.map((s) => `${s.depth}%: ${Math.round(s.share * 100)}% of visitors`),
        };
      }

      case "get_report": {
        const pageId = String(input.pageId);
        if (!(await ownedPage(pageId, ctx))) return { error: "No page with that id." };
        const range = resolveRange(
          input.from ? "custom" : (input.range as string) ?? "30d",
          input.from as string | undefined,
          input.to as string | undefined,
        );
        const report = await pageReport(pageId, {
          range,
          variantId: (input.variantId as string) ?? null,
        });
        return {
          range: report.range,
          totals: report.totals,
          comparedToPrevious: report.previous,
          funnel: report.funnel.map((f) => ({
            step: f.step,
            people: f.visitors,
            ofEveryone: `${Math.round(f.ofTop * 100)}%`,
            ofPreviousStep: `${Math.round(f.ofPrev * 100)}%`,
          })),
          versions: report.variants,
          sources: report.sources,
          devices: report.devices,
          sections: report.sections.map((s) => ({
            block: s.blockId,
            label: s.label,
            seenBy: `${Math.round(s.reach * 100)}%`,
            attentionSeconds: s.dwellSeconds,
            clicks: s.clicks + s.ctaClicks,
          })),
          scrollDepth: report.scroll.map((s) => `${s.depth}%: ${Math.round(s.share * 100)}%`),
        };
      }

      case "list_leads": {
        if (!(await ownedPage(String(input.pageId), ctx))) return { error: "No page with that id." };
        const limit = Math.min(100, Number(input.limit ?? 20));
        const leads = await prisma.lead.findMany({
          where: { pageId: String(input.pageId) },
          orderBy: { createdAt: "desc" },
          take: limit,
        });
        return {
          leads: leads.map((l) => ({
            at: l.createdAt.toISOString(),
            data: parseJson<Record<string, string>>(l.data, {}),
            forwarded: l.forwarded,
            error: l.forwardError,
          })),
        };
      }

      case "run_optimizer": {
        const pageId = String(input.pageId);
        if (!(await ownedPage(pageId, ctx))) return { error: "No page with that id." };
        const apply = input.apply === undefined ? true : Boolean(input.apply);
        const stats = await pageAnalytics(pageId);

        const retire = stats.variants.filter((v) => v.flag === "losing" && !v.isControl && v.active);
        const scale = stats.variants.filter((v) => v.flag === "winning");
        const starved = stats.variants.filter((v) => v.flag === "starved" && v.active);

        if (apply && retire.length > 0) {
          await prisma.variant.updateMany({
            where: { id: { in: retire.map((v) => v.id) } },
            data: { active: false },
          });
        }

        return {
          applied: apply,
          retired: retire.map((v) => `${v.name} (${Math.round(v.winProbability * 100)}% chance to win)`),
          scale: scale.map((v) => `${v.name} — ${(v.cvr * 100).toFixed(1)}% CVR, ${Math.round(v.winProbability * 100)}% chance to win`),
          stillLearning: starved.map((v) => `${v.name} — ${v.impressions}/${EXPLORE_MIN} impressions`),
          note:
            retire.length === 0 && scale.length === 0
              ? "Nothing is decided yet. The data has not separated the variants."
              : undefined,
        };
      }

      default:
        return { error: `Unknown tool ${name}` };
    }
  } catch (err) {
    return { error: (err as Error).message };
  }
}
