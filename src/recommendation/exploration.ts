export function fillWithExploration(
  primary: string[],
  exploration: string[],
  limit: number
): string[] {
  if (primary.length >= limit) {
    return primary.slice(0, limit);
  }

  const result = [...primary];
  const seen = new Set(primary);

  for (const songId of exploration) {
    if (result.length >= limit) break;
    if (seen.has(songId)) continue;
    seen.add(songId);
    result.push(songId);
  }

  return result;
}
