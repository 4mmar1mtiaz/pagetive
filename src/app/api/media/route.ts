import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentSession } from "@/lib/account";
import { deleteAsset, storageReady, uploadAsset } from "@/lib/storage";
import { kindOf, MAX_UPLOAD_BYTES } from "@/lib/media-types";

/**
 * Upload, list and delete the media a user can put on their pages.
 *
 * One file per request rather than a batch. The upload dialog sends several in
 * parallel, and one file per request means a 40 MB video failing does not take
 * the three images that already succeeded down with it — each one either lands
 * or reports its own reason.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const session = await currentSession();
  const assets = await prisma.asset.findMany({
    where: { ownerId: session.accountId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ assets, storageReady: storageReady() });
}

export async function POST(req: Request) {
  const session = await currentSession();
  if (session.suspended) {
    return NextResponse.json({ error: "This account is suspended." }, { status: 403 });
  }
  if (!storageReady()) {
    return NextResponse.json(
      {
        error:
          "Media storage is not configured yet. SUPABASE_URL and SUPABASE_SECRET_KEY need to be set.",
      },
      { status: 503 },
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: "No file was sent." }, { status: 400 });
  }

  const kind = kindOf(file.type);
  if (!kind) {
    return NextResponse.json(
      { error: `${file.type || "That file type"} is not an image or video the page can display.` },
      { status: 415 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
      },
      { status: 413 },
    );
  }

  try {
    const { url, path } = await uploadAsset({
      accountId: session.accountId,
      file,
      filename: file.name || "upload",
      mime: file.type,
    });

    const asset = await prisma.asset.create({
      data: {
        ownerId: session.accountId,
        kind,
        url,
        path,
        mime: file.type,
        bytes: file.size,
        name: file.name || "upload",
        description: String(form.get("description") ?? "").slice(0, 500),
      },
    });

    return NextResponse.json({ asset });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

export async function PATCH(req: Request) {
  const session = await currentSession();
  const body = (await req.json().catch(() => ({}))) as { id?: string; description?: string };
  if (!body.id) return NextResponse.json({ error: "No asset given." }, { status: 400 });

  const owned = await prisma.asset.findFirst({
    where: { id: body.id, ownerId: session.accountId },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: "Unknown asset." }, { status: 404 });

  const asset = await prisma.asset.update({
    where: { id: owned.id },
    data: { description: String(body.description ?? "").slice(0, 500) },
  });
  return NextResponse.json({ asset });
}

export async function DELETE(req: Request) {
  const session = await currentSession();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "No asset given." }, { status: 400 });

  const asset = await prisma.asset.findFirst({ where: { id, ownerId: session.accountId } });
  if (!asset) return NextResponse.json({ error: "Unknown asset." }, { status: 404 });

  // Storage first: a row deleted with the file still there is a leak nobody can
  // see, while a file deleted with the row still there is a broken page.
  await deleteAsset(asset.path);
  await prisma.asset.delete({ where: { id: asset.id } });
  return NextResponse.json({ ok: true });
}
