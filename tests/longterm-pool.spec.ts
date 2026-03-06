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

describe("listDoubanBaselineSongs", () => {
  it("returns up to N long-term works from douban baseline", () => {
    const dir = mkdtempSync(join(tmpdir(), "top-songs-longterm-"));
    tempDirs.push(dir);

    const db = new DbClient(join(dir, "app.sqlite"));
    db.initSchema();
    db.upsertDoubanBaselineSong({ title: "t1", artist: "a1", tags: ["rock"] });
    db.upsertDoubanBaselineSong({ title: "t2", artist: "a2", tags: ["pop"] });

    const pool = db.listDoubanBaselineSongs(1);
    expect(pool.length).toBe(1);
    expect(["t1", "t2"]).toContain(pool[0].title);
  });
});
