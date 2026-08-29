/**
 * Where uploaded images and video actually go.
 *
 * Supabase Storage, reached over its REST API with fetch rather than through
 * @supabase/supabase-js. The client library exists to give you auth, realtime,
 * postgrest and storage; this app already talks to Postgres through Prisma and
 * to auth through Clerk, so importing all of that to issue two HTTP calls would
 * be a dependency paying for nothing.
 *
 * The secret key never leaves the server. Every upload goes through the route
 * handler, which is also the only place ownership is checked — a browser
 * holding a key that can write to the bucket is a browser that can write to
 * anyone's bucket path.
 */
import { MAX_UPLOAD_BYTES } from "@/lib/media-types";

export const BUCKET = "media";

/** Blank when storage is not configured, so callers can say so rather than 500. */
export function storageConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
}

export function storageReady(): boolean {
  return storageConfig() !== null;
}

/**
 * Make the bucket if it is not there yet.
 *
 * Doing this on demand rather than in a setup script means a fresh clone with
 * fresh Supabase credentials works on the first upload, with no step anybody
 * has to remember. A 409 back is the bucket already existing, which is success.
 */
async function ensureBucket(cfg: { url: string; key: string }): Promise<void> {
  const res = await fetch(`${cfg.url}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.key}`,
      apikey: cfg.key,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: true,
      file_size_limit: MAX_UPLOAD_BYTES,
    }),
  });
  if (res.ok || res.status === 409) return;
  const detail = await res.text().catch(() => "");
  // "already exists" comes back with several different codes depending on the
  // Supabase version, so match the message too rather than trusting the status.
  if (/exist/i.test(detail)) return;
  throw new Error(`Could not create the ${BUCKET} bucket: ${res.status} ${detail.slice(0, 200)}`);
}

/** Keep the original name recognisable in storage without trusting it as a path. */
function safeName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.slice(-80) || "file";
}

export type Uploaded = { url: string; path: string };

/**
 * Put one file in the bucket and return where it landed.
 *
 * The path is namespaced by account so one customer's uploads are never
 * enumerable from another's, and prefixed with a timestamp so re-uploading the
 * same filename does not silently replace the file a live page is serving.
 */
export async function uploadAsset(args: {
  accountId: string;
  file: Blob;
  filename: string;
  mime: string;
}): Promise<Uploaded> {
  const cfg = storageConfig();
  if (!cfg) {
    throw new Error(
      "Media storage is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY, then try again.",
    );
  }

  await ensureBucket(cfg);

  const path = `${args.accountId}/${Date.now()}-${safeName(args.filename)}`;
  const res = await fetch(`${cfg.url}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.key}`,
      apikey: cfg.key,
      "content-type": args.mime,
      "cache-control": "public, max-age=31536000, immutable",
    },
    body: args.file,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Upload failed: ${res.status} ${detail.slice(0, 200)}`);
  }

  return { url: `${cfg.url}/storage/v1/object/public/${BUCKET}/${path}`, path };
}

/** Best effort: a row removed with its file left behind is a leak, not a break. */
export async function deleteAsset(path: string): Promise<void> {
  const cfg = storageConfig();
  if (!cfg) return;
  await fetch(`${cfg.url}/storage/v1/object/${BUCKET}/${path}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${cfg.key}`, apikey: cfg.key },
  }).catch(() => undefined);
}
