import type { DbClient } from "../db/client";
import { normalizeDoubanRows, type DoubanSongRow } from "./douban-parser";

export function importDoubanBaseline(rows: DoubanSongRow[], db: DbClient): number {
  const normalized = normalizeDoubanRows(rows);
  for (const row of normalized) {
    db.upsertDoubanBaselineSong({
      songId: row.songId,
      artist: row.artist,
      tags: row.tags
    });
  }
  return normalized.length;
}
