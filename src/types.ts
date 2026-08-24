export type GithubProfile = {
  login: string;
  name: string | null;
  avatarUrl: string;
  scope: string;
};

export type CursorProfile = {
  apiKeyName: string;
  email: string | null;
  displayName: string | null;
};

export type Session = {
  github: GithubProfile | null;
  cursor: CursorProfile | null;
};

export type InboxItem = {
  id: number;
  nodeId: string;
  number: number;
  title: string;
  body: string;
  htmlUrl: string;
  repository: string;
  owner: string;
  repo: string;
  author: string;
  authorAvatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  comments: number;
  labels: { name: string; color: string }[];
  kind: "issue" | "pull";
  draft?: boolean;
  merged?: boolean;
  mergeable?: boolean | null;
  mergeableState?: string | null;
  reviewDecision?: string | null;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
};

export type ActivityAction = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  repository?: string;
  htmlUrl?: string;
  agentId?: string;
  agentUrl?: string;
  createdAt: string;
};

export type CursorAgent = {
  id: string;
  name: string;
  status: string;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
  latestRunId?: string;
};

export type CursorRun = {
  id: string;
  agentId: string;
  status: string;
  result?: string;
  durationMs?: number;
};
