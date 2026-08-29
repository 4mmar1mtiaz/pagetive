"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { acceptAttribute } from "@/lib/media-types";
import type { AssetRow } from "@/components/types";

/**
 * Pick files, say what each one is for, attach them to the next message.
 *
 * The description box beside each file is the point of this dialog. A URL on
 * its own tells the agent a picture exists; "the owner, use this on the about
 * section" tells it where the picture goes. Without that it either guesses or
 * stops to ask, and both are worse than one sentence typed while uploading.
 *
 * Files upload as they are chosen rather than on a confirm step, so the slow
 * part is over by the time the description is written. Each upload is its own
 * request: one 40 MB video failing must not discard three images that landed.
 */
export function MediaDialog({
  onClose,
  onAttach,
  alreadyAttached,
}: {
  onClose: () => void;
  onAttach: (assets: AssetRow[]) => void;
  alreadyAttached: string[];
}) {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [picked, setPicked] = useState<string[]>(alreadyAttached);
  const [busy, setBusy] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [storageReady, setStorageReady] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/media").then((x) => x.json());
    setAssets(r.assets ?? []);
    setStorageReady(r.storageReady !== false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Escape closes. A dialog you cannot dismiss with the keyboard is a trap when
  // an upload has already failed and the mouse is somewhere else.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setErrors([]);
    setBusy((n) => n + files.length);

    await Promise.all(
      Array.from(files).map(async (file) => {
        const body = new FormData();
        body.append("file", file);
        try {
          const res = await fetch("/api/media", { method: "POST", body });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
          setAssets((all) => [data.asset, ...all]);
          setPicked((all) => [...all, data.asset.id]);
        } catch (err) {
          setErrors((all) => [...all, `${file.name}: ${(err as Error).message}`]);
        } finally {
          setBusy((n) => n - 1);
        }
      }),
    );
  }

  /** Saved on blur rather than per keystroke: this is a sentence, not a search box. */
  async function saveDescription(id: string, description: string) {
    setAssets((all) => all.map((a) => (a.id === id ? { ...a, description } : a)));
    await fetch("/api/media", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, description }),
    }).catch(() => undefined);
  }

  async function remove(id: string) {
    setAssets((all) => all.filter((a) => a.id !== id));
    setPicked((all) => all.filter((x) => x !== id));
    await fetch(`/api/media?id=${id}`, { method: "DELETE" }).catch(() => undefined);
  }

  function toggle(id: string) {
    setPicked((all) => (all.includes(id) ? all.filter((x) => x !== id) : [...all, id]));
  }

  return (
    <div className="media-backdrop" onClick={onClose}>
      <div className="media-dialog glass" onClick={(e) => e.stopPropagation()}>
        <div className="media-head">
          <div>
            <div className="chrome" style={{ fontSize: 15, fontWeight: 640 }}>
              Images and video
            </div>
            <div className="sm" style={{ color: "var(--silver-faint)" }}>
              Say what each one is for. That is how it knows where to put it.
            </div>
          </div>
          <button className="btn sm ghost" onClick={onClose}>
            Close
          </button>
        </div>

        {!storageReady ? (
          <div className="media-warn">
            Media storage is not configured yet. Set SUPABASE_URL and SUPABASE_SECRET_KEY, then
            reload.
          </div>
        ) : null}

        <div className="media-body">
          <button
            className="media-drop"
            onClick={() => fileInput.current?.click()}
            disabled={!storageReady}
          >
            <b>Choose images or video</b>
            <span>PNG, JPG, WEBP, GIF, SVG, MP4, WEBM, MOV. Up to 50 MB each.</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={acceptAttribute()}
            style={{ display: "none" }}
            onChange={(e) => {
              upload(e.target.files);
              e.target.value = "";
            }}
          />

          {busy > 0 ? (
            <div className="sm" style={{ color: "var(--silver-faint)" }}>
              Uploading {busy} file{busy === 1 ? "" : "s"}...
            </div>
          ) : null}

          {errors.map((e) => (
            <div key={e} className="media-warn">
              {e}
            </div>
          ))}

          {assets.length === 0 && busy === 0 ? (
            <div className="sm" style={{ color: "var(--silver-faint)", padding: "8px 2px" }}>
              Nothing uploaded yet.
            </div>
          ) : null}

          {assets.map((a) => (
            <div key={a.id} className={`media-row ${picked.includes(a.id) ? "picked" : ""}`}>
              <button
                className="media-thumb"
                onClick={() => toggle(a.id)}
                title={picked.includes(a.id) ? "Attached to the next message" : "Attach"}
              >
                {a.kind === "video" ? (
                  <video src={a.url} muted playsInline preload="metadata" />
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={a.url} alt={a.description || a.name} />
                )}
                {picked.includes(a.id) ? <span className="media-tick">✓</span> : null}
              </button>

              <div className="media-meta">
                <div className="truncate sm" style={{ color: "#fff" }}>
                  {a.name}
                </div>
                <textarea
                  className="media-desc"
                  rows={2}
                  placeholder="What is this for? e.g. hero background, the owner, a demo clip"
                  defaultValue={a.description}
                  onBlur={(e) => saveDescription(a.id, e.target.value)}
                />
              </div>

              <button className="btn sm ghost" onClick={() => remove(a.id)} title="Delete for good">
                Delete
              </button>
            </div>
          ))}
        </div>

        <div className="media-foot">
          <span className="sm" style={{ color: "var(--silver-faint)" }}>
            {picked.length} attached
          </span>
          <button
            className="btn primary"
            onClick={() => {
              onAttach(assets.filter((a) => picked.includes(a.id)));
              onClose();
            }}
          >
            Attach to message
          </button>
        </div>
      </div>
    </div>
  );
}
