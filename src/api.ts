import type { ActivityAction, CursorAgent, CursorRun, InboxItem, Session } from "./types";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

export const api = {
  session: () => request<Session>("/api/session"),
  inbox: (kind: "issue" | "pull") => request<{ scope: string; items: InboxItem[] }>(`/api/inbox?kind=${kind}`),
  repos: () => request<{ repositories: string[] }>("/api/repos"),
  activity: () =>
    request<{ actions: ActivityAction[]; sessions: CursorAgent[]; sessionsError?: string }>("/api/activity"),
  agent: (id: string) => request<{ agent: CursorAgent; run: CursorRun | null }>(`/api/cursor/agents/${id}`),
  setScope: (scope: string) => request<{ scope: string }>("/api/github/scope", { method: "POST", body: JSON.stringify({ scope }) }),
  connectCursor: (apiKey: string) =>
    request<{ cursor: Session["cursor"] }>("/api/cursor/connect", { method: "POST", body: JSON.stringify({ apiKey }) }),
  disconnectCursor: () => request("/api/cursor/disconnect", { method: "POST" }),
  logout: () => request("/api/github/logout", { method: "POST" }),
  close: (item: InboxItem) => request("/api/actions/close", { method: "POST", body: JSON.stringify({ item }) }),
  merge: (item: InboxItem) =>
    request<{ result: { merged: boolean; autoMerge: boolean; message: string } }>("/api/actions/merge", {
      method: "POST",
      body: JSON.stringify({ item }),
    }),
  skip: (item: InboxItem) => request("/api/actions/skip", { method: "POST", body: JSON.stringify({ item }) }),
  comment: (item: InboxItem, body: string, mentionCursor: boolean) =>
    request("/api/actions/comment", { method: "POST", body: JSON.stringify({ item, body, mentionCursor }) }),
  implement: (item: InboxItem) => request("/api/agents/implement", { method: "POST", body: JSON.stringify({ item }) }),
  assess: (item: InboxItem) => request("/api/agents/assess", { method: "POST", body: JSON.stringify({ item }) }),
  review: (item: InboxItem) => request("/api/agents/review", { method: "POST", body: JSON.stringify({ item }) }),
  code: (payload: {
    repository: string;
    prompt: string;
    autoCreatePR?: boolean;
    mode?: "agent" | "plan";
    startingRef?: string;
    machine?: string;
  }) => request("/api/agents/code", { method: "POST", body: JSON.stringify(payload) }),
};
