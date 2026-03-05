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
});
