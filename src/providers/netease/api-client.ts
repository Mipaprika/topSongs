import {
  HttpError,
  type FetchEventsResult,
  type NeteaseApiClientOptions,
  type NeteaseRawEvent,
  type QrCheckResult,
  type QrLoginPayload
} from "./types";

interface RequestOptions {
  method?: "GET" | "POST";
  query?: Record<string, string | number | boolean | undefined>;
  cookie?: string;
}

interface NeteaseResponseEnvelope<T> {
  code: number;
  data?: T;
  cookie?: string;
  [key: string]: unknown;
}

export class NeteaseApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: NeteaseApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async createQrLogin(): Promise<QrLoginPayload> {
    const keyRes = await this.requestJson<NeteaseResponseEnvelope<{ unikey: string }>>("/login/qr/key", {
      query: { timestamp: Date.now() }
    });
    const unikey = keyRes.data?.unikey;
    if (!unikey) {
      throw new HttpError(500, "missing unikey from qr key endpoint");
    }

    const qrRes = await this.requestJson<NeteaseResponseEnvelope<{ qrurl: string; qrimg?: string }>>(
      "/login/qr/create",
      {
        query: {
          key: unikey,
          qrimg: true,
          timestamp: Date.now()
        }
      }
    );

    const qrurl = qrRes.data?.qrurl;
    if (!qrurl) {
      throw new HttpError(500, "missing qrurl from qr create endpoint");
    }

    return {
      unikey,
      qrurl,
      qrimg: qrRes.data?.qrimg
    };
  }

  async checkQrLogin(unikey: string): Promise<QrCheckResult> {
    const body = await this.requestJson<NeteaseResponseEnvelope<unknown>>("/login/qr/check", {
      query: {
        key: unikey,
        timestamp: Date.now()
      }
    });

    if (body.code === 801) {
      return { status: "WAITING_SCAN" };
    }
    if (body.code === 802) {
      return { status: "WAITING_CONFIRM" };
    }
    if (body.code === 800) {
      return { status: "EXPIRED" };
    }
    if (body.code === 803) {
      const cookie = this.extractCookie(body, undefined);
      if (!cookie) {
        throw new HttpError(500, "authorized qr response missing cookie");
      }
      return {
        status: "AUTHORIZED",
        cookie
      };
    }

    throw new HttpError(500, `unexpected qr check code: ${body.code}`);
  }

  async refreshCookie(cookie: string): Promise<string> {
    const response = await this.requestRaw("/login/refresh", {
      query: { timestamp: Date.now() },
      cookie
    });

    const body = (await response.json()) as NeteaseResponseEnvelope<unknown>;
    const refreshedCookie = this.extractCookie(body, response);
    if (!refreshedCookie) {
      throw new HttpError(500, "refresh succeeded but cookie not found");
    }
    return refreshedCookie;
  }

  async fetchEvents(cursor: string, cookie: string): Promise<FetchEventsResult> {
    const body = await this.requestJson<NeteaseResponseEnvelope<{ lasttime?: number; event?: unknown[] }>>("/event", {
      query: {
        pagesize: 100,
        lasttime: cursor
      },
      cookie
    });

    const rawEvents = (body.event ?? body.data?.event ?? []) as unknown[];
    const nextCursor = String((body.lasttime as number | undefined) ?? body.data?.lasttime ?? cursor);

    return {
      nextCursor,
      rawEvents: rawEvents
        .map(toRawEvent)
        .filter((event): event is NeteaseRawEvent => event !== null)
    };
  }

  async getPlaylistTrackIds(playlistId: string, cookie: string): Promise<string[]> {
    const body = await this.requestJson<NeteaseResponseEnvelope<{ songs?: unknown[]; playlist?: { trackIds?: unknown[] } }>>(
      "/playlist/track/all",
      {
        query: {
          id: playlistId,
          limit: 1000,
          offset: 0,
          timestamp: Date.now()
        },
        cookie
      }
    );

    const songs = body.songs ?? body.data?.songs;
    if (Array.isArray(songs)) {
      return songs
        .map(extractSongId)
        .filter((songId): songId is string => songId !== null);
    }

    const bodyWithPlaylist = body as {
      playlist?: { trackIds?: unknown[] };
      data?: { playlist?: { trackIds?: unknown[] } };
    };
    const trackIds = bodyWithPlaylist.playlist?.trackIds ?? bodyWithPlaylist.data?.playlist?.trackIds ?? [];
    if (Array.isArray(trackIds)) {
      return trackIds
        .map((track) => {
          if (typeof track === "object" && track !== null && "id" in track) {
            const id = (track as { id: string | number }).id;
            return String(id);
          }
          return null;
        })
        .filter((songId): songId is string => songId !== null);
    }

    return [];
  }

  async updatePlaylistTracks(
    playlistId: string,
    op: "add" | "del",
    tracks: string[],
    cookie: string
  ): Promise<void> {
    if (tracks.length === 0) {
      return;
    }

    await this.requestJson<NeteaseResponseEnvelope<unknown>>("/playlist/tracks", {
      method: "POST",
      query: {
        op,
        pid: playlistId,
        tracks: JSON.stringify(tracks),
        timestamp: Date.now()
      },
      cookie
    });
  }

  private async requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.requestRaw(path, options);
    return (await response.json()) as T;
  }

  private async requestRaw(path: string, options: RequestOptions = {}): Promise<Response> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value === undefined) continue;
        url.searchParams.set(key, String(value));
      }
    }

    const response = await this.fetchFn(url.toString(), {
      method: options.method ?? "GET",
      headers: options.cookie
        ? {
            cookie: options.cookie
          }
        : undefined
    });

    if (!response.ok) {
      throw new HttpError(response.status, `${response.status} ${response.statusText}`);
    }

    return response;
  }

  private extractCookie(body: NeteaseResponseEnvelope<unknown>, response: Response | undefined): string | null {
    const candidate = body.cookie ?? (body.data as { cookie?: string } | undefined)?.cookie;
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return normalizeCookieHeader(candidate);
    }

    if (!response) {
      return null;
    }

    const setCookie = response.headers.get("set-cookie");
    if (!setCookie || setCookie.trim().length === 0) {
      return null;
    }
    return normalizeCookieHeader(setCookie);
  }
}

function toRawEvent(event: unknown): NeteaseRawEvent | null {
  if (typeof event !== "object" || event === null) {
    return null;
  }

  const raw = event as {
    id?: string | number;
    eventTime?: number;
    showTime?: number;
    json?: string;
  };
  if (raw.id === undefined || raw.json === undefined) {
    return null;
  }

  const eventTime = raw.eventTime ?? raw.showTime;
  if (typeof eventTime !== "number") {
    return null;
  }

  return {
    id: String(raw.id),
    eventTime,
    json: raw.json
  };
}

function extractSongId(song: unknown): string | null {
  if (typeof song === "object" && song !== null && "id" in song) {
    const id = (song as { id: string | number }).id;
    return String(id);
  }
  return null;
}

function normalizeCookieHeader(rawCookie: string): string {
  const reservedAttributes = new Set([
    "path",
    "expires",
    "max-age",
    "domain",
    "httponly",
    "secure",
    "samesite",
    "priority",
    "partitioned"
  ]);

  const parts = rawCookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const pairs: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const equalIndex = part.indexOf("=");
    if (equalIndex === -1) {
      continue;
    }

    const key = part.slice(0, equalIndex).trim();
    const value = part.slice(equalIndex + 1).trim();
    if (!key || !value) {
      continue;
    }

    if (reservedAttributes.has(key.toLowerCase())) {
      continue;
    }

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    pairs.push(`${key}=${value}`);
  }

  return pairs.join("; ");
}
