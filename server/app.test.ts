import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "./app.js";
import type { AppEnv } from "./env.js";

const env: AppEnv = {
  githubClientId: "id",
  githubClientSecret: "secret",
  githubRedirectUri: "http://localhost:8787/api/github/oauth/callback",
  successRedirectUrl: "http://localhost:5173/",
  allowedOrigin: "http://localhost:5173",
  cookieSecret: "unit-test-cookie-secret-unit-test",
  cookieSecure: false,
  port: 8787,
};

test("health endpoint does not require cookies", async () => {
  const app = createApp(() => env);
  const response = await app.request("http://localhost/api/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, name: "aevum" });
});

test("session is empty before sign-in", async () => {
  const app = createApp(() => env);
  const response = await app.request("http://localhost/api/session");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { github: null, cursor: null });
});

test("inbox requires GitHub", async () => {
  const app = createApp(() => env);
  const response = await app.request("http://localhost/api/inbox");
  assert.equal(response.status, 401);
});
