export type PageRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  source: string;
  variants: number;
  impressions: number;
  conversions: number;
  leads: number;
  updatedAt: string;
};

/** `pageId` is the page this thread is about, set the first time a tool in it
 *  touches one. Null means the thread has not built anything yet. */
export type ChatRow = { id: string; title: string; pageId: string | null; updatedAt: string };

export type ToolCall = {
  name: string;
  state: "running" | "done" | "failed";
  summary?: string;
};

export type Turn = {
  role: "user" | "assistant";
  text: string;
  tools: ToolCall[];
};

export type PlanState = {
  name: string;
  label: string;
  maxPages: number | null;
  canPublish: boolean;
  canExport: boolean;
  canAttachDomain: boolean;
  canSimulate: boolean;
  pagesCreated: number;
  isAdmin: boolean;
  suspended: boolean;
};

/** An uploaded image or video, as the workspace sees it. */
export type AssetRow = {
  id: string;
  kind: "image" | "video";
  url: string;
  name: string;
  description: string;
  bytes: number;
  createdAt: string;
};
