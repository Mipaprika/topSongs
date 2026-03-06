import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli";
import { DbClient } from "../src/db/client";
import type { QrCheckResult } from "../src/providers/netease/types";
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
        songIds: ["s1", "s2", "s3"]
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

    expect(out).toBe("qr-status=AUTHORIZED cookie=MUSIC_U=next-cookie; __csrf=csrf-token");
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
        songIds: ["a", "b"]
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

  it("resolves long-term works into song candidates for live dry run", async () => {
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
      tags: ["netease:liked"]
    });
    db.close();

    const out = await runCli(["run-once", "--dry-run"], {
      env: {
        DB_PATH: dbPath,
        NETEASE_API_BASE_URL: "http://localhost:3000",
        NETEASE_COOKIE: "MUSIC_U=live"
      } as NodeJS.ProcessEnv,
      resolveLongTermWorkSongIds: async (works) => {
        expect(works).toEqual([
          {
            title: "Back To Bedlam",
            artist: "James Blunt",
            preferredSongId: null,
            tags: ["douban:collect", "摇滚"]
          },
          {
            title: "Yellow",
            artist: "Coldplay",
            preferredSongId: null,
            tags: ["netease:liked"]
          }
        ]);
        return ["song-1", "song-2"];
      },
      runOnceLiveDryRun: async (input) => {
        expect(input.longTermSongIds).toEqual(["song-1", "song-2"]);
        return {
          selectedCount: 2,
          candidates: 2,
          events: 0,
          nextCursor: "0",
          songIds: ["song-1", "song-2"]
        };
      }
    });

    expect(out).toContain("selectedCount=2");
    expect(out).toContain("song-1,song-2");
  });
});

function createApiStub(overrides: Partial<{
  createQrLogin: () => Promise<{ unikey: string; qrurl: string }>;
  checkQrLogin: (unikey: string) => Promise<QrCheckResult>;
  searchSongIds: (keywords: string, limit?: number) => Promise<string[]>;
  getLoginProfile: (cookie: string) => Promise<{ userId: string | null }>;
  getLikedSongIds: (userId: string, cookie: string) => Promise<string[]>;
  getSongsDetail: (songIds: string[], cookie?: string) => Promise<Array<{ songId: string; title: string; artist: string }>>;
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
    async getLoginProfile(cookie: string) {
      return (await overrides.getLoginProfile?.(cookie)) ?? { userId: null };
    },
    async getLikedSongIds(userId: string, cookie: string) {
      return (await overrides.getLikedSongIds?.(userId, cookie)) ?? [];
    },
    async getSongsDetail(songIds: string[], cookie?: string) {
      return (await overrides.getSongsDetail?.(songIds, cookie)) ?? [];
    }
  };
}
