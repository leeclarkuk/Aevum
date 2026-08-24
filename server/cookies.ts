import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_COOKIE_BYTES = 3500;

export function signPayload(payload: unknown, secret: string): string {
  const json = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(json).digest("base64url");
  return `${json}.${signature}`;
}

export function verifyPayload<T>(token: string | undefined, secret: string): T | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const json = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(json).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    return JSON.parse(Buffer.from(json, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "Lax" as const,
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

export function fitsInCookie(token: string): boolean {
  return Buffer.byteLength(token, "utf8") <= MAX_COOKIE_BYTES;
}
