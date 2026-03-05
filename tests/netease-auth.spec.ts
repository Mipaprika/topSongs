import { describe, expect, it } from "vitest";

import { NeteaseAuthClient } from "../src/providers/netease/auth-client";
import { HttpError } from "../src/providers/netease/types";

describe("NeteaseAuthClient", () => {
  it("returns relogin status when refresh endpoint rejects cookie", async () => {
    const client = new NeteaseAuthClient(async () => {
      throw new HttpError(401, "invalid cookie");
    });

    await expect(client.refresh("bad-cookie")).resolves.toEqual({
      ok: false,
      reason: "RELOGIN_REQUIRED"
    });
  });

  it("returns new cookie on success", async () => {
    const client = new NeteaseAuthClient(async () => {
      return { cookie: "MUSIC_U=next" };
    });

    await expect(client.refresh("old-cookie")).resolves.toEqual({
      ok: true,
      cookie: "MUSIC_U=next"
    });
  });

  it("delegates qr login creation and check", async () => {
    const client = new NeteaseAuthClient({
      async createQrLogin() {
        return {
          unikey: "u1",
          qrurl: "https://music.163.com/login?codekey=u1",
          qrimg: "data:image/png;base64,qr"
        };
      },
      async checkQrLogin(unikey: string) {
        expect(unikey).toBe("u1");
        return {
          status: "AUTHORIZED" as const,
          cookie: "MUSIC_U=ok"
        };
      },
      async refreshCookie() {
        return "MUSIC_U=next";
      }
    });

    const qr = await client.createQrLogin();
    const check = await client.checkQrLogin("u1");

    expect(qr.unikey).toBe("u1");
    expect(check).toEqual({
      status: "AUTHORIZED",
      cookie: "MUSIC_U=ok"
    });
  });
});
