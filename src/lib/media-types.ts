/**
 * What counts as media, shared by the browser and the server.
 *
 * Kept apart from lib/storage so the upload dialog can import it. storage.ts
 * reads the Supabase secret key, and a client component importing that module
 * puts the key one bundling mistake away from the browser. This file has no
 * secrets and no imports, so it is safe on both sides.
 */

/** Files the page renderer can actually display. */
export const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/svg+xml",
];

export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

/**
 * 50 MB. Large enough for a hero video at sensible bitrates, small enough that
 * one upload cannot stall a serverless function past its timeout.
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export type AssetKind = "image" | "video";

export function kindOf(mime: string): AssetKind | null {
  if (IMAGE_TYPES.includes(mime)) return "image";
  if (VIDEO_TYPES.includes(mime)) return "video";
  return null;
}

/** For the file picker's `accept`, so the OS dialog greys out the rest. */
export function acceptAttribute(): string {
  return [...IMAGE_TYPES, ...VIDEO_TYPES].join(",");
}
