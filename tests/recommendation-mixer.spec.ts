import { describe, expect, it } from "vitest";

import { mixCandidates } from "../src/recommendation/mixer";

describe("mixCandidates", () => {
  it("uses recent + long-term when recent exists, long-term only otherwise", () => {
    const withRecent = mixCandidates({
      recentSongIds: ["r1", "r2"],
      longTermSongIds: ["l1", "l2"],
      recentWeight: 0.6,
      longTermWeight: 0.4
    });
    expect(withRecent.some((c) => c.songId === "r1")).toBe(true);
    expect(withRecent.some((c) => c.songId === "l1")).toBe(true);

    const noRecent = mixCandidates({
      recentSongIds: [],
      longTermSongIds: ["l1", "l2"],
      recentWeight: 0.6,
      longTermWeight: 0.4
    });
    expect(noRecent.length).toBe(2);
  });
});
