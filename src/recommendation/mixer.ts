export interface MixCandidatesInput {
  recentSongIds: string[];
  longTermSongIds: string[];
  recentWeight: number;
  longTermWeight: number;
}

export interface MixedCandidate {
  songId: string;
  recentWeight: number;
  longTermWeight: number;
}

export function mixCandidates(input: MixCandidatesInput): MixedCandidate[] {
  if (input.recentSongIds.length === 0) {
    return input.longTermSongIds.map((songId) => ({
      songId,
      recentWeight: 0,
      longTermWeight: 1
    }));
  }

  const seen = new Set<string>();
  const mixed: MixedCandidate[] = [];

  for (const songId of input.recentSongIds) {
    if (seen.has(songId)) continue;
    seen.add(songId);
    mixed.push({
      songId,
      recentWeight: input.recentWeight,
      longTermWeight: input.longTermWeight
    });
  }

  for (const songId of input.longTermSongIds) {
    if (seen.has(songId)) continue;
    seen.add(songId);
    mixed.push({
      songId,
      recentWeight: input.recentWeight,
      longTermWeight: input.longTermWeight
    });
  }

  return mixed;
}
