import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli";
import { DbClient } from "../src/db/client";
import type { FetchEventsResult, QrCheckResult } from "../src/providers/netease/types";
import { CredentialStore } from "../src/security/credential-store";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runCli", () => {
  it("supports commands: bootstrap-login, douban-sync, run-once", async () => {
    const out = await runCli(["--help"]);
    expect(out).toContain("bootstrap-login");
    expect(out).toContain("douban-sync");
    expect(out).toContain("netease-sync");
    expect(out).toContain("run-once");
  });

  it("prints selectedCount=20 for run-once --dry-run", async () => {
    const out = await runCli(["run-once", "--dry-run"]);
    expect(out).toContain("selectedCount=20");
  });

  it("uses live dry run when cookie is available", async () => {
    const out = await runCli(["run-once", "--dry-run"], {
      env: {
        NETEASE_API_BASE_URL: "http://localhost:3000",
        NETEASE_COOKIE: "MUSIC_U=live"
      } as NodeJS.ProcessEnv,
      runOnceLiveDryRun: async () => ({
        selectedCount: 3,
        candidates: 3,
        events: 3,
        nextCursor: "1200",
        songIds: ["s1", "s2", "s3"],
        recentLikedSongIds: ["s1", "s2", "s3"]
      })
    });

    expect(out).toContain("selectedCount=3");
    expect(out).toContain("events=3");
  });

  it("returns qr payload for bootstrap-login", async () => {
    const out = await runCli(["bootstrap-login"], {
      createNeteaseApiClient: () => createApiStub({
        async createQrLogin() {
          return {
            unikey: "u1",
            qrurl: "https://music.163.com/login?codekey=u1"
          };
        }
      })
    });

    expect(out).toContain("unikey=u1");
    expect(out).toContain("qrurl=https://music.163.com/login?codekey=u1");
  });

  it("returns normalized cookie for bootstrap-login check", async () => {
    const out = await runCli(["bootstrap-login", "--check", "u1"], {
      createNeteaseApiClient: () => createApiStub({
        async checkQrLogin() {
          return {
            status: "AUTHORIZED" as const,
            cookie: "MUSIC_U=next-cookie; __csrf=csrf-token"
          };
        }
      })
    });

    expect(out).toBe("qr-status=AUTHORIZED cookie-stored=true");
  });

  it("persists authorized cookie in db and reuses it for live dry run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "top-songs-cli-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "app.sqlite");
    const masterKey = "test-master-key-32bytes-min";

    const db = new DbClient(dbPath);
    db.initSchema();
    db.close();

    const authOut = await runCli(["bootstrap-login", "--check", "u1"], {
      env: {
        DB_PATH: dbPath,
        MASTER_KEY: masterKey
      } as NodeJS.ProcessEnv,
      createNeteaseApiClient: () => createApiStub({
        async checkQrLogin() {
          return {
            status: "AUTHORIZED" as const,
            cookie: "MUSIC_U=next-cookie; __csrf=csrf-token"
          };
        }
      })
    });

    expect(authOut).toContain("qr-status=AUTHORIZED");

    const verifyDb = new DbClient(dbPath);
    verifyDb.initSchema();
    const state = verifyDb.getNeteaseAuthState();
    verifyDb.close();

    const store = new CredentialStore(masterKey);
    const saved = store.decrypt<{ cookie: string }>(state!.encryptedCookie!);
    expect(saved.cookie).toBe("MUSIC_U=next-cookie; __csrf=csrf-token");

    const runOut = await runCli(["run-once", "--dry-run"], {
      env: {
        DB_PATH: dbPath,
        MASTER_KEY: masterKey,
        NETEASE_API_BASE_URL: "http://localhost:3000"
      } as NodeJS.ProcessEnv,
      runOnceLiveDryRun: async () => ({
        selectedCount: 2,
        candidates: 4,
        events: 1,
        nextCursor: "42",
        songIds: ["a", "b"],
        recentLikedSongIds: ["a", "b"]
      })
    });

    expect(runOut).toContain("selectedCount=2");
    expect(runOut).toContain("events=1");
  });

  it("imports douban baseline from json only once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "top-songs-douban-cli-"));
    tempDirs.push(dir);

    const dbPath = join(dir, "app.sqlite");
    const jsonPath = join(dir, "douban-baseline.json");
    writeFileSync(
      jsonPath,
      JSON.stringify([
        { title: "t1", artist: "a1", tags: ["rock"] },
        { title: "t2", artist: "a2", tags: ["pop"] }
      ]),
      "utf8"
    );

    const firstOut = await runCli(["douban-sync"], {
      env: {
        DB_PATH: dbPath,
        DOUBAN_BASELINE_PATH: jsonPath
      } as NodeJS.ProcessEnv
    });

    const db = new DbClient(dbPath);
    db.initSchema();
    expect(firstOut).toContain("imported=2");
    expect(db.countDoubanBaselineSongs()).toBe(2);

    const secondOut = await runCli(["douban-sync"], {
      env: {
        DB_PATH: dbPath,
        DOUBAN_BASELINE_PATH: jsonPath
      } as NodeJS.ProcessEnv
    });

    expect(secondOut).toContain("skipped=already-imported");
    expect(db.countDoubanBaselineSongs()).toBe(2);
    db.close();
  });

  it("imports netease liked songs baseline only once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "top-songs-netease-cli-"));
    tempDirs.push(dir);

    const dbPath = join(dir, "app.sqlite");
    const masterKey = "test-master-key-32bytes-min";
    const db = new DbClient(dbPath);
    db.initSchema();
    const store = new CredentialStore(masterKey);
    db.upsertNeteaseAuthState({
      encryptedCookie: store.encrypt({ cookie: "MUSIC_U=live; __csrf=token" })
    });
    db.close();

    const firstOut = await runCli(["netease-sync"], {
      env: {
        DB_PATH: dbPath,
        MASTER_KEY: masterKey,
        NETEASE_API_BASE_URL: "http://localhost:3000"
      } as NodeJS.ProcessEnv,
      createNeteaseApiClient: () =>
        createApiStub({
          async getLoginProfile() {
            return { userId: "42" };
          },
          async getLikedSongIds() {
            return ["1", "2"];
          },
          async getSongsDetail(songIds) {
            expect(songIds).toEqual(["1", "2"]);
            return [
              { songId: "1", title: "Song A", artist: "Artist A" },
              { songId: "2", title: "Song B", artist: "Artist B" }
            ];
          }
        })
    });

    expect(firstOut).toContain("imported=2");

    const verifyDb = new DbClient(dbPath);
    verifyDb.initSchema();
    expect(verifyDb.countNeteaseBaselineSongs()).toBe(2);
    expect(verifyDb.listNeteaseBaselineSongs(10)).toEqual(
      expect.arrayContaining([
        { title: "Song A", artist: "Artist A", preferredSongId: "1", tags: ["netease:liked"] },
        { title: "Song B", artist: "Artist B", preferredSongId: "2", tags: ["netease:liked"] }
      ])
    );

    const secondOut = await runCli(["netease-sync"], {
      env: {
        DB_PATH: dbPath,
        MASTER_KEY: masterKey,
        NETEASE_API_BASE_URL: "http://localhost:3000"
      } as NodeJS.ProcessEnv,
      createNeteaseApiClient: () => createApiStub()
    });

    expect(secondOut).toContain("skipped=already-imported");
    verifyDb.close();
  });

  it("uses only netease preferred song ids as long-term candidates", async () => {
    const dir = mkdtempSync(join(tmpdir(), "top-songs-longterm-cli-"));
    tempDirs.push(dir);

    const dbPath = join(dir, "app.sqlite");
    const db = new DbClient(dbPath);
    db.initSchema();
    db.upsertDoubanBaselineSong({
      title: "Back To Bedlam",
      artist: "James Blunt",
      tags: ["douban:collect", "摇滚"]
    });
    db.upsertNeteaseBaselineSong({
      title: "Yellow",
      artist: "Coldplay",
      preferredSongId: "song-2",
      tags: ["netease:liked"]
    });
    db.close();

    const out = await runCli(["run-once", "--dry-run"], {
      env: {
        DB_PATH: dbPath,
        NETEASE_API_BASE_URL: "http://localhost:3000",
        NETEASE_COOKIE: "MUSIC_U=live"
      } as NodeJS.ProcessEnv,
      runOnceLiveDryRun: async (input) => {
        expect(input.longTermSongIds).toEqual(["song-2"]);
        return {
          selectedCount: 1,
          candidates: 1,
          events: 0,
          nextCursor: "0",
          songIds: ["song-2"],
          recentLikedSongIds: ["song-2"]
        };
      }
    });

    expect(out).toContain("selectedCount=1");
    expect(out).toContain("song-2");
  });

  it("publishes playlist on run-once and records the run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "top-songs-publish-cli-"));
    tempDirs.push(dir);

    const dbPath = join(dir, "app.sqlite");
    const playlistOps: Array<{ op: "del" | "add"; tracks: string[] }> = [];

    const out = await runCli(["run-once"], {
      env: {
        DB_PATH: dbPath,
        NETEASE_API_BASE_URL: "http://localhost:3000",
        NETEASE_COOKIE: "MUSIC_U=live",
        NETEASE_PLAYLIST_ID: "playlist-1"
      } as NodeJS.ProcessEnv,
      createNeteaseApiClient: () =>
        createApiStub({
          async fetchEvents() {
            return {
              nextCursor: "10",
              rawEvents: []
            };
          },
          async getPlaylistTrackIds(playlistId) {
            expect(playlistId).toBe("playlist-1");
            return ["old-1", "old-2"];
          },
          async updatePlaylistTracks(playlistId, op, tracks) {
            expect(playlistId).toBe("playlist-1");
            playlistOps.push({ op, tracks });
          }
        }),
      runOnceLiveDryRun: async (input) => {
        expect(input.longTermSongIds).toEqual([]);
        return {
          selectedCount: 3,
          candidates: 3,
          events: 0,
          nextCursor: "10",
          songIds: ["s1", "s2", "s3"],
          recentLikedSongIds: ["s1", "s2", "s3"]
        };
      }
    });

    expect(out).toContain("run-once published");
    expect(playlistOps).toEqual([
      { op: "del", tracks: ["old-1", "old-2"] },
      { op: "add", tracks: ["s3", "s2", "s1"] }
    ]);

    const db = new DbClient(dbPath);
    db.initSchema();
    expect(db.countRecommendationRuns()).toBe(1);
    expect(db.countRecommendationRunSongs()).toBe(3);
    db.close();
  });
});

function createApiStub(overrides: Partial<{
  createQrLogin: () => Promise<{ unikey: string; qrurl: string }>;
  checkQrLogin: (unikey: string) => Promise<QrCheckResult>;
  searchSongIds: (keywords: string, limit?: number) => Promise<string[]>;
  searchSongs: (
    keywords: string,
    limit?: number
  ) => Promise<Array<{ songId: string; title: string; artist: string }>>;
  getSongCommentCount: (songId: string) => Promise<number>;
  getLoginProfile: (cookie: string) => Promise<{ userId: string | null }>;
  getLikedSongIds: (userId: string, cookie: string) => Promise<string[]>;
  getSongsDetail: (songIds: string[], cookie?: string) => Promise<Array<{ songId: string; title: string; artist: string }>>;
  refreshCookie: (cookie: string) => Promise<string>;
  fetchEvents: (cursor: string, cookie: string) => Promise<FetchEventsResult>;
  getPlaylistTrackIds: (playlistId: string, cookie: string) => Promise<string[]>;
  updatePlaylistTracks: (playlistId: string, op: "add" | "del", tracks: string[], cookie: string) => Promise<void>;
  updatePlaylistDescription: (playlistId: string, description: string, cookie: string) => Promise<void>;
}> = {}) {
  return {
    async createQrLogin() {
      return (
        (await overrides.createQrLogin?.()) ?? {
          unikey: "u1",
          qrurl: "https://music.163.com/login?codekey=u1"
        }
      );
    },
    async checkQrLogin(unikey: string) {
      const result = await overrides.checkQrLogin?.(unikey);
      return result ?? ({ status: "WAITING_SCAN" } satisfies QrCheckResult);
    },
    async searchSongIds(keywords: string, limit = 5) {
      return (await overrides.searchSongIds?.(keywords, limit)) ?? [];
    },
    async searchSongs(keywords: string, limit = 5) {
      return (await overrides.searchSongs?.(keywords, limit)) ?? [];
    },
    async getSongCommentCount(songId: string) {
      return (await overrides.getSongCommentCount?.(songId)) ?? 0;
    },
    async getLoginProfile(cookie: string) {
      return (await overrides.getLoginProfile?.(cookie)) ?? { userId: null };
    },
    async getLikedSongIds(userId: string, cookie: string) {
      return (await overrides.getLikedSongIds?.(userId, cookie)) ?? [];
    },
    async getSongsDetail(songIds: string[], cookie?: string) {
      return (await overrides.getSongsDetail?.(songIds, cookie)) ?? [];
    },
    async refreshCookie(cookie: string) {
      return (await overrides.refreshCookie?.(cookie)) ?? cookie;
    },
    async fetchEvents(cursor: string, cookie: string) {
      return (
        (await overrides.fetchEvents?.(cursor, cookie)) ?? {
          nextCursor: cursor,
          rawEvents: []
        }
      );
    },
    async getPlaylistTrackIds(playlistId: string, cookie: string) {
      return (await overrides.getPlaylistTrackIds?.(playlistId, cookie)) ?? [];
    },
    async updatePlaylistTracks(playlistId: string, op: "add" | "del", tracks: string[], cookie: string) {
      await overrides.updatePlaylistTracks?.(playlistId, op, tracks, cookie);
    },
    async updatePlaylistDescription(playlistId: string, description: string, cookie: string) {
      await overrides.updatePlaylistDescription?.(playlistId, description, cookie);
    }
  };
}
