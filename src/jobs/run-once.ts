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
  maxPages?: number;
  maxEvents?: number;
}

export interface RunOnceLiveDryRunResult {
  selectedCount: number;
  candidates: number;
  events: number;
  nextCursor: string;
  songIds: string[];
  recentLikedSongIds: string[];
}

export async function runOnceLiveDryRun(
  input: Partial<RunOnceLiveDryRunInput> & Pick<RunOnceLiveDryRunInput, "incrementalProvider">
): Promise<RunOnceLiveDryRunResult> {
  const initialCursor = input.cursor ?? "0";
  const limit = input.limit ?? 20;
  const maxPages = Math.max(1, input.maxPages ?? 5);
  const maxEvents = Math.max(1, input.maxEvents ?? 500);
  const eventPageSize = 100;
  const aggregatedEvents: Array<{ eventId: string; songId: string; actionType: string; actionTime: number }> = [];
  let nextCursor = initialCursor;
  let pageCount = 0;

  while (pageCount < maxPages && aggregatedEvents.length < maxEvents) {
    const cursorBeforeFetch = nextCursor;
    const page = await input.incrementalProvider.fetchSince(cursorBeforeFetch);
    pageCount += 1;

    if (page.events.length === 0) {
      nextCursor = page.nextCursor;
      break;
    }

    aggregatedEvents.push(...page.events);
    nextCursor = page.nextCursor;

    if (page.events.length < eventPageSize) {
      break;
    }

    if (page.nextCursor === cursorBeforeFetch) {
      break;
    }
  }

  const events = aggregatedEvents.slice(0, maxEvents);

  const recentSongIds = Array.from(
    new Set(events.map((event) => event.songId))
  );
  const recentLikedSongIds = Array.from(
    new Set(
      events
        .filter((event) => event.actionType === "LIKE")
        .sort((a, b) => b.actionTime - a.actionTime)
        .map((event) => event.songId)
    )
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
    events: events.length,
    nextCursor,
    songIds: filled,
    recentLikedSongIds
  };
}
