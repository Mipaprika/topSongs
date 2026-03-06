import { describe, expect, it } from "vitest";

import { NeteaseApiClient } from "../src/providers/netease/api-client";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json"
    },
    ...init
  });
}

describe("NeteaseApiClient", () => {
  it("creates qr login payload from key + create endpoints", async () => {
    const calls: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);

      if (url.includes("/login/qr/key")) {
        return jsonResponse({
          code: 200,
          data: { unikey: "k123" }
        });
      }

      if (url.includes("/login/qr/create")) {
        return jsonResponse({
          code: 200,
          data: {
            qrurl: "https://music.163.com/login?codekey=k123",
            qrimg: "data:image/png;base64,abc"
          }
        });
      }

      throw new Error(`unexpected url: ${url}`);
    };

    const client = new NeteaseApiClient({
      baseUrl: "https://ncm.example.com",
      fetchFn
    });

    const result = await client.createQrLogin();

    expect(result).toEqual({
      unikey: "k123",
      qrurl: "https://music.163.com/login?codekey=k123",
      qrimg: "data:image/png;base64,abc"
    });
    expect(calls[0]).toContain("/login/qr/key");
    expect(calls[1]).toContain("/login/qr/create");
  });

  it("normalizes authorized qr cookie into request header format", async () => {
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      expect(url).toContain("/login/qr/check");

      return jsonResponse({
        code: 803,
        cookie:
          "MUSIC_U=next-cookie; Max-Age=15552000; Expires=Tue, 01 Sep 2026 14:48:05 GMT; Path=/;; __csrf=csrf-token; Path=/; HttpOnly"
      });
    };

    const client = new NeteaseApiClient({
      baseUrl: "https://ncm.example.com",
      fetchFn
    });

    const result = await client.checkQrLogin("u1");
    expect(result).toEqual({
      status: "AUTHORIZED",
      cookie: "MUSIC_U=next-cookie; __csrf=csrf-token"
    });
  });

  it("refreshes cookie and reads set-cookie header", async () => {
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      expect(url).toContain("/login/refresh");

      return jsonResponse(
        { code: 200 },
        {
          headers: {
            "content-type": "application/json",
            "set-cookie": "MUSIC_U=next-cookie; Path=/; HttpOnly"
          }
        }
      );
    };

    const client = new NeteaseApiClient({
      baseUrl: "https://ncm.example.com",
      fetchFn
    });

    const cookie = await client.refreshCookie("MUSIC_U=old-cookie");
    expect(cookie).toBe("MUSIC_U=next-cookie");
  });

  it("reads login profile and liked song ids", async () => {
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);

      if (url.includes("/login/status")) {
        return jsonResponse({
          code: 200,
          data: {
            profile: {
              userId: 42
            }
          }
        });
      }

      if (url.includes("/likelist")) {
        return jsonResponse({
          code: 200,
          ids: [11, "12"]
        });
      }

      throw new Error(`unexpected url: ${url}`);
    };

    const client = new NeteaseApiClient({
      baseUrl: "https://ncm.example.com",
      fetchFn
    });

    await expect(client.getLoginProfile("MUSIC_U=live")).resolves.toEqual({ userId: "42" });
    await expect(client.getLikedSongIds("42", "MUSIC_U=live")).resolves.toEqual(["11", "12"]);
  });

  it("reads song detail into work-level metadata", async () => {
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      expect(url).toContain("/song/detail");

      return jsonResponse({
        code: 200,
        songs: [
          {
            id: 11,
            name: "Yellow",
            ar: [{ name: "Coldplay" }]
          },
          {
            id: 12,
            name: "Fix You",
            artists: [{ name: "Coldplay" }]
          }
        ]
      });
    };

    const client = new NeteaseApiClient({
      baseUrl: "https://ncm.example.com",
      fetchFn
    });

    await expect(client.getSongsDetail(["11", "12"])).resolves.toEqual([
      { songId: "11", title: "Yellow", artist: "Coldplay" },
      { songId: "12", title: "Fix You", artist: "Coldplay" }
    ]);
  });
});
