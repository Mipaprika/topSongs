import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { DbClient } from "../src/db/client";

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
});
