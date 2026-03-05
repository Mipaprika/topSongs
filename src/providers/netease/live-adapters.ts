import { NeteaseAuthClient } from "./auth-client";
import { NeteaseApiClient } from "./api-client";
import { NeteaseIncrementalProvider } from "./incremental-provider";
import { NeteasePlaylistProvider } from "./playlist-provider";
import type { FetchEventsResult, NeteaseApiClientOptions, QrCheckResult, QrLoginPayload } from "./types";

export interface NeteaseSession {
  getCookie(): string;
  setCookie?(cookie: string): void;
}

export interface NeteaseApiLike {
  createQrLogin(): Promise<QrLoginPayload>;
  checkQrLogin(unikey: string): Promise<QrCheckResult>;
  refreshCookie(cookie: string): Promise<string>;
  fetchEvents(cursor: string, cookie: string): Promise<FetchEventsResult>;
  getPlaylistTrackIds(playlistId: string, cookie: string): Promise<string[]>;
  updatePlaylistTracks(
    playlistId: string,
    op: "add" | "del",
    tracks: string[],
    cookie: string
  ): Promise<void>;
}

export interface CreateNeteaseLiveAdaptersInput {
  session: NeteaseSession;
  api?: NeteaseApiLike;
  apiClientOptions?: NeteaseApiClientOptions;
}

export function createNeteaseLiveAdapters(input: CreateNeteaseLiveAdaptersInput) {
  const api = input.api ?? new NeteaseApiClient(assertApiOptions(input.apiClientOptions));

  const authClient = new NeteaseAuthClient({
    createQrLogin: () => api.createQrLogin(),
    checkQrLogin: async (unikey: string) => {
      const result = await api.checkQrLogin(unikey);
      if (result.status === "AUTHORIZED") {
        input.session.setCookie?.(result.cookie);
      }
      return result;
    },
    refreshCookie: async (cookie: string) => {
      const nextCookie = await api.refreshCookie(cookie);
      input.session.setCookie?.(nextCookie);
      return nextCookie;
    }
  });

  const incrementalProvider = new NeteaseIncrementalProvider({
    fetchEvents: async (cursor: string) => api.fetchEvents(cursor, input.session.getCookie())
  });

  const playlistProvider = new NeteasePlaylistProvider({
    getPlaylistTrackIds: (playlistId: string) => api.getPlaylistTrackIds(playlistId, input.session.getCookie()),
    updatePlaylistTracks: (playlistId: string, op: "add" | "del", tracks: string[]) =>
      api.updatePlaylistTracks(playlistId, op, tracks, input.session.getCookie())
  });

  return {
    authClient,
    incrementalProvider,
    playlistProvider
  };
}

function assertApiOptions(options: NeteaseApiClientOptions | undefined): NeteaseApiClientOptions {
  if (!options) {
    throw new Error("apiClientOptions is required when api is not provided");
  }
  return options;
}
