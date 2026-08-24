import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentSession } from "@/lib/account";
import { upgradeMessage } from "@/lib/plan";
import { parseJson, toJson } from "@/lib/json";
import type { PageSettings } from "@/lib/blocks";
import { ensureControl } from "@/lib/pages";
import { wildcardRoot } from "@/lib/hosts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const session = await currentSession();
  const page = await prisma.page.findUnique({
    where: { id },
    include: {
      variants: { orderBy: { createdAt: "asc" } },
      versions: { orderBy: { createdAt: "desc" }, take: 20 },
      leads: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!page || page.ownerId !== session.accountId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ page });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json();
  const session = await currentSession();
  const page = await prisma.page.findUnique({ where: { id } });
  if (!page || page.ownerId !== session.accountId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data: Record<string, string> = {};
  if (typeof body.name === "string") data.name = body.name;
  if (body.status === "live" || body.status === "draft") {
    // The UI hides the button; this is the check that actually holds.
    if (body.status === "live" && !session.ents.canPublish) {
      return NextResponse.json({ error: upgradeMessage("publish"), upgradeRequired: true }, { status: 402 });
    }
    data.status = body.status;
    if (body.status === "live") {
      await ensureControl(id);
      // Same automatic hostname as the chat path. See tools.ts publish_page.
      const root = wildcardRoot();
      if (root) {
        const existing = await prisma.domain.findFirst({ where: { pageId: id } });
        if (!existing) {
          const candidate = `${page.slug}.${root}`.toLowerCase();
          const clash = await prisma.domain.findUnique({ where: { hostname: candidate } });
          if (!clash) {
            await prisma.domain.create({ data: { hostname: candidate, pageId: id, verified: true } });
          }
        }
      }
      await prisma.pageVersion.create({
        data: {
          pageId: id,
          label: `Published ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
          blocks: page.blocks,
          theme: page.theme,
        },
      });
    }
  }
  if (body.settings) {
    data.settings = toJson({ ...parseJson<PageSettings>(page.settings, {}), ...body.settings });
  }
  const updated = await prisma.page.update({ where: { id }, data });
  return NextResponse.json({ page: updated });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const session = await currentSession();
  const page = await prisma.page.findUnique({ where: { id }, select: { ownerId: true } });
  if (!page || page.ownerId !== session.accountId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await prisma.page.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
