"use client";

import { useEffect, useRef } from "react";
import { renderMarkdown } from "@/lib/mini-md";
import { Spinner } from "@/components/Spinner";
import type { AssetRow, Turn } from "@/components/types";

/** Human-readable names for what the agent is doing. The raw tool name is
 *  accurate and reads like a log file; this reads like a colleague. */
const LABELS: Record<string, string> = {
  list_pages: "Checking your pages",
  get_page: "Reading the page",
  create_page: "Building the page",
  update_page: "Rewriting the page",
  patch_block: "Editing a section",
  import_page: "Importing the page",
  publish_page: "Publishing",
  set_integrations: "Wiring up integrations",
  add_variant: "Adding a variant",
  generate_variants: "Writing variants",
  get_analytics: "Reading performance",
  list_leads: "Fetching leads",
  run_optimizer: "Running the optimizer",
};

const STARTERS = [
  {
    title: "Build a page from scratch",
    body: "A booking page for a mobile car detailing service in Dallas. Same-day slots, form plus calendar.",
  },
  {
    title: "Import one I already have",
    body: "Import https://example.com/offer and tell me what is weak about it.",
  },
  {
    title: "Make it test itself",
    body: "Generate variants for price, speed and guarantee on my newest page, then publish it.",
  },
  {
    title: "Read the heatmap",
    body: "Which section of my page loses people, and what should I change?",
  },
];

export function Chat({
  turns,
  streaming,
  input,
  setInput,
  onSend,
  onStarter,
  chatTitle,
  onNewChat,
  cost,
  attached,
  onOpenMedia,
  onDetach,
  loadingThread,
}: {
  turns: Turn[];
  streaming: boolean;
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  onStarter: (text: string) => void;
  chatTitle: string;
  onNewChat: () => void;
  /** What this turn has cost so far. Shown because a page build is a few tool
   *  calls of a frontier model, and nobody should have to guess at that. */
  cost: number | null;
  /** Media riding along with the next message. */
  attached: AssetRow[];
  onOpenMedia: () => void;
  onDetach: (id: string) => void;
  /** A stored thread is being fetched. Distinct from streaming: nothing is
   *  being generated, the transcript simply is not here yet. */
  loadingThread: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, streaming]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(200, el.scrollHeight)}px`;
  }, [input]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  const empty = turns.length === 0 && !loadingThread;

  return (
    <div className="glass col" style={{ height: "100%" }}>
      <div className="chat-head">
        <div className="chat-title">{chatTitle}</div>
        {cost !== null ? (
          <span className="mono" style={{ fontSize: 11, color: "var(--silver-faint)", marginLeft: "auto", marginRight: 8 }}>
            ${cost.toFixed(3)} this turn
          </span>
        ) : null}
        <button className="btn sm ghost" onClick={onNewChat}>
          New
        </button>
      </div>

      <div className="thread">
        <div className="thread-inner">
          {loadingThread ? <Spinner block label="Loading this conversation" /> : null}
          {empty ? (
            <div className="empty-hero fade-in">
              <h1 className="chrome">What are we launching?</h1>
              <p>Describe the page. It gets built, published, and it keeps testing itself.</p>
              <div className="starter-grid">
                {STARTERS.map((s) => (
                  <button key={s.title} className="starter" onClick={() => onStarter(s.body)}>
                    <b>{s.title}</b>
                    <span>{s.body}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {turns.map((t, i) => (
            <div key={i} className={`msg ${t.role === "user" ? "user" : "bot"} fade-in`}>
              <div className="avatar">{t.role === "user" ? "you" : ""}</div>
              <div className="body">
                {t.tools.length > 0 ? (
                  <div style={{ marginBottom: t.text ? 12 : 0 }}>
                    {t.tools.map((tool, j) => (
                      <span key={j} className={`tool-chip ${tool.state}`}>
                        <i className="spin" />
                        {LABELS[tool.name] ?? tool.name}
                        {tool.summary ? <em style={{ opacity: 0.6, fontStyle: "normal" }}>· {tool.summary}</em> : null}
                      </span>
                    ))}
                  </div>
                ) : null}
                {t.text ? <div dangerouslySetInnerHTML={{ __html: renderMarkdown(t.text) }} /> : null}
              </div>
            </div>
          ))}

          {streaming && turns[turns.length - 1]?.role === "user" ? (
            <div className="msg bot">
              <div className="avatar" />
              <div className="body" style={{ paddingTop: 10, width: 120 }}>
                <div className="spinner-line" />
              </div>
            </div>
          ) : null}

          <div ref={endRef} />
        </div>
      </div>

      <div className="composer">
        <div className="composer-inner">
          <div className="field">
            <textarea
              ref={boxRef}
              rows={1}
              value={input}
              placeholder="Describe a page, paste a URL to import, or ask what the data says…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button
              className="btn ghost attach"
              onClick={onOpenMedia}
              disabled={streaming}
              title="Add images or video"
              aria-label="Add images or video"
            >
              {attached.length ? `${attached.length} file${attached.length === 1 ? "" : "s"}` : "Media"}
            </button>
            <button className="btn primary" onClick={onSend} disabled={streaming || !input.trim()}>
              {streaming ? "Working…" : "Send"}
            </button>
          </div>
          {attached.length ? (
            <div className="attached-row">
              {attached.map((a) => (
                <button
                  key={a.id}
                  className="attached-chip"
                  onClick={() => onDetach(a.id)}
                  title={a.description || a.name}
                >
                  {a.kind === "video" ? (
                    <video src={a.url} muted playsInline preload="metadata" />
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={a.url} alt={a.description || a.name} />
                  )}
                  <span className="truncate">{a.description || a.name}</span>
                  <span className="attached-x">×</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="hint">Enter to send · Shift+Enter for a new line</div>
        </div>
      </div>
    </div>
  );
}
