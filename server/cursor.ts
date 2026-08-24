const CURSOR_API = "https://api.cursor.com";

export type CursorMe = {
  apiKeyName?: string;
  userEmail?: string;
  userFirstName?: string;
  userLastName?: string;
  userId?: number;
};

export type CursorSession = {
  apiKey: string;
  apiKeyName?: string;
  userEmail?: string;
  displayName?: string;
};

export type CursorAgent = {
  id: string;
  name: string;
  status: string;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
  latestRunId?: string;
  repos?: { url: string; startingRef?: string; prUrl?: string }[];
  autoCreatePR?: boolean;
};

export type CursorRun = {
  id: string;
  agentId: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  durationMs?: number;
  result?: string;
  git?: { branches?: { repoUrl?: string; branch?: string; prUrl?: string }[] };
};

async function cursorFetch<T>(apiKey: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${CURSOR_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`Cursor ${response.status}: ${text.slice(0, 800)}`);
    (error as Error & { status: number }).status = response.status;
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function validateCursorKey(apiKey: string): Promise<CursorMe> {
  return cursorFetch<CursorMe>(apiKey, "/v1/me");
}

export async function listCursorAgents(apiKey: string, limit = 40): Promise<CursorAgent[]> {
  const payload = await cursorFetch<{ items?: CursorAgent[]; agents?: CursorAgent[] }>(
    apiKey,
    `/v1/agents?limit=${limit}&includeArchived=false`,
  );
  return payload.items ?? payload.agents ?? [];
}

export async function getCursorAgent(apiKey: string, id: string): Promise<CursorAgent> {
  return cursorFetch<CursorAgent>(apiKey, `/v1/agents/${encodeURIComponent(id)}`);
}

export async function getCursorRun(apiKey: string, agentId: string, runId: string): Promise<CursorRun> {
  return cursorFetch<CursorRun>(
    apiKey,
    `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`,
  );
}

export async function createCursorAgent(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<{ agent: CursorAgent; run: CursorRun }> {
  return cursorFetch<{ agent: CursorAgent; run: CursorRun }>(apiKey, "/v1/agents", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function displayNameFromMe(me: CursorMe): string | undefined {
  const parts = [me.userFirstName, me.userLastName].filter(Boolean);
  if (parts.length) return parts.join(" ");
  return me.userEmail;
}

