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
      limit: 2
    });

    expect(result.events).toBe(3);
    expect(result.candidates).toBe(2);
    expect(result.selectedCount).toBe(2);
    expect(result.songIds).toEqual(["s1", "s2"]);
    expect(result.nextCursor).toBe("1200");
  });
});
