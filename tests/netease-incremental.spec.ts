import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { DbClient } from "../src/db/client";
import { ingestIncremental } from "../src/ingest/netease-incremental";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("ingestIncremental", () => {
  it("persists only new events based on cursor and idempotency key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "top-songs-incremental-"));
    tempDirs.push(dir);

    const db = new DbClient(join(dir, "app.sqlite"));
    db.initSchema();

    const provider = {
      async fetchSince(cursor: string) {
        expect(cursor).toBe("1000");
        return {
          nextCursor: "1200",
          events: [
            { eventId: "e1", songId: "s1", actionType: "LIKE", actionTime: 1100 },
            { eventId: "e2", songId: "s2", actionType: "FAVORITE", actionTime: 1200 },
            { eventId: "e2", songId: "s2", actionType: "FAVORITE", actionTime: 1200 }
          ]
        };
      }
    };

    const result = await ingestIncremental({ cursor: "1000" }, db, provider);

    expect(result.inserted).toBe(2);
    expect(result.nextCursor).toBe("1200");
    expect(db.countNeteaseEvents()).toBe(2);
  });
});
