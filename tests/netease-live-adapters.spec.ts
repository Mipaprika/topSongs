import { describe, expect, it } from "vitest";

import { createNeteaseLiveAdapters } from "../src/providers/netease/live-adapters";

describe("createNeteaseLiveAdapters", () => {
  it("updates session cookie after refresh and qr authorization", async () => {
    let cookie = "MUSIC_U=old";

    const adapters = createNeteaseLiveAdapters({
      session: {
        getCookie: () => cookie,
        setCookie: (next) => {
          cookie = next;
        }
      },
      api: {
        async createQrLogin() {
          return {
            unikey: "u1",
            qrurl: "https://music.163.com/login?codekey=u1"
          };
        },
        async checkQrLogin() {
          return {
            status: "AUTHORIZED" as const,
            cookie: "MUSIC_U=qr-ok"
          };
        },
        async refreshCookie(inputCookie: string) {
          expect(inputCookie).toBe("MUSIC_U=qr-ok");
          return "MUSIC_U=refreshed";
        },
        async fetchEvents() {
          return {
            nextCursor: "1200",
            rawEvents: [
              {
                id: "e1",
                eventTime: 1100,
                json: JSON.stringify({
                  song: { id: "s1" },
                  msg: "赞了歌曲"
                })
              }
            ]
          };
        },
        async getPlaylistTrackIds() {
          return ["s-old"];
        },
        async updatePlaylistTracks() {
          return;
        }
      }
    });

    await adapters.authClient.createQrLogin();
    await adapters.authClient.checkQrLogin("u1");
    const refreshResult = await adapters.authClient.refresh(cookie);

    expect(refreshResult).toEqual({
      ok: true,
      cookie: "MUSIC_U=refreshed"
    });
    expect(cookie).toBe("MUSIC_U=refreshed");

    const incremental = await adapters.incrementalProvider.fetchSince("1000");
    expect(incremental.events[0].songId).toBe("s1");
  });
});
