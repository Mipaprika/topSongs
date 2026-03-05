import { recommendSongs } from "../recommendation/recommender";

export interface RunOnceResult {
  selectedCount: number;
}

export function runOnceDryRun(): RunOnceResult {
  const candidates = Array.from({ length: 30 }, (_, index) => ({
    songId: `song-${index + 1}`,
    shortTermSimilarity: 0.8 - index * 0.01,
    longTermSimilarity: 0.7 - index * 0.01,
    freshness: 0.5,
    diversity: 0.4
  }));

  const picks = recommendSongs({
    listenedSongIds: new Set(),
    likedSongIds: new Set(),
    favoritedSongIds: new Set(),
    previouslyRecommendedSongIds: new Set(),
    candidates,
    limit: 20
  });

  return {
    selectedCount: picks.length
  };
}
