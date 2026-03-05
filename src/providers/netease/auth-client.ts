import { HttpError, type RefreshCookieResponse, type RefreshResult } from "./types";

export type RefreshCookieFn = (cookie: string) => Promise<RefreshCookieResponse>;

export class NeteaseAuthClient {
  constructor(private readonly refreshCookieFn: RefreshCookieFn) {}

  async refresh(cookie: string): Promise<RefreshResult> {
    try {
      const response = await this.refreshCookieFn(cookie);
      return {
        ok: true,
        cookie: response.cookie
      };
    } catch (error) {
      if (isHttpError(error) && (error.status === 401 || error.status === 403)) {
        return {
          ok: false,
          reason: "RELOGIN_REQUIRED"
        };
      }

      return {
        ok: false,
        reason: "UNKNOWN_ERROR"
      };
    }
  }
}

function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
