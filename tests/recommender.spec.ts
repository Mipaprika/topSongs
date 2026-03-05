import { describe, expect, it } from "vitest";

import { recommendSongs } from "../src/recommendation/recommender";

describe("recommendSongs", () => {
  it("keeps recommended-but-unlistened songs eligible", () => {
    const picks = recommendSongs({
      listenedSongIds: new Set(["s1"]),
      likedSongIds: new Set(["s2"]),
      favoritedSongIds: new Set(),
      previouslyRecommendedSongIds: new Set(["s3"]),
      candidates: [
        { songId: "s1", shortTermSimilarity: 0.9, longTermSimilarity: 0.8, freshness: 0.5, diversity: 0.1 },
        { songId: "s2", shortTermSimilarity: 0.8, longTermSimilarity: 0.7, freshness: 0.6, diversity: 0.1 },
        { songId: "s3", shortTermSimilarity: 0.7, longTermSimilarity: 0.9, freshness: 0.8, diversity: 0.2 },
        { songId: "s4", shortTermSimilarity: 0.6, longTermSimilarity: 0.6, freshness: 0.9, diversity: 0.3 }
      ],
      limit: 20
    });

    expect(picks).toContain("s3");
    expect(picks).not.toContain("s1");
    expect(picks).not.toContain("s2");
  });
});
