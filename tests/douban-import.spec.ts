import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { DbClient } from "../src/db/client";
import { importDoubanBaseline } from "../src/ingest/douban-import";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("importDoubanBaseline", () => {
  it("imports source records and performs upsert", () => {
    const dir = mkdtempSync(join(tmpdir(), "top-songs-douban-"));
    tempDirs.push(dir);

    const db = new DbClient(join(dir, "app.sqlite"));
    db.initSchema();

    const firstCount = importDoubanBaseline(
      [
        { songId: "s1", artist: "a1", tags: ["rock"] },
        { songId: "s2", artist: "a2", tags: ["pop"] },
        { songId: "s3", artist: "a3", tags: ["indie"] }
      ],
      db
    );

    const secondCount = importDoubanBaseline(
      [{ songId: "s2", artist: "a2-updated", tags: ["synthpop"] }],
      db
    );

    expect(firstCount).toBe(3);
    expect(secondCount).toBe(1);
    expect(db.countDoubanBaselineSongs()).toBe(3);
  });
});
