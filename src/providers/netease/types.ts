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
