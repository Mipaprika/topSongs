import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli";
import { DbClient } from "../src/db/client";
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
      createNeteaseApiClient: () => ({
        async createQrLogin() {
          return {
            unikey: "u1",
            qrurl: "https://music.163.com/login?codekey=u1"
          };
        },
        async checkQrLogin() {
          return { status: "WAITING_SCAN" as const };
        }
      })
    });

    expect(out).toContain("unikey=u1");
    expect(out).toContain("qrurl=https://music.163.com/login?codekey=u1");
  });

  it("returns normalized cookie for bootstrap-login check", async () => {
    const out = await runCli(["bootstrap-login", "--check", "u1"], {
      createNeteaseApiClient: () => ({
        async createQrLogin() {
          return {
            unikey: "u1",
            qrurl: "https://music.163.com/login?codekey=u1"
          };
        },
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
      createNeteaseApiClient: () => ({
        async createQrLogin() {
          return {
            unikey: "u1",
            qrurl: "https://music.163.com/login?codekey=u1"
          };
        },
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
});
