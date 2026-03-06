import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { DbClient } from "../src/db/client";
import { CredentialStore } from "../src/security/credential-store";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("DbClient schema", () => {
  it("stores recommendation run and song rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "top-songs-db-"));
    tempDirs.push(dir);

    const dbPath = join(dir, "app.sqlite");
    const db = new DbClient(dbPath);
    db.initSchema();

    const run = db.createRecommendationRun({
      runDate: "2026-03-05",
      selectedCount: 20
    });

    expect(run.selectedCount).toBe(20);
  });

  it("stores encrypted netease auth state", () => {
    const dir = mkdtempSync(join(tmpdir(), "top-songs-db-"));
    tempDirs.push(dir);

    const dbPath = join(dir, "app.sqlite");
    const db = new DbClient(dbPath);
    db.initSchema();

    const store = new CredentialStore("test-master-key-32bytes-min");
    const encryptedCookie = store.encrypt({ cookie: "MUSIC_U=next-cookie" });

    db.upsertNeteaseAuthState({
      encryptedCookie,
      pendingUnikey: "u1",
      pendingQrUrl: "https://music.163.com/login?codekey=u1"
    });

    const state = db.getNeteaseAuthState();
    expect(state?.encryptedCookie).toBe(encryptedCookie);
    expect(state?.pendingUnikey).toBe("u1");
    expect(state?.pendingQrUrl).toContain("codekey=u1");
  });
});
