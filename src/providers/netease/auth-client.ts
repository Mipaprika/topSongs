import { HttpError, type QrCheckResult, type QrLoginPayload, type RefreshCookieResponse, type RefreshResult } from "./types";

export type RefreshCookieFn = (cookie: string) => Promise<RefreshCookieResponse>;
export interface NeteaseAuthAdapter {
  refreshCookie(cookie: string): Promise<string>;
  createQrLogin?(): Promise<QrLoginPayload>;
  checkQrLogin?(unikey: string): Promise<QrCheckResult>;
}

export class NeteaseAuthClient {
  constructor(private readonly adapter: RefreshCookieFn | NeteaseAuthAdapter) {}

  async refresh(cookie: string): Promise<RefreshResult> {
    try {
      const response = await this.refreshCookie(cookie);
      return {
        ok: true,
        cookie: response
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

  async createQrLogin(): Promise<QrLoginPayload> {
    if (!isNeteaseAuthAdapter(this.adapter) || !this.adapter.createQrLogin) {
      throw new Error("qr login adapter is not configured");
    }
    return this.adapter.createQrLogin();
  }

  async checkQrLogin(unikey: string): Promise<QrCheckResult> {
    if (!isNeteaseAuthAdapter(this.adapter) || !this.adapter.checkQrLogin) {
      throw new Error("qr login adapter is not configured");
    }
    return this.adapter.checkQrLogin(unikey);
  }

  private async refreshCookie(cookie: string): Promise<string> {
    if (isNeteaseAuthAdapter(this.adapter)) {
      return this.adapter.refreshCookie(cookie);
    }

    const response = await this.adapter(cookie);
    return response.cookie;
  }
}

function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}

function isNeteaseAuthAdapter(adapter: RefreshCookieFn | NeteaseAuthAdapter): adapter is NeteaseAuthAdapter {
  return typeof adapter === "object" && adapter !== null && "refreshCookie" in adapter;
}
