import { describe, expect, it } from "vitest";

import { runOnceLiveDryRun } from "../src/jobs/run-once";

describe("runOnceLiveDryRun", () => {
  it("dedupes events and returns selected songs without writing", async () => {
    const incrementalProvider = {
      async fetchSince() {
        return {
          nextCursor: "1200",
          events: [
            { eventId: "e1", songId: "s1", actionType: "LIKE", actionTime: 1000 },
            { eventId: "e2", songId: "s2", actionType: "FAVORITE", actionTime: 1100 },
            { eventId: "e3", songId: "s1", actionType: "LIKE", actionTime: 1200 }
          ]
        };
      }
    };

    const result = await runOnceLiveDryRun({
      incrementalProvider,
      cursor: "1000",
      limit: 2,
      longTermSongIds: []
    });

    expect(result.events).toBe(3);
    expect(result.candidates).toBe(2);
    expect(result.selectedCount).toBe(2);
    expect(result.songIds).toEqual(["s1", "s2"]);
    expect(result.nextCursor).toBe("1200");
  });

  it("falls back to long-term only when no recent events", async () => {
    const incrementalProvider = {
      async fetchSince() {
        return {
          nextCursor: "1",
          events: []
        };
      }
    };

    const result = await runOnceLiveDryRun({
      incrementalProvider,
      cursor: "0",
      limit: 20,
      longTermSongIds: ["l1", "l2", "l3"]
    });

    expect(result.selectedCount).toBe(3);
    expect(result.songIds).toEqual(["l1", "l2", "l3"]);
  });

  it("fills with exploration pool when candidates不足", async () => {
    const incrementalProvider = {
      async fetchSince() {
        return {
          nextCursor: "1",
          events: []
        };
      }
    };

    const result = await runOnceLiveDryRun({
      incrementalProvider,
      cursor: "0",
      limit: 3,
      longTermSongIds: ["l1"],
      explorationSongIds: ["e1", "e2"]
    });

    expect(result.selectedCount).toBe(3);
    expect(result.songIds).toEqual(["l1", "e1", "e2"]);
  });
});
