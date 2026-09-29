"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import { Chat } from "@/components/Chat";
import { KeyPanel } from "@/components/KeyPanel";
import { MediaDialog } from "@/components/MediaDialog";
import { Rail } from "@/components/Rail";
import type { AssetRow, ChatRow, PageRow, PlanState, Turn } from "@/components/types";
import { Spinner } from "@/components/Spinner";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/brand-name";

type Notice = { key: string; title: string; pageId: string | null };

let counter = 0;
/** A key for a thread the server has not named yet. */
function freshKey(): string {
  counter += 1;
  return `new:${Date.now()}:${counter}`;
}

/**
 * The whole app is this screen: what you have on the left, the conversation in
 * the middle, the page itself on the right.
 *
 * The chat stream is read by hand rather than with an EventSource because the
 * turn is a POST — EventSource only does GET, and putting a whole build request
 * in a query string is not a thing. The parser below is the standard
 * split-on-blank-line SSE frame reader.
 */
export function Workspace({ clerkOn }: { clerkOn: boolean }) {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [chats, setChats] = useState<ChatRow[]>([]);
  // Every conversation keeps its own transcript, keyed by chat id (or a
  // "new:" key until the server hands one back). A reply streams into the
  // thread that asked for it, never into whichever thread is on screen, so
  // switching pages mid-reply cannot mix two conversations together.
  const [threads, setThreads] = useState<Record<string, Turn[]>>({});
  const [viewKey, setViewKey] = useState<string>(freshKey);
  const [chatTitle, setChatTitle] = useState("New page");
  const [busyKeys, setBusyKeys] = useState<string[]>([]);
  const [costs, setCosts] = useState<Record<string, number>>({});
  const [notices, setNotices] = useState<Notice[]>([]);
  const [input, setInput] = useState("");
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [keyPrompt, setKeyPrompt] = useState<string | null>(null);
  const [showKeyPanel, setShowKeyPanel] = useState(false);
  const [freeLeft, setFreeLeft] = useState<number | null>(null);
  const [attached, setAttached] = useState<AssetRow[]>([]);
  const [showMedia, setShowMedia] = useState(false);
  // The rail is empty until the first fetch lands. On a cold load against a
  // database in another region that is a second of blank sidebar, which reads
  // as an account with nothing in it rather than as an account still loading.
  const [loadingLists, setLoadingLists] = useState(true);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  // Phone and tablet widths cannot fit three columns, so one panel shows at a
  // time and a tab bar switches between them. Desktop ignores this entirely:
  // the CSS only reads it below the breakpoints.
  const [mobileView, setMobileView] = useState<"pages" | "chat" | "page">("chat");

  // Read inside a running stream, where the state captured at send time is stale.
  const viewRef = useRef(viewKey);
  viewRef.current = viewKey;
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const busyKeysRef = useRef(busyKeys);
  busyKeysRef.current = busyKeys;
  /** Which page each in-memory thread is about, and what it is called. */
  const threadPage = useRef<Record<string, string | null>>({});
  const threadTitle = useRef<Record<string, string>>({});

  const turns = threads[viewKey] ?? [];
  const streaming = busyKeys.includes(viewKey);
  const turnCost = costs[viewKey] ?? null;

  // Only the very first load picks a page. Every later refresh must leave the
  // selection alone: "New page" deliberately clears it, and re-selecting on the
  // next poll would put the preview back and undo the button.
  const selectedOnce = useRef(false);

  const loadPages = useCallback(async () => {
    const r = await fetch("/api/pages").then((x) => x.json());
    setPages(r.pages ?? []);
    if (r.plan) setPlan(r.plan);
    if (!selectedOnce.current && r.pages?.[0]?.id) {
      selectedOnce.current = true;
      setActivePageId((current) => current ?? r.pages[0].id);
    }
  }, []);

  const loadChats = useCallback(async () => {
    const r = await fetch("/api/chats").then((x) => x.json());
    setChats(r.chats ?? []);
  }, []);

  useEffect(() => {
    Promise.allSettled([loadPages(), loadChats()]).finally(() => setLoadingLists(false));
  }, [loadPages, loadChats]);

  function dismissNotice(key: string) {
    setNotices((all) => all.filter((n) => n.key !== key));
  }

  async function openChat(id: string, title: string) {
    setViewKey(id);
    setChatTitle(title);
    dismissNotice(id);
    // A thread that is still answering already holds the freshest transcript;
    // reloading it from the database would drop the half-written reply.
    if (busyKeysRef.current.includes(id)) return;
    if (!threadsRef.current[id]) setLoadingKey(id);
    try {
      const r = await fetch(`/api/chats/${id}`).then((x) => x.json());
      if (busyKeysRef.current.includes(id)) return;
      setThreads((all) => ({
        ...all,
        [id]: (r.messages ?? []).map((m: { role: "user" | "assistant"; text: string; tools: string[] }) => ({
          role: m.role,
          text: m.text,
          tools: (m.tools ?? []).map((name: string) => ({ name, state: "done" as const })),
        })),
      }));
    } finally {
      setLoadingKey((k) => (k === id ? null : k));
    }
  }

  /**
   * Another conversation about the page already on screen.
   *
   * The preview deliberately stays: you are still working on this page, you
   * just want a clean thread to do it in.
   */
  function newChat() {
    setMobileView("chat");
    setViewKey(freshKey());
    const page = pages.find((p) => p.id === activePageId);
    setChatTitle(page ? `New chat · ${page.name}` : "New chat");
  }

  /**
   * A blank slate for something that does not exist yet.
   *
   * Clearing the selection is the point: with no page selected the preview goes
   * empty and the agent is told to build rather than edit.
   */
  function newPage() {
    setMobileView("chat");
    setViewKey(freshKey());
    setActivePageId(null);
    setChatTitle("New page");
  }

  /**
   * Selecting a page brings its conversation with it.
   *
   * A thread is bound to the page it built, so the preview and the transcript
   * always describe the same thing. A thread still answering for this page wins
   * over the stored list, which does not know about it yet. A page with no
   * thread gets an empty one rather than inheriting whatever was on screen.
   */
  function selectPage(id: string) {
    setActivePageId(id);
    setMobileView("chat");
    const live = busyKeysRef.current.find((k) => threadPage.current[k] === id);
    if (live) {
      openChat(live, threadTitle.current[live] ?? "Chat");
      return;
    }
    const thread = chats.find((c) => c.pageId === id);
    if (thread) {
      openChat(thread.id, thread.title);
      return;
    }
    setViewKey(freshKey());
    setChatTitle(pages.find((p) => p.id === id)?.name ?? "New chat");
  }

  async function send(override?: string) {
    const text = (override ?? input).trim();
    if (!text || busyKeysRef.current.includes(viewKey)) return;

    // Everything this turn needs is pinned now. The person may be on another
    // page by the time the reply arrives.
    let key = viewKey;
    const chatId = key.startsWith("new:") ? null : key;
    const pageId = activePageId;
    const title = chatId ? chatTitle : text.slice(0, 60);
    threadPage.current[key] = pageId;
    threadTitle.current[key] = title;
    if (!chatId) setChatTitle(title);

    setInput("");
    // Attachments belong to the message they were sent with, not to the
    // thread. Leaving them on would silently re-send the same files next turn.
    const assetIds = attached.map((a) => a.id);
    setAttached([]);
    setBusyKeys((b) => [...b, key]);
    setCosts(({ [key]: _gone, ...rest }) => rest);
    setThreads((all) => ({ ...all, [key]: [...(all[key] ?? []), { role: "user", text, tools: [] }] }));

    const onScreen = () => viewRef.current === key;

    const patchLast = (fn: (t: Turn) => Turn) =>
      setThreads((all) => {
        const copy = [...(all[key] ?? [])];
        const last = copy[copy.length - 1];
        if (!last || last.role !== "assistant") {
          copy.push(fn({ role: "assistant", text: "", tools: [] }));
        } else {
          copy[copy.length - 1] = fn(last);
        }
        return { ...all, [key]: copy };
      });

    /** The server named the new thread: move it from its temporary key. */
    const adopt = (id: string) => {
      if (id === key) return;
      const old = key;
      key = id;
      threadPage.current[id] = threadPage.current[old];
      threadTitle.current[id] = threadTitle.current[old];
      setThreads(({ [old]: moved, ...rest }) => ({ ...rest, [id]: moved ?? [] }));
      setBusyKeys((b) => b.map((k) => (k === old ? id : k)));
      if (viewRef.current === old) setViewKey(id);
      loadChats();
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId, message: text, pageId, assetIds }),
      });
      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let touchedPage = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }

          switch (evt.type) {
            case "chat":
              adopt(String(evt.chatId));
              break;
            case "needs_key":
              // The free messages are spent. Not an error: the wall is the
              // business model working as intended, so it gets the panel and
              // an explanation rather than a red line in the transcript.
              setKeyPrompt(String(evt.message));
              setShowKeyPanel(true);
              break;
            case "cost":
              setCosts((c) => ({ ...c, [key]: Number(evt.usd) }));
              break;
            case "text":
              patchLast((t) => ({ ...t, text: t.text + String(evt.text ?? "") }));
              break;
            case "tool":
              patchLast((t) => ({
                ...t,
                tools: [...t.tools, { name: String(evt.name), state: "running" }],
              }));
              break;
            case "tool_done": {
              const result = (evt.result ?? {}) as Record<string, unknown>;
              const failed = Boolean(result.error);
              patchLast((t) => {
                const tools = [...t.tools];
                for (let i = tools.length - 1; i >= 0; i--) {
                  if (tools[i].name === evt.name && tools[i].state === "running") {
                    tools[i] = {
                      ...tools[i],
                      state: failed ? "failed" : "done",
                      summary: failed ? String(result.error).slice(0, 70) : undefined,
                    };
                    break;
                  }
                }
                return { ...t, tools };
              });
              if (typeof result.pageId === "string") {
                threadPage.current[key] = result.pageId;
                // Only move the preview if this thread is the one on screen.
                // Otherwise the page somebody switched to would be yanked away.
                if (onScreen()) setActivePageId(result.pageId);
                touchedPage = true;
              }
              if (!failed) touchedPage = true;
              break;
            }
            case "error":
              patchLast((t) => ({ ...t, text: `${t.text}\n\n**${String(evt.message)}**` }));
              break;
            case "done":
              if (typeof evt.freeRemaining === "number") setFreeLeft(evt.freeRemaining);
              if (touchedPage) {
                loadPages();
                setRefreshKey((k) => k + 1);
              }
              break;
          }
        }
      }
    } catch (err) {
      patchLast((t) => ({ ...t, text: `${t.text}\n\n**${(err as Error).message}**` }));
    } finally {
      setBusyKeys((b) => b.filter((k) => k !== key));
      // The reply landed in a thread nobody is looking at. Say so, and make the
      // notice the way back to it.
      if (!onScreen()) {
        const done: Notice = { key, title: threadTitle.current[key] ?? "Chat", pageId: threadPage.current[key] ?? null };
        setNotices((all) => [...all.filter((n) => n.key !== key), done]);
        setTimeout(() => dismissNotice(done.key), 12000);
      }
      loadChats();
      loadPages();
      setRefreshKey((k) => k + 1);
    }
  }

  const activePage = pages.find((p) => p.id === activePageId) ?? null;

  return (
    <div className={`app view-${mobileView}`}>
      <nav className="mobile-bar glass" aria-label="Workspace sections">
        <div className="mark" />
        <div className="tabs">
          {(
            [
              ["pages", "Pages"],
              ["chat", "Chat"],
              ["page", "Preview"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={`tab ${mobileView === v ? "active" : ""} ${v === "pages" ? "only-phone" : ""}`}
              onClick={() => setMobileView(v)}
              aria-pressed={mobileView === v}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
      <aside className="glass col sidebar">
        <div className="brand">
          <div className="mark" />
          <div>
            <div className="name chrome">{PRODUCT_NAME}</div>
            <div className="sub">{PRODUCT_TAGLINE}</div>
          </div>
        </div>

        <div style={{ padding: "0 14px 12px", display: "flex", gap: 8 }}>
          <button className="btn primary" style={{ flex: 1 }} onClick={newPage}>
            + New page
          </button>
          <button
            className="btn ghost"
            style={{ flex: 1 }}
            onClick={newChat}
            title={
              activePageId
                ? "A fresh thread about the page you have selected"
                : "Select a page first, or start a new one"
            }
          >
            + New chat
          </button>
        </div>

        <div className="side-scroll">
          <div className="side-label">
            <span>Pages</span>
            <span>{pages.length}</span>
          </div>
          {/* The counts on this row are the reason somebody wants the report, so
              the way into it belongs on this row rather than two clicks away. It
              sits outside the button because a link inside a button is not a
              thing browsers agree on. */}
          {pages.map((p) => (
            <div key={p.id} style={{ position: "relative" }}>
              <button
                className={`item ${p.id === activePageId ? "active" : ""}`}
                onClick={() => selectPage(p.id)}
                style={{ paddingRight: 66 }}
              >
                <div className="row">
                  <span className="truncate">{p.name}</span>
                  {/* A page somebody shared with you sits in the same list as
                      your own, so it has to say which it is. */}
                  {p.shared ? <span className="tag">shared</span> : null}
                  <span className={`dot ${p.status === "live" ? "live" : "draft"}`} />
                </div>
                <div className="meta">
                  {p.impressions} views · {p.leads} leads · {p.variants} {p.variants === 1 ? "angle" : "angles"}
                </div>
              </button>
              <a
                href={`/pages/${p.id}`}
                title="Traffic, versions, per-version preview, heatmap and leads"
                style={{
                  position: "absolute",
                  right: 10,
                  bottom: 8,
                  fontSize: 11,
                  color: "var(--silver-faint)",
                  textDecoration: "none",
                }}
              >
                report →
              </a>
            </div>
          ))}
          {loadingLists && pages.length === 0 ? (
            <div style={{ padding: "0 10px" }}>
              <Spinner block label="Loading pages" />
            </div>
          ) : null}
          {!loadingLists && pages.length === 0 ? (
            <div style={{ padding: "4px 10px", fontSize: 12, color: "var(--silver-faint)" }}>
              Nothing built yet. Pages you build or import in the chat land here, with their views and leads.
              <div style={{ marginTop: 8 }}>
                <button type="button" className="btn sm ghost" onClick={newPage}>
                  Build your first page
                </button>
              </div>
            </div>
          ) : null}

          <div className="side-label">
            <span>Threads</span>
          </div>
          {chats.map((c) => (
            <button
              key={c.id}
              className={`item ${c.id === viewKey ? "active" : ""}`}
              onClick={() => {
                openChat(c.id, c.title);
                setActivePageId(threadPage.current[c.id] ?? c.pageId);
                setMobileView("chat");
              }}
            >
              <div className="row">
                <span className="truncate">{c.title}</span>
                {busyKeys.includes(c.id) ? <span className="spin" title="Replying" /> : null}
              </div>
            </button>
          ))}
          {!loadingLists && chats.length === 0 ? (
            <div style={{ padding: "4px 10px", fontSize: 12, color: "var(--silver-faint)" }}>
              Every conversation is kept here, next to the page it built.
            </div>
          ) : null}
        </div>
      {/* Plan and account sit at the bottom of the rail, out of the way until
          they matter — which is the moment a limit is hit. */}
      {plan ? (
        <div
          style={{
            borderTop: "1px solid var(--line)",
            padding: "12px 14px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
          className="sidebar-foot"
        >
          {clerkOn ? <UserButton /> : null}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "#fff" }}>{plan.label}</div>
            <div style={{ fontSize: 11, color: "var(--silver-faint)" }}>
              {plan.maxPages === null
                ? "Everything unlocked"
                : `${Math.min(plan.pagesCreated, plan.maxPages)}/${plan.maxPages} page${plan.maxPages === 1 ? "" : "s"} used · preview only`}
            </div>
          </div>
          <button
            className="btn sm ghost"
            onClick={() => setShowKeyPanel((v) => !v)}
            title="Anthropic API key"
          >
            {freeLeft !== null && freeLeft <= 3 ? `${freeLeft} left` : "Key"}
          </button>
          {plan.isAdmin ? (
            <a className="btn sm ghost" href="/admin" title="Manage accounts">
              Accounts
            </a>
          ) : null}
        </div>
      ) : null}
      </aside>

      <main className="col main">
        {showKeyPanel ? (
          <div style={{ padding: "0 0 4px" }}>
            <KeyPanel
              message={keyPrompt ?? undefined}
              onSaved={() => {
                setShowKeyPanel(false);
                setKeyPrompt(null);
                setFreeLeft(null);
              }}
              onDismiss={() => setShowKeyPanel(false)}
            />
          </div>
        ) : null}
        <Chat
          turns={turns}
          streaming={streaming}
          input={input}
          setInput={setInput}
          onSend={() => send()}
          onStarter={(t) => send(t)}
          chatTitle={chatTitle}
          onNewChat={newChat}
          cost={turnCost}
          loadingThread={loadingKey === viewKey}
          attached={attached}
          onOpenMedia={() => setShowMedia(true)}
          onDetach={(id) => setAttached((all) => all.filter((a) => a.id !== id))}
        />

        {showMedia ? (
          <MediaDialog
            alreadyAttached={attached.map((a) => a.id)}
            onAttach={setAttached}
            onClose={() => setShowMedia(false)}
          />
        ) : null}
      </main>

      {notices.length ? (
        <div className="toasts" role="status">
          {notices.map((n) => (
            <div key={n.key} className="toast fade-in">
              <button
                type="button"
                className="toast-open"
                onClick={() => {
                  openChat(n.key, n.title);
                  setActivePageId(n.pageId);
                  setMobileView("chat");
                }}
              >
                <b>Reply received</b>
                <span className="truncate">{n.title}</span>
              </button>
              <button type="button" className="btn sm ghost" onClick={() => dismissNotice(n.key)} aria-label="Dismiss">
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <Rail
        page={activePage}
        plan={plan}
        onChanged={() => {
          loadPages();
          setRefreshKey((k) => k + 1);
        }}
        refreshKey={refreshKey}
        onAsk={(text) => {
          setMobileView("chat");
          send(text);
        }}
        onStart={newPage}
        onOpenKeys={() => {
          setKeyPrompt(null);
          setShowKeyPanel(true);
        }}
      />
    </div>
  );
}
