import { recommendSongs } from "../recommendation/recommender";
import { mixCandidates } from "../recommendation/mixer";
import { fillWithExploration } from "../recommendation/exploration";
import type { NeteaseIncrementalProvider } from "../ingest/netease-incremental";

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

export interface RunOnceLiveDryRunInput {
  incrementalProvider: NeteaseIncrementalProvider;
  cursor: string;
  limit: number;
  longTermSongIds: string[];
  explorationSongIds?: string[];
}

export interface RunOnceLiveDryRunResult {
  selectedCount: number;
  candidates: number;
  events: number;
  nextCursor: string;
  songIds: string[];
}

export async function runOnceLiveDryRun(
  input: Partial<RunOnceLiveDryRunInput> & Pick<RunOnceLiveDryRunInput, "incrementalProvider">
): Promise<RunOnceLiveDryRunResult> {
  const cursor = input.cursor ?? "0";
  const limit = input.limit ?? 20;
  const response = await input.incrementalProvider.fetchSince(cursor);

  const recentSongIds = Array.from(
    new Set(response.events.map((event) => event.songId))
  );
  const longTermSongIds = input.longTermSongIds ?? [];

  const mixed = mixCandidates({
    recentSongIds,
    longTermSongIds,
    recentWeight: 0.6,
    longTermWeight: 0.4
  });

  const candidates = mixed.map((candidate, index) => ({
    songId: candidate.songId,
    shortTermSimilarity: candidate.recentWeight,
    longTermSimilarity: candidate.longTermWeight,
    freshness: 0.5 - index * 0.001,
    diversity: 0.4
  }));

  const picks = recommendSongs({
    listenedSongIds: new Set(),
    likedSongIds: new Set(),
    favoritedSongIds: new Set(),
    previouslyRecommendedSongIds: new Set(),
    candidates,
    limit
  });

  const filled = fillWithExploration(picks, input.explorationSongIds ?? [], limit);

  return {
    selectedCount: filled.length,
    candidates: candidates.length,
    events: response.events.length,
    nextCursor: response.nextCursor,
    songIds: filled
  };
}
