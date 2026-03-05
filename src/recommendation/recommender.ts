import { scoreCandidate } from "./scoring";

export interface RecommendationCandidate {
  songId: string;
  shortTermSimilarity: number;
  longTermSimilarity: number;
  freshness: number;
  diversity: number;
}

export interface RecommendSongsInput {
  listenedSongIds: Set<string>;
  likedSongIds: Set<string>;
  favoritedSongIds: Set<string>;
  previouslyRecommendedSongIds: Set<string>;
  candidates: RecommendationCandidate[];
  limit: number;
}

export function recommendSongs(input: RecommendSongsInput): string[] {
  const hardExcluded = new Set<string>([
    ...input.listenedSongIds,
    ...input.likedSongIds,
    ...input.favoritedSongIds
  ]);

  return input.candidates
    .filter((candidate) => !hardExcluded.has(candidate.songId))
    .map((candidate) => ({
      songId: candidate.songId,
      score: scoreCandidate(candidate)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit)
    .map((item) => item.songId);
}
