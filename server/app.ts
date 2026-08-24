import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { recordAction, type ActivityAction } from "./activity.js";
import { cookieOptions, fitsInCookie, signPayload, verifyPayload } from "./cookies.js";
import {
  createCursorAgent,
  displayNameFromMe,
  getCursorAgent,
  getCursorRun,
  listCursorAgents,
  validateCursorKey,
  type CursorSession,
} from "./cursor.js";
import { loadEnv, type AppEnv } from "./env.js";
import {
  closeIssueOrPull,
  commentOnItem,
  exchangeOauthCode,
  fetchGithubUser,
  hydratePull,
  listAccessibleRepos,
  mergePull,
  searchInbox,
  type GithubSession,
  type InboxItem,
} from "./github.js";
import {
  assessIssuePrompt,
  assessPullPrompt,
  implementFromPrompt,
  implementIssuePrompt,
  reviewPullPrompt,
} from "./prompts.js";
import { parseScope } from "./scope.js";

const GH_COOKIE = "aevum_gh";
const CURSOR_COOKIE = "aevum_cursor";
const ACTIONS_COOKIE = "aevum_actions";
const STATE_COOKIE = "aevum_oauth_state";

type Variables = {
  env: AppEnv;
  github?: GithubSession;
  cursor?: CursorSession;
};

type AppContext = Context<{ Variables: Variables }>;

function publicGithub(session: GithubSession | undefined) {
  if (!session) return null;
  const scope = parseScope(session.scope, session.login);
  return {
    login: session.login,
    name: session.name,
    avatarUrl: session.avatarUrl,
    scope: scope.label,
  };
}

function publicCursor(session: CursorSession | undefined) {
  if (!session) return null;
  return {
    apiKeyName: session.apiKeyName ?? "connected",
    email: session.userEmail ?? null,
    displayName: session.displayName ?? null,
  };
}

function writeSigned(c: AppContext, name: string, payload: unknown, env: AppEnv) {
  const token = signPayload(payload, env.cookieSecret);
  if (!fitsInCookie(token)) {
    throw new Error(`${name} cookie would exceed browser limits`);
  }
  setCookie(c, name, token, cookieOptions(env.cookieSecure));
}

function readActions(c: AppContext): ActivityAction[] {
  const env = c.get("env");
  return verifyPayload<ActivityAction[]>(getCookie(c, ACTIONS_COOKIE), env.cookieSecret) ?? [];
}

export function createApp(envFactory: () => AppEnv = loadEnv) {
  const app = new Hono<{ Variables: Variables }>();

  app.use("/api/*", async (c, next) => {
    let env: AppEnv;
    try {
      env = envFactory();
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Server is not configured" }, 500);
    }
    c.set("env", env);
    return cors({
      origin: env.allowedOrigin,
      credentials: true,
      allowHeaders: ["Content-Type"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    })(c, next);
  });

  app.use("/api/*", async (c, next) => {
    const env = c.get("env");
    if (!env) return next();
    const github = verifyPayload<GithubSession>(getCookie(c, GH_COOKIE), env.cookieSecret);
    const cursor = verifyPayload<CursorSession>(getCookie(c, CURSOR_COOKIE), env.cookieSecret);
    if (github) c.set("github", github);
    if (cursor) c.set("cursor", cursor);
    await next();
  });

  app.get("/api/health", (c) => c.json({ ok: true, name: "aevum" }));

  app.get("/api/session", (c) =>
    c.json({
      github: publicGithub(c.get("github")),
      cursor: publicCursor(c.get("cursor")),
    }),
  );

  app.get("/api/github/oauth/start", (c) => {
    const env = c.get("env");
    const state = randomBytes(16).toString("hex");
    setCookie(c, STATE_COOKIE, state, {
      ...cookieOptions(env.cookieSecure),
      maxAge: 60 * 10,
    });
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", env.githubClientId);
    url.searchParams.set("redirect_uri", env.githubRedirectUri);
    url.searchParams.set("scope", "repo read:user read:org");
    url.searchParams.set("state", state);
    return c.redirect(url.toString());
  });

  app.get("/api/github/oauth/callback", async (c) => {
    const env = c.get("env");
    const code = c.req.query("code");
    const state = c.req.query("state");
    const expected = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: "/" });
    if (!code || !state || !expected || state !== expected) {
      return c.text("GitHub OAuth state mismatch. Start again from Aevum.", 400);
    }

    const accessToken = await exchangeOauthCode({
      clientId: env.githubClientId,
      clientSecret: env.githubClientSecret,
      redirectUri: env.githubRedirectUri,
      code,
    });
    const user = await fetchGithubUser(accessToken);
    const session: GithubSession = {
      accessToken,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatarUrl,
      scope: `user:${user.login}`,
    };
    writeSigned(c, GH_COOKIE, session, env);
    return c.redirect(env.successRedirectUrl);
  });

  app.post("/api/github/logout", (c) => {
    const env = c.get("env");
    deleteCookie(c, GH_COOKIE, { path: "/", secure: env.cookieSecure });
    deleteCookie(c, ACTIONS_COOKIE, { path: "/", secure: env.cookieSecure });
    return c.json({ ok: true });
  });

  app.post("/api/github/scope", async (c) => {
    const env = c.get("env");
    const github = c.get("github");
    if (!github) return c.json({ error: "Sign in with GitHub first." }, 401);
    const body = await c.req.json<{ scope?: string }>();
    const parsed = parseScope(body.scope, github.login);
    writeSigned(c, GH_COOKIE, { ...github, scope: parsed.label }, env);
    return c.json({ scope: parsed.label });
  });

  app.post("/api/cursor/connect", async (c) => {
    const env = c.get("env");
    const body = await c.req.json<{ apiKey?: string }>();
    const apiKey = body.apiKey?.trim();
    if (!apiKey) return c.json({ error: "Cursor API key is required." }, 400);
    try {
      const me = await validateCursorKey(apiKey);
      const session: CursorSession = {
        apiKey,
        apiKeyName: me.apiKeyName,
        userEmail: me.userEmail,
        displayName: displayNameFromMe(me),
      };
      writeSigned(c, CURSOR_COOKIE, session, env);
      return c.json({ cursor: publicCursor(session) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Cursor key was rejected." }, 400);
    }
  });

  app.post("/api/cursor/disconnect", (c) => {
    const env = c.get("env");
    deleteCookie(c, CURSOR_COOKIE, { path: "/", secure: env.cookieSecure });
    return c.json({ ok: true });
  });

  app.get("/api/inbox", async (c) => {
    const github = c.get("github");
    if (!github) return c.json({ error: "Sign in with GitHub first." }, 401);
    const kind = c.req.query("kind") === "pull" ? "pull" : "issue";
    const scope = parseScope(github.scope, github.login);
    try {
      let items = await searchInbox(github.accessToken, scope, kind);
      if (kind === "pull") {
        const hydrated = await Promise.allSettled(
          items.slice(0, 8).map((item) => hydratePull(github.accessToken, item)),
        );
        items = items.map((item, index) => {
          const result = hydrated[index];
          return result?.status === "fulfilled" ? result.value : item;
        });
      }
      return c.json({ scope: scope.label, items });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "GitHub inbox failed." }, 502);
    }
  });

  app.post("/api/inbox/hydrate", async (c) => {
    const github = c.get("github");
    if (!github) return c.json({ error: "Sign in with GitHub first." }, 401);
    const item = (await c.req.json()) as InboxItem;
    if (item.kind !== "pull") return c.json({ item });
    try {
      return c.json({ item: await hydratePull(github.accessToken, item) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Could not load pull request." }, 502);
    }
  });

  app.get("/api/repos", async (c) => {
    const github = c.get("github");
    if (!github) return c.json({ error: "Sign in with GitHub first." }, 401);
    try {
      const repositories = await listAccessibleRepos(github.accessToken, github.scope);
      return c.json({ repositories });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Could not list repositories." }, 502);
    }
  });

  app.get("/api/activity", async (c) => {
    const actions = readActions(c);
    const cursor = c.get("cursor");
    if (!cursor) return c.json({ actions, sessions: [] });
    try {
      const sessions = await listCursorAgents(cursor.apiKey);
      return c.json({ actions, sessions });
    } catch (error) {
      return c.json({
        actions,
        sessions: [],
        sessionsError: error instanceof Error ? error.message : "Could not list Cursor agents.",
      });
    }
  });

  app.get("/api/cursor/agents/:id", async (c) => {
    const cursor = c.get("cursor");
    if (!cursor) return c.json({ error: "Connect a Cursor API key first." }, 401);
    const id = c.req.param("id");
    try {
      const agent = await getCursorAgent(cursor.apiKey, id);
      const run = agent.latestRunId ? await getCursorRun(cursor.apiKey, id, agent.latestRunId) : null;
      return c.json({ agent, run });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Could not load agent." }, 502);
    }
  });

  app.post("/api/actions/comment", async (c) => {
    const github = c.get("github");
    if (!github) return c.json({ error: "Sign in with GitHub first." }, 401);
    const body = await c.req.json<{ item: InboxItem; body: string; mentionCursor?: boolean }>();
    if (!body.item || !body.body?.trim()) return c.json({ error: "Comment text is required." }, 400);
    const text = body.mentionCursor ? `${body.body.trim()}\n\n@cursor` : body.body.trim();
    await commentOnItem(github.accessToken, body.item, text);
    const actions = recordAction(readActions(c), {
      kind: "comment",
      title: `Commented on ${body.item.kind === "pull" ? "PR" : "issue"} #${body.item.number}`,
      detail: body.item.title,
      repository: body.item.repository,
      htmlUrl: body.item.htmlUrl,
    });
    writeSigned(c, ACTIONS_COOKIE, actions, c.get("env"));
    return c.json({ ok: true, actions });
  });

  app.post("/api/actions/close", async (c) => {
    const github = c.get("github");
    if (!github) return c.json({ error: "Sign in with GitHub first." }, 401);
    const item = ((await c.req.json()) as { item: InboxItem }).item;
    await closeIssueOrPull(github.accessToken, item);
    const actions = recordAction(readActions(c), {
      kind: item.kind === "pull" ? "close_pull" : "close_issue",
      title: `Closed ${item.kind === "pull" ? "PR" : "issue"} #${item.number}`,
      detail: item.title,
      repository: item.repository,
      htmlUrl: item.htmlUrl,
    });
    writeSigned(c, ACTIONS_COOKIE, actions, c.get("env"));
    return c.json({ ok: true, actions });
  });

  app.post("/api/actions/merge", async (c) => {
    const github = c.get("github");
    if (!github) return c.json({ error: "Sign in with GitHub first." }, 401);
    const item = ((await c.req.json()) as { item: InboxItem }).item;
    const result = await mergePull(github.accessToken, item);
    const actions = recordAction(readActions(c), {
      kind: result.autoMerge ? "auto_merge_pull" : "merge_pull",
      title: result.autoMerge ? `Auto-merge enrolled for PR #${item.number}` : `Merged PR #${item.number}`,
      detail: result.message,
      repository: item.repository,
      htmlUrl: item.htmlUrl,
    });
    writeSigned(c, ACTIONS_COOKIE, actions, c.get("env"));
    return c.json({ ok: true, result, actions });
  });

  app.post("/api/actions/skip", async (c) => {
    const item = ((await c.req.json()) as { item: InboxItem }).item;
    const actions = recordAction(readActions(c), {
      kind: "skip",
      title: `Skipped ${item.kind === "pull" ? "PR" : "issue"} #${item.number}`,
      detail: item.title,
      repository: item.repository,
      htmlUrl: item.htmlUrl,
    });
    writeSigned(c, ACTIONS_COOKIE, actions, c.get("env"));
    return c.json({ ok: true, actions });
  });

  async function launchAgent(
    c: AppContext,
    args: {
      kind: "launch_implement" | "launch_assess" | "launch_review";
      title: string;
      detail: string;
      item?: InboxItem;
      repository?: string;
      htmlUrl?: string;
      body: Record<string, unknown>;
    },
  ) {
    const cursor = c.get("cursor");
    if (!cursor) return c.json({ error: "Connect a Cursor API key first." }, 401);
    const created = await createCursorAgent(cursor.apiKey, args.body);
    const actions = recordAction(readActions(c), {
      kind: args.kind,
      title: args.title,
      detail: args.detail,
      repository: args.repository ?? args.item?.repository,
      htmlUrl: args.htmlUrl ?? args.item?.htmlUrl,
      agentId: created.agent.id,
      agentUrl: created.agent.url,
    });
    writeSigned(c, ACTIONS_COOKIE, actions, c.get("env"));
    return c.json({ ok: true, agent: created.agent, run: created.run, actions });
  }

  app.post("/api/agents/implement", async (c) => {
    const github = c.get("github");
    if (!github) return c.json({ error: "Sign in with GitHub first." }, 401);
    const item = ((await c.req.json()) as { item: InboxItem }).item;
    return launchAgent(c, {
      kind: "launch_implement",
      title: `Cursor implementing issue #${item.number}`,
      detail: item.title,
      item,
      body: {
        name: `Issue #${item.number}: ${item.title}`.slice(0, 100),
        prompt: { text: implementIssuePrompt(item) },
        repos: [{ url: `https://github.com/${item.repository}` }],
        autoCreatePR: true,
      },
    });
  });

  app.post("/api/agents/assess", async (c) => {
    const item = ((await c.req.json()) as { item: InboxItem }).item;
    const isPull = item.kind === "pull";
    return launchAgent(c, {
      kind: "launch_assess",
      title: `Cursor assessing ${isPull ? "PR" : "issue"} #${item.number}`,
      detail: item.title,
      item,
      body: {
        name: `Assess #${item.number}: ${item.title}`.slice(0, 100),
        prompt: { text: isPull ? assessPullPrompt(item) : assessIssuePrompt(item) },
        mode: "plan",
        autoCreatePR: false,
        repos: [
          {
            url: `https://github.com/${item.repository}`,
            ...(isPull ? { prUrl: item.htmlUrl } : {}),
          },
        ],
      },
    });
  });

  app.post("/api/agents/review", async (c) => {
    const item = ((await c.req.json()) as { item: InboxItem }).item;
    return launchAgent(c, {
      kind: "launch_review",
      title: `Cursor reviewing PR #${item.number}`,
      detail: item.title,
      item,
      body: {
        name: `Review #${item.number}: ${item.title}`.slice(0, 100),
        prompt: { text: reviewPullPrompt(item) },
        autoCreatePR: false,
        repos: [{ url: `https://github.com/${item.repository}`, prUrl: item.htmlUrl }],
      },
    });
  });

  app.post("/api/agents/code", async (c) => {
    const body = await c.req.json<{
      repository: string;
      prompt: string;
      autoCreatePR?: boolean;
      mode?: "agent" | "plan";
      startingRef?: string;
      machine?: string;
    }>();
    if (!body.repository || !body.prompt?.trim()) {
      return c.json({ error: "Repository and prompt are required." }, 400);
    }
    const repoUrl = body.repository.startsWith("http")
      ? body.repository
      : `https://github.com/${body.repository}`;
    const payload: Record<string, unknown> = {
      name: body.prompt.trim().slice(0, 100),
      prompt: { text: implementFromPrompt(body.repository, body.prompt.trim()) },
      repos: [{ url: repoUrl, ...(body.startingRef ? { startingRef: body.startingRef } : {}) }],
      autoCreatePR: body.autoCreatePR !== false,
      mode: body.mode === "plan" ? "plan" : "agent",
    };
    if (body.machine?.trim()) {
      payload.env = { type: "machine", name: body.machine.trim() };
      delete payload.repos;
    }
    return launchAgent(c, {
      kind: "launch_implement",
      title: "Cursor implementation request",
      detail: body.prompt.trim(),
      repository: body.repository,
      body: payload,
    });
  });

  app.notFound((c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "Not found" }, 404);
    return c.text("Not found", 404);
  });

  return app;
}

export const app = createApp();
