import { existsSync } from "node:fs";

export interface AppConfig {
  masterKey: string;
  neteaseApiBaseUrl: string;
  neteasePlaylistId: string | null;
  neteaseCookie: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  if (!env.MASTER_KEY || env.MASTER_KEY.trim() === "") {
    throw new Error("MASTER_KEY is required");
  }

  return {
    masterKey: env.MASTER_KEY,
    neteaseApiBaseUrl: resolveNeteaseApiBaseUrl(env),
    neteasePlaylistId: env.NETEASE_PLAYLIST_ID ?? null,
    neteaseCookie: env.NETEASE_COOKIE ?? null
  };
}

export function resolveNeteaseApiBaseUrl(env: NodeJS.ProcessEnv): string {
  const fallback = existsSync("/.dockerenv") ? "http://netease-api:3000" : "http://127.0.0.1:3000";
  const raw = (env.NETEASE_API_BASE_URL ?? fallback).trim();
  return validateNeteaseApiBaseUrl(raw);
}

export function validateNeteaseApiBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("NETEASE_API_BASE_URL is not a valid URL");
  }

  if (url.username || url.password) {
    throw new Error("NETEASE_API_BASE_URL must not include username/password");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("NETEASE_API_BASE_URL must not include path/query/hash");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("NETEASE_API_BASE_URL must use http or https");
  }

  const host = url.hostname.toLowerCase();
  const allowlist = new Set(["netease-api", "127.0.0.1", "localhost"]);
  if (!allowlist.has(host)) {
    throw new Error(`NETEASE_API_BASE_URL host is not allowed: ${host}`);
  }
  return `${url.origin}`;
}
