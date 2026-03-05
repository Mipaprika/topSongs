export interface DoubanSongRow {
  songId: string;
  artist: string;
  tags: string[];
}

export function normalizeDoubanRows(rows: DoubanSongRow[]): DoubanSongRow[] {
  return rows
    .map((row) => ({
      songId: row.songId.trim(),
      artist: row.artist.trim(),
      tags: row.tags.map((tag) => tag.trim()).filter(Boolean)
    }))
    .filter((row) => row.songId.length > 0 && row.artist.length > 0);
}
