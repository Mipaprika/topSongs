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
});
