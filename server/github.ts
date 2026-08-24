import { githubSearchQualifier, parseScope, type ParsedScope } from "./scope.js";

const GITHUB_API = "https://api.github.com";

export type GithubUser = {
  login: string;
  name: string | null;
  avatarUrl: string;
};

export type GithubSession = {
  accessToken: string;
  login: string;
  name: string | null;
  avatarUrl: string;
  scope: string;
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

export async function githubRequest<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "aevum",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`GitHub ${response.status}: ${text.slice(0, 500)}`);
    (error as Error & { status: number; body: string }).status = response.status;
    (error as Error & { status: number; body: string }).body = text;
    throw error;
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function exchangeOauthCode(args: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirectUri,
      code: args.code,
    }),
  });
  const payload = (await response.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!payload.access_token) {
    throw new Error(payload.error_description || payload.error || "GitHub OAuth exchange failed");
  }
  return payload.access_token;
}

export async function fetchGithubUser(accessToken: string): Promise<GithubUser> {
  const user = await githubRequest<{ login: string; name: string | null; avatar_url: string }>(
    accessToken,
    "/user",
  );
  return {
    login: user.login,
    name: user.name,
    avatarUrl: user.avatar_url,
  };
}

type SearchIssue = {
  id: number;
  node_id: string;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  comments: number;
  created_at: string;
  updated_at: string;
  user: { login: string; avatar_url: string } | null;
  labels: { name: string; color: string }[];
  pull_request?: { url: string; merged_at: string | null; draft?: boolean };
  repository_url: string;
};

function repoFromSearch(item: SearchIssue): { owner: string; repo: string; fullName: string } {
  const match = /repos\/([^/]+)\/([^/]+)$/.exec(item.repository_url);
  const owner = match?.[1] ?? "";
  const repo = match?.[2] ?? "";
  return { owner, repo, fullName: `${owner}/${repo}` };
}

function toInboxItem(item: SearchIssue): InboxItem {
  const repo = repoFromSearch(item);
  return {
    id: item.id,
    nodeId: item.node_id,
    number: item.number,
    title: item.title,
    body: item.body ?? "",
    htmlUrl: item.html_url,
    repository: repo.fullName,
    owner: repo.owner,
    repo: repo.repo,
    author: item.user?.login ?? "unknown",
    authorAvatarUrl: item.user?.avatar_url ?? null,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    comments: item.comments,
    labels: (item.labels ?? []).map((label) => ({ name: label.name, color: label.color })),
    kind: item.pull_request ? "pull" : "issue",
    draft: item.pull_request?.draft,
    merged: Boolean(item.pull_request?.merged_at),
  };
}

export async function searchInbox(
  accessToken: string,
  scope: ParsedScope,
  kind: "issue" | "pull",
): Promise<InboxItem[]> {
  const type = kind === "pull" ? "is:pr" : "is:issue";
  const q = `is:open ${type} ${githubSearchQualifier(scope)} archived:false`;
  const payload = await githubRequest<{ items: SearchIssue[] }>(
    accessToken,
    `/search/issues?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=40`,
  );
  return (payload.items ?? []).map(toInboxItem);
}

export async function hydratePull(accessToken: string, item: InboxItem): Promise<InboxItem> {
  const pull = await githubRequest<{
    mergeable: boolean | null;
    mergeable_state: string;
    draft: boolean;
    merged: boolean;
    additions: number;
    deletions: number;
    changed_files: number;
    node_id: string;
  }>(accessToken, `/repos/${item.owner}/${item.repo}/pulls/${item.number}`);
  return {
    ...item,
    nodeId: pull.node_id || item.nodeId,
    mergeable: pull.mergeable,
    mergeableState: pull.mergeable_state,
    draft: pull.draft,
    merged: pull.merged,
    additions: pull.additions,
    deletions: pull.deletions,
    changedFiles: pull.changed_files,
  };
}

export async function closeIssueOrPull(accessToken: string, item: Pick<InboxItem, "owner" | "repo" | "number">) {
  await githubRequest(accessToken, `/repos/${item.owner}/${item.repo}/issues/${item.number}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed" }),
  });
}

export async function mergePull(
  accessToken: string,
  item: Pick<InboxItem, "owner" | "repo" | "number" | "nodeId" | "title">,
): Promise<{ merged: boolean; autoMerge: boolean; message: string }> {
  try {
    const result = await githubRequest<{ merged: boolean; message: string }>(
      accessToken,
      `/repos/${item.owner}/${item.repo}/pulls/${item.number}/merge`,
      {
        method: "PUT",
        body: JSON.stringify({ merge_method: "squash", commit_title: item.title }),
      },
    );
    return { merged: result.merged, autoMerge: false, message: result.message || "Merged" };
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    const body = (error as Error & { body?: string }).body ?? "";
    const pending =
      status === 405 ||
      status === 409 ||
      /not mergeable|required status|review|pending/i.test(body);
    if (!pending) throw error;

    const graphql = await githubRequest<{
      data?: { enablePullRequestAutoMerge?: { pullRequest?: { number: number } } };
      errors?: { message: string }[];
    }>(accessToken, "https://api.github.com/graphql", {
      method: "POST",
      body: JSON.stringify({
        query: `mutation($id: ID!) {
          enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: SQUASH }) {
            pullRequest { number }
          }
        }`,
        variables: { id: item.nodeId },
      }),
    });
    if (graphql.errors?.length) {
      throw new Error(graphql.errors.map((entry) => entry.message).join("; "));
    }
    return {
      merged: false,
      autoMerge: true,
      message: "Checks are still running. Auto-merge is enrolled.",
    };
  }
}

export async function commentOnItem(
  accessToken: string,
  item: Pick<InboxItem, "owner" | "repo" | "number">,
  body: string,
) {
  await githubRequest(accessToken, `/repos/${item.owner}/${item.repo}/issues/${item.number}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export async function listAccessibleRepos(accessToken: string, scopeLabel: string): Promise<string[]> {
  const parsed = parseScope(scopeLabel);
  if (parsed.kind === "repo") return [parsed.value];
  const q = parsed.kind === "org" ? `org:${parsed.value}` : `user:${parsed.value}`;
  const payload = await githubRequest<{ items: { full_name: string }[] }>(
    accessToken,
    `/search/repositories?q=${encodeURIComponent(q)}&per_page=20&sort=updated`,
  );
  return (payload.items ?? []).map((item) => item.full_name);
}

