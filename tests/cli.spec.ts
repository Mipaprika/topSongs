import { describe, expect, it } from "vitest";

import { runCli } from "../src/cli";

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
});
