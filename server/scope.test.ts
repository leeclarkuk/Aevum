import assert from "node:assert/strict";
import { test } from "node:test";
import { signPayload, verifyPayload } from "./cookies.js";
import { githubSearchQualifier, parseScope } from "./scope.js";

test("parseScope defaults to the signed-in user", () => {
  const scope = parseScope("", "leeclarkuk");
  assert.equal(scope.label, "user:leeclarkuk");
  assert.equal(githubSearchQualifier(scope), "user:leeclarkuk");
});

test("parseScope treats a bare name as an org", () => {
  const scope = parseScope("acme");
  assert.equal(scope.label, "org:acme");
  assert.equal(githubSearchQualifier(scope), "org:acme");
});

test("parseScope accepts prefixed values", () => {
  assert.equal(parseScope("user:octocat").label, "user:octocat");
  assert.equal(parseScope("org:tracsis").label, "org:tracsis");
  assert.equal(parseScope("repo:leeclarkuk/Aevum").label, "repo:leeclarkuk/Aevum");
  assert.equal(githubSearchQualifier(parseScope("repo:leeclarkuk/Aevum")), "repo:leeclarkuk/Aevum");
});

test("parseScope treats owner/name as a repo", () => {
  assert.equal(parseScope("leeclarkuk/Aevum").kind, "repo");
});

test("signed cookies round-trip and reject tampering", () => {
  const secret = "test-secret-value";
  const token = signPayload({ login: "lee" }, secret);
  assert.deepEqual(verifyPayload(token, secret), { login: "lee" });
  assert.equal(verifyPayload(token.slice(0, -2) + "ab", secret), null);
  assert.equal(verifyPayload(token, "other-secret"), null);
});
