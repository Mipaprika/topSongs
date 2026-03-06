export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface RefreshCookieResponse {
  cookie: string;
}

export type RefreshResult =
  | { ok: true; cookie: string }
  | { ok: false; reason: "RELOGIN_REQUIRED" | "UNKNOWN_ERROR" };

export interface NeteaseApiClientOptions {
  baseUrl: string;
  fetchFn?: typeof fetch;
}

export interface QrLoginPayload {
  unikey: string;
  qrurl: string;
  qrimg?: string;
}

export type QrCheckResult =
  | { status: "WAITING_SCAN" }
  | { status: "WAITING_CONFIRM" }
  | { status: "EXPIRED" }
  | { status: "AUTHORIZED"; cookie: string };

export interface NeteaseRawEvent {
  id: string;
  eventTime: number;
  json: string;
}

export interface FetchEventsResult {
  nextCursor: string;
  rawEvents: NeteaseRawEvent[];
}

export interface NeteaseSongDetail {
  songId: string;
  title: string;
  artist: string;
}
