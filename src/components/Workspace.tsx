"use client";

import { useCallback, useEffect, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import { Chat } from "@/components/Chat";
import { Rail } from "@/components/Rail";
import type { ChatRow, PageRow, PlanState, Turn } from "@/components/types";

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
  const [chatId, setChatId] = useState<string | null>(null);
  const [chatTitle, setChatTitle] = useState("New page");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [turnCost, setTurnCost] = useState<number | null>(null);
  const [plan, setPlan] = useState<PlanState | null>(null);

  const loadPages = useCallback(async () => {
    const r = await fetch("/api/pages").then((x) => x.json());
    setPages(r.pages ?? []);
    if (r.plan) setPlan(r.plan);
    setActivePageId((current) => current ?? r.pages?.[0]?.id ?? null);
  }, []);

  const loadChats = useCallback(async () => {
    const r = await fetch("/api/chats").then((x) => x.json());
    setChats(r.chats ?? []);
  }, []);

  useEffect(() => {
    loadPages();
    loadChats();
  }, [loadPages, loadChats]);

  async function openChat(id: string, title: string) {
    setChatId(id);
    setChatTitle(title);
    const r = await fetch(`/api/chats/${id}`).then((x) => x.json());
    setTurns(
      (r.messages ?? []).map((m: { role: "user" | "assistant"; text: string; tools: string[] }) => ({
        role: m.role,
        text: m.text,
        tools: (m.tools ?? []).map((name: string) => ({ name, state: "done" as const })),
      })),
    );
  }

  function newChat() {
    setChatId(null);
    setChatTitle("New page");
    setTurns([]);
  }

  const send = useCallback(
    async (override?: string) => {
      const text = (override ?? input).trim();
      if (!text || streaming) return;

      setInput("");
      setStreaming(true);
      setTurnCost(null);
      setTurns((t) => [...t, { role: "user", text, tools: [] }]);

      const patchLast = (fn: (t: Turn) => Turn) =>
        setTurns((all) => {
          const copy = [...all];
          const last = copy[copy.length - 1];
          if (!last || last.role !== "assistant") {
            copy.push(fn({ role: "assistant", text: "", tools: [] }));
          } else {
            copy[copy.length - 1] = fn(last);
          }
          return copy;
        });

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chatId, message: text }),
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
                setChatId(String(evt.chatId));
                break;
              case "cost":
                setTurnCost(Number(evt.usd));
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
                  setActivePageId(result.pageId);
                  touchedPage = true;
                }
                if (!failed) touchedPage = true;
                break;
              }
              case "error":
                patchLast((t) => ({ ...t, text: `${t.text}\n\n**${String(evt.message)}**` }));
                break;
              case "done":
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
        setStreaming(false);
        loadChats();
        loadPages();
        setRefreshKey((k) => k + 1);
      }
    },
    [chatId, input, streaming, loadChats, loadPages],
  );

  const activePage = pages.find((p) => p.id === activePageId) ?? null;

  return (
    <div className="app">
      <aside className="glass col sidebar">
        <div className="brand">
          <div className="mark" />
          <div>
            <div className="name chrome">Adaptive LP</div>
            <div className="sub">one page, many versions</div>
          </div>
        </div>

        <div style={{ padding: "0 14px 12px" }}>
          <button className="btn primary" style={{ width: "100%" }} onClick={newChat}>
            + New page
          </button>
        </div>

        <div className="side-scroll">
          <div className="side-label">
            <span>Pages</span>
            <span>{pages.length}</span>
          </div>
          {pages.map((p) => (
            <button
              key={p.id}
              className={`item ${p.id === activePageId ? "active" : ""}`}
              onClick={() => setActivePageId(p.id)}
            >
              <div className="row">
                <span className="truncate">{p.name}</span>
                <span className={`dot ${p.status === "live" ? "live" : "draft"}`} />
              </div>
              <div className="meta">
                {p.impressions} views · {p.leads} leads · {p.variants} variants
              </div>
            </button>
          ))}
          {pages.length === 0 ? (
            <div style={{ padding: "4px 10px", fontSize: 12, color: "var(--silver-faint)" }}>
              Nothing built yet.
            </div>
          ) : null}

          <div className="side-label">
            <span>Threads</span>
          </div>
          {chats.map((c) => (
            <button
              key={c.id}
              className={`item ${c.id === chatId ? "active" : ""}`}
              onClick={() => openChat(c.id, c.title)}
            >
              <div className="truncate">{c.title}</div>
            </button>
          ))}
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
          {plan.isAdmin ? (
            <a className="btn sm ghost" href="/admin" title="Manage accounts">
              Accounts
            </a>
          ) : null}
        </div>
      ) : null}
      </aside>

      <main className="col">
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
        />
      </main>

      <Rail
        page={activePage}
        plan={plan}
        onChanged={() => {
          loadPages();
          setRefreshKey((k) => k + 1);
        }}
        refreshKey={refreshKey}
      />
    </div>
  );
}
