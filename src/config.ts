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
    neteaseApiBaseUrl: env.NETEASE_API_BASE_URL ?? "http://127.0.0.1:3000",
    neteasePlaylistId: env.NETEASE_PLAYLIST_ID ?? null,
    neteaseCookie: env.NETEASE_COOKIE ?? null
  };
}
