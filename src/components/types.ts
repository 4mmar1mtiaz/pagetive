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

export type ChatRow = { id: string; title: string; updatedAt: string };

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
