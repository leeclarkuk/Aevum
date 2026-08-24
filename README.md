# Aevum

Aevum is a control plane for async, Cursor-driven software delivery. Sign in with GitHub, connect a Cursor API key, then triage issues and pull requests from a phone or a desktop. Swipe to close, merge, skip, or hand work to a Cursor Cloud Agent.

Credentials stay on the server in signed HttpOnly cookies. The browser never keeps the Cursor key.

## What it does

- Run multiple Cursor Cloud Agent sessions across repositories
- Launch implementation, assessment, and review from existing issues and PRs
- Mobile and desktop triage views for fast issue and PR decisions
- Swipe right to implement an issue or merge a PR
- Swipe left to close
- Swipe down to skip and send the item to the tail
- Assess whether an issue is worth doing, or whether a PR should merge
- Automated PR review through Cursor
- Activity panel for agent sessions and local actions
- GitHub OAuth with scope controls: `user:`, `org:`, `repo:`

## How credentials work

Aevum does not store Cursor credentials in browser storage. You enter your Cursor API key in the app. The server validates it against the Cloud Agents API and stores it in a signed HttpOnly cookie. All Cursor calls are proxied through the API.

GitHub access uses OAuth. The access token is stored the same way.

## Requirements

- Node.js 18+
- A GitHub OAuth App
- A Cursor API key from [cursor.com/dashboard](https://cursor.com/dashboard)

## Running locally

1. Install dependencies

```bash
npm install
```

2. Create your env file

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Description |
| --- | --- |
| `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth App client secret |
| `GITHUB_OAUTH_REDIRECT_URI` | `http://localhost:8787/api/github/oauth/callback` |
| `GITHUB_OAUTH_SUCCESS_REDIRECT_URL` | `http://localhost:5173/` |
| `GITHUB_OAUTH_ALLOWED_ORIGIN` | `http://localhost:5173` |
| `GITHUB_OAUTH_COOKIE_SECRET` | Any random string (`openssl rand -hex 32`) |

3. Create a GitHub OAuth App

- GitHub Settings → Developer settings → OAuth Apps → New OAuth App
- Set the callback URL to `http://localhost:8787/api/github/oauth/callback`
- Copy the client ID and secret into `.env.local`

4. Start the app

```bash
npm run dev:all
```

This starts the API on port 8787 and Vite on port 5173. Open `http://localhost:5173`, sign in with GitHub, then connect Cursor from the startup panel or Settings.

## Temporary public link (Cloudflare)

To put the built frontend on a throwaway HTTPS URL:

```bash
npm run build
npm run preview
cloudflared tunnel --url http://127.0.0.1:5173
```

Keep the API running as well (`npm run start` or `npm run dev:api`). Vite proxies `/api` through the same host, so one tunnel covers the UI and the API.

The trycloudflare hostname changes every time. GitHub OAuth will only complete if you add that hostname as the OAuth callback (`https://<tunnel>/api/github/oauth/callback`) and set `GITHUB_OAUTH_REDIRECT_URI`, `GITHUB_OAUTH_SUCCESS_REDIRECT_URL`, `GITHUB_OAUTH_ALLOWED_ORIGIN`, and `GITHUB_OAUTH_COOKIE_SECURE=true` to match. For a UI look, the sign-in screen is enough.

## GitHub scope behaviour

On first GitHub OAuth sign-in, scope defaults to `user:<your-login>`.

You can set scope to `user:<username>`, `org:<org>`, or `repo:<owner/repo>`.

If you enter a value without a prefix, for example `acme`, Aevum treats it as `org:acme`.

OAuth is requested with `repo` scope, so private repositories in the selected scope can be included.

## Swipe and keyboard

| Action | Issues | Pull requests | Keyboard |
| --- | --- | --- | --- |
| Right | Start a Cursor implementation and ask it to open a PR | Merge, or enrol auto-merge if checks are pending | `l` or `→` |
| Left | Close on GitHub | Close without merging | `h` or `←` |
| Down | Skip to the tail | Skip to the tail | `s` or `↓` |
| Assess | Cursor judges whether the issue is worth doing | Cursor judges whether the PR should merge | `a` |
| Review | | Cursor reviews the PR | `r` |

The Code tab starts a free-form Cursor run against a repository in the current scope. Optional machine name routes the run to a named Cursor machine instead of a cloud VM.

## Deploying to Vercel

1. Push to GitHub and import the repo in Vercel.
2. Set the same environment variables, with HTTPS URLs:

| Variable | Value |
| --- | --- |
| `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth App client secret |
| `GITHUB_OAUTH_REDIRECT_URI` | `https://your-app.vercel.app/api/github/oauth/callback` |
| `GITHUB_OAUTH_SUCCESS_REDIRECT_URL` | `https://your-app.vercel.app/` |
| `GITHUB_OAUTH_ALLOWED_ORIGIN` | `https://your-app.vercel.app` |
| `GITHUB_OAUTH_COOKIE_SECURE` | `true` |
| `GITHUB_OAUTH_COOKIE_SECRET` | Random 32+ character string |

3. Update the GitHub OAuth App callback URL to `https://your-app.vercel.app/api/github/oauth/callback`.
4. Deploy. Users sign in with GitHub and enter a Cursor API key in the app after deploy.

## How it works

1. Connect GitHub via OAuth to sync open issues and pull requests from the configured scope.
2. Swipe right on an issue to have Cursor open a pull request.
3. Swipe left on an issue to close it on GitHub.
4. Swipe right on a pull request to merge it, or enrol auto-merge if checks are pending.
5. Swipe left on a pull request to close it without merging.
6. Swipe down to skip and move the item to the tail.
7. Use Assess to have Cursor evaluate issue necessity or PR merge decisions.
8. Use Review to open Cursor review sessions for PRs.
9. Use Code to start a Cursor implementation request, including named-machine mode.
10. Use Comment to post a manual GitHub comment, with an optional `@cursor` mention.
11. Track everything in Activity, split into Sessions and Actions.

Cursor Cloud Agents API calls use `https://api.cursor.com/v1`. Generate a key from the Cursor dashboard. Aevum never logs the key.
