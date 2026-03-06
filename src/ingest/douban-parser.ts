export interface DoubanSongRow {
  title: string;
  artist: string;
  tags: string[];
}

export function normalizeDoubanRows(rows: DoubanSongRow[]): DoubanSongRow[] {
  return rows
    .map((row) => ({
      title: row.title.trim(),
      artist: row.artist.trim(),
      tags: row.tags.map((tag) => tag.trim()).filter(Boolean)
    }))
    .filter((row) => row.title.length > 0 && row.artist.length > 0);
}
