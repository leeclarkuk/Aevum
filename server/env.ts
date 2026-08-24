import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

export function loadDotenv() {
  for (const file of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (process.env[key]) continue;
      process.env[key] = stripQuotes(line.slice(eq + 1).trim());
    }
  }
}

export type AppEnv = {
  githubClientId: string;
  githubClientSecret: string;
  githubRedirectUri: string;
  successRedirectUrl: string;
  allowedOrigin: string;
  cookieSecret: string;
  cookieSecure: boolean;
  port: number;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export function loadEnv(): AppEnv {
  loadDotenv();
  const cookieSecure =
    (process.env.GITHUB_OAUTH_COOKIE_SECURE ?? "").toLowerCase() === "true" ||
    process.env.VERCEL === "1";

  return {
    githubClientId: required("GITHUB_OAUTH_CLIENT_ID"),
    githubClientSecret: required("GITHUB_OAUTH_CLIENT_SECRET"),
    githubRedirectUri: required("GITHUB_OAUTH_REDIRECT_URI"),
    successRedirectUrl: process.env.GITHUB_OAUTH_SUCCESS_REDIRECT_URL?.trim() || "http://localhost:5173/",
    allowedOrigin: process.env.GITHUB_OAUTH_ALLOWED_ORIGIN?.trim() || "http://localhost:5173",
    cookieSecret: required("GITHUB_OAUTH_COOKIE_SECRET"),
    cookieSecure,
    port: Number(process.env.PORT || 8787),
  };
}
