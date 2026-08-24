import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { api } from "./api";
import type { ActivityAction, CursorAgent, GithubProfile, InboxItem, Session } from "./types";

type Tab = "issues" | "pulls" | "activity" | "code" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "issues", label: "Issues" },
  { id: "pulls", label: "PRs" },
  { id: "activity", label: "Activity" },
  { id: "code", label: "Code" },
  { id: "settings", label: "Settings" },
];

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("issues");
  const [toast, setToast] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    const next = await api.session();
    setSession(next);
    return next;
  }, []);

  useEffect(() => {
    refreshSession().catch((error: Error) => setBootError(error.message));
  }, [refreshSession]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (bootError && !session) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>Aevum</h1>
          <p className="error">{bootError}</p>
          <p className="muted">Copy `.env.example` to `.env.local`, then run `npm run dev:all`.</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>Aevum</h1>
          <p className="muted">Loading session…</p>
        </div>
      </div>
    );
  }

  if (!session.github) return <GithubGate />;
  if (!session.cursor) {
    return <CursorGate github={session.github} onConnected={() => refreshSession().then(() => undefined)} />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>Aevum</strong>
          <span>Cursor control plane</span>
        </div>
        <div className="user-chip">
          <img className="avatar" src={session.github.avatarUrl} alt="" />
          <span>{session.github.scope}</span>
        </div>
      </header>
      <nav className="desktop-nav">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            className={`nav-btn ${tab === entry.id ? "active" : ""}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>
      <main className="stage">
        {tab === "issues" && <Triage kind="issue" onToast={setToast} />}
        {tab === "pulls" && <Triage kind="pull" onToast={setToast} />}
        {tab === "activity" && <Activity />}
        {tab === "code" && <CodePanel onToast={setToast} />}
        {tab === "settings" && <Settings session={session} onChange={refreshSession} />}
      </main>
      <nav className="mobile-nav">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            className={`nav-btn ${tab === entry.id ? "active" : ""}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

function GithubGate() {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <strong>Aevum</strong>
          <span>Async delivery control plane</span>
        </div>
        <h1>Triage work. Dispatch Cursor. Keep moving.</h1>
        <p>
          Sign in with GitHub, connect a Cursor API key, then swipe through issues and pull requests. Credentials stay in
          signed HttpOnly cookies. The browser never keeps the Cursor key.
        </p>
        <a className="btn" href="/api/github/oauth/start">
          Sign in with GitHub
        </a>
      </div>
    </div>
  );
}

function CursorGate({ github, onConnected }: { github: GithubProfile; onConnected: () => Promise<void> }) {
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Connect Cursor</h1>
        <p>
          Signed in as <strong>{github.login}</strong>. Paste a user or service-account API key from the Cursor dashboard.
          Aevum validates it against the Cloud Agents API and stores it server-side.
        </p>
        <label>
          Cursor API key
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="key_..."
          />
        </label>
        {error ? <div className="error">{error}</div> : null}
        <button
          className="btn"
          disabled={busy || !apiKey.trim()}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api.connectCursor(apiKey.trim());
              await onConnected();
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : "Could not connect Cursor.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Checking key…" : "Connect Cursor"}
        </button>
      </div>
    </div>
  );
}

function Triage({ kind, onToast }: { kind: "issue" | "pull"; onToast: (value: string) => void }) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [mention, setMention] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await api.inbox(kind);
      setItems(payload.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Inbox failed.");
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = items[0];
  const upcoming = items[1];

  const dropCurrent = () => setItems((list) => list.slice(1));

  const run = async (work: () => Promise<unknown>, ok: string) => {
    if (!current || busy) return;
    setBusy(true);
    try {
      await work();
      dropCurrent();
      setCommentOpen(false);
      setComment("");
      onToast(ok);
    } catch (caught) {
      onToast(caught instanceof Error ? caught.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  const onSwipe = (direction: "left" | "right" | "down") => {
    if (!current) return;
    if (direction === "down") {
      void run(() => api.skip(current), `Skipped #${current.number}`);
      return;
    }
    if (direction === "left") {
      void run(() => api.close(current), `Closed #${current.number}`);
      return;
    }
    if (kind === "issue") {
      void run(() => api.implement(current), `Cursor is implementing #${current.number}`);
      return;
    }
    void run(() => api.merge(current), `Merge requested for #${current.number}`);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!current || commentOpen || busy) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.key === "ArrowRight" || event.key === "l") onSwipe("right");
      if (event.key === "ArrowLeft" || event.key === "h") onSwipe("left");
      if (event.key === "ArrowDown" || event.key === "s") onSwipe("down");
      if (event.key === "a") void run(() => api.assess(current), `Assess started for #${current.number}`);
      if (event.key === "r" && kind === "pull") {
        void run(() => api.review(current), `Review started for #${current.number}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (loading) return <div className="notice">Loading {kind === "pull" ? "pull requests" : "issues"}…</div>;
  if (error) return <div className="notice error">{error}</div>;
  if (!current) {
    return <div className="panel empty">Queue is clear for this GitHub scope.</div>;
  }

  return (
    <section className="triage">
      <div className="kicker">
        <span>
          {kind === "pull" ? "Pull requests" : "Issues"} · {items.length} remaining
        </span>
        <span>Right {kind === "pull" ? "merges" : "implements"} · left closes · down skips</span>
      </div>
      <div className="stack">
        {upcoming ? <WorkCard item={upcoming} variant="next" /> : null}
        <Swipeable onSwipe={onSwipe} disabled={busy}>
          <WorkCard item={current} />
        </Swipeable>
      </div>
      <div className="actions">
        <button className="btn danger" disabled={busy} onClick={() => onSwipe("left")}>
          Close
        </button>
        <button className="btn ghost" disabled={busy} onClick={() => onSwipe("down")}>
          Skip
        </button>
        <button
          className="btn secondary"
          disabled={busy}
          onClick={() => run(() => api.assess(current), `Assess started for #${current.number}`)}
        >
          Assess
        </button>
        {kind === "pull" ? (
          <button
            className="btn secondary"
            disabled={busy}
            onClick={() => run(() => api.review(current), `Review started for #${current.number}`)}
          >
            Review
          </button>
        ) : null}
        <button className="btn good" disabled={busy} onClick={() => onSwipe("right")}>
          {kind === "pull" ? "Merge" : "Implement"}
        </button>
        <button className="btn secondary" disabled={busy} onClick={() => setCommentOpen((open) => !open)}>
          Comment
        </button>
      </div>
      {commentOpen ? (
        <div className="panel form-grid">
          <label>
            Leave a comment
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={mention} onChange={(event) => setMention(event.target.checked)} />
            Also tag @cursor
          </label>
          <button
            className="btn"
            disabled={busy || !comment.trim()}
            onClick={() => run(() => api.comment(current, comment.trim(), mention), `Commented on #${current.number}`)}
          >
            Post comment
          </button>
        </div>
      ) : null}
    </section>
  );
}

function WorkCard({ item, variant }: { item: InboxItem; variant?: "next" }) {
  return (
    <article className={`card work-card ${variant === "next" ? "next" : ""}`}>
      <div className="kicker">
        <span>
          {item.repository} #{item.number}
        </span>
        <span>{item.author}</span>
      </div>
      <h2>{item.title}</h2>
      <div className="body-preview">{item.body?.trim() || "No description."}</div>
      <div className="labels">
        {item.kind === "pull" ? <span className="pill">{item.mergeableState || "pull request"}</span> : null}
        {item.draft ? <span className="pill">draft</span> : null}
        {typeof item.additions === "number" ? (
          <span className="pill">
            +{item.additions} / -{item.deletions ?? 0} · {item.changedFiles ?? 0} files
          </span>
        ) : null}
        {item.labels.slice(0, 4).map((label) => (
          <span key={label.name} className="pill" style={{ borderColor: `#${label.color}` }}>
            {label.name}
          </span>
        ))}
      </div>
    </article>
  );
}

function Swipeable({
  children,
  onSwipe,
  disabled,
}: {
  children: ReactNode;
  onSwipe: (direction: "left" | "right" | "down") => void;
  disabled?: boolean;
}) {
  const origin = useRef<{ x: number; y: number } | null>(null);
  const [delta, setDelta] = useState({ x: 0, y: 0 });

  const reset = () => {
    origin.current = null;
    setDelta({ x: 0, y: 0 });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    origin.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!origin.current) return;
    setDelta({ x: event.clientX - origin.current.x, y: event.clientY - origin.current.y });
  };

  const onPointerUp = () => {
    if (!origin.current) return;
    const absX = Math.abs(delta.x);
    const absY = Math.abs(delta.y);
    if (absY > 90 && delta.y > 0 && absY > absX) onSwipe("down");
    else if (absX > 90 && absX > absY) onSwipe(delta.x > 0 ? "right" : "left");
    reset();
  };

  const hint =
    Math.abs(delta.x) > 48 && Math.abs(delta.x) > Math.abs(delta.y)
      ? delta.x > 0
        ? "right"
        : "left"
      : delta.y > 56
        ? "down"
        : null;

  return (
    <div
      className="work-card-wrap"
      style={{
        transform: `translate(${delta.x}px, ${delta.y}px) rotate(${delta.x / 28}deg)`,
        opacity: hint ? 0.92 : 1,
        transition: origin.current ? "none" : "transform 160ms ease, opacity 160ms ease",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={reset}
    >
      {hint === "right" ? <div className="hint right">Do</div> : null}
      {hint === "left" ? <div className="hint left">Close</div> : null}
      {hint === "down" ? <div className="hint down">Skip</div> : null}
      {children}
    </div>
  );
}

function Activity() {
  const [actions, setActions] = useState<ActivityAction[]>([]);
  const [sessions, setSessions] = useState<CursorAgent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pane, setPane] = useState<"sessions" | "actions">("sessions");

  useEffect(() => {
    api
      .activity()
      .then((payload) => {
        setActions(payload.actions);
        setSessions(payload.sessions);
        setError(payload.sessionsError ?? null);
      })
      .catch((caught: Error) => setError(caught.message));
  }, []);

  return (
    <section className="panel form-grid">
      <div className="row">
        <button className={`btn ${pane === "sessions" ? "" : "secondary"}`} onClick={() => setPane("sessions")}>
          Sessions
        </button>
        <button className={`btn ${pane === "actions" ? "" : "secondary"}`} onClick={() => setPane("actions")}>
          Actions
        </button>
      </div>
      {error ? <div className="error">{error}</div> : null}
      {pane === "sessions" ? (
        <div className="list">
          {sessions.length === 0 ? <div className="muted">No Cursor sessions visible for this key yet.</div> : null}
          {sessions.map((session) => (
            <a
              key={session.id}
              className="list-item"
              href={session.url || `https://cursor.com/agents/${session.id}`}
              target="_blank"
              rel="noreferrer"
            >
              <strong>{session.name}</strong>
              <span className="status">{session.status}</span>
              <span className="muted">{session.id}</span>
            </a>
          ))}
        </div>
      ) : (
        <div className="list">
          {actions.length === 0 ? <div className="muted">No Aevum actions recorded yet this session.</div> : null}
          {actions.map((action) => (
            <div key={action.id} className="list-item">
              <strong>{action.title}</strong>
              <span className="muted">{action.detail}</span>
              <span className="status">{action.kind}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CodePanel({ onToast }: { onToast: (value: string) => void }) {
  const [repos, setRepos] = useState<string[]>([]);
  const [repository, setRepository] = useState("");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"agent" | "plan">("agent");
  const [autoCreatePR, setAutoCreatePR] = useState(true);
  const [machine, setMachine] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .repos()
      .then((payload) => {
        setRepos(payload.repositories);
        setRepository((current) => current || payload.repositories[0] || "");
      })
      .catch((caught: Error) => onToast(caught.message));
  }, [onToast]);

  return (
    <section className="panel form-grid">
      <h2>Dispatch Cursor</h2>
      <p className="muted">
        Start an implementation run against a repository in the current GitHub scope. Machine mode is only useful if this
        API key can reach a named Cursor machine.
      </p>
      <label>
        Repository
        <select value={repository} onChange={(event) => setRepository(event.target.value)}>
          {repos.map((repo) => (
            <option key={repo} value={repo}>
              {repo}
            </option>
          ))}
        </select>
      </label>
      <label>
        Prompt
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="What should Cursor do?" />
      </label>
      <div className="row">
        <label>
          Mode
          <select value={mode} onChange={(event) => setMode(event.target.value as "agent" | "plan")}>
            <option value="agent">Agent</option>
            <option value="plan">Plan</option>
          </select>
        </label>
        <label>
          Cursor machine name
          <input value={machine} onChange={(event) => setMachine(event.target.value)} placeholder="optional" />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={autoCreatePR} onChange={(event) => setAutoCreatePR(event.target.checked)} />
        Open a pull request when the run finishes
      </label>
      <button
        className="btn"
        disabled={busy || !repository || !prompt.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            await api.code({
              repository,
              prompt: prompt.trim(),
              mode,
              autoCreatePR,
              machine: machine.trim() || undefined,
            });
            setPrompt("");
            onToast("Cursor run started.");
          } catch (caught) {
            onToast(caught instanceof Error ? caught.message : "Could not start Cursor.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Starting…" : "Start Cursor"}
      </button>
    </section>
  );
}

function Settings({ session, onChange }: { session: Session; onChange: () => Promise<unknown> }) {
  const [scope, setScope] = useState(session.github?.scope ?? "");
  const [busy, setBusy] = useState(false);

  return (
    <section className="panel form-grid">
      <h2>Settings</h2>
      <p className="muted">
        Use `user:&lt;login&gt;`, `org:&lt;org&gt;`, or `repo:&lt;owner/repo&gt;`. A bare name is treated as an
        organisation.
      </p>
      <label>
        GitHub scope
        <input value={scope} onChange={(event) => setScope(event.target.value)} />
      </label>
      <div className="row">
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.setScope(scope);
              await onChange();
            } finally {
              setBusy(false);
            }
          }}
        >
          Save scope
        </button>
        <button
          className="btn secondary"
          onClick={async () => {
            await api.disconnectCursor();
            await onChange();
          }}
        >
          Disconnect Cursor
        </button>
        <button
          className="btn danger"
          onClick={async () => {
            await api.logout();
            await onChange();
          }}
        >
          Sign out of GitHub
        </button>
      </div>
    </section>
  );
}
