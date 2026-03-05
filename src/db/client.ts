import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

export interface CreateRecommendationRunInput {
  runDate: string;
  selectedCount: number;
}

export interface RecommendationRunRecord {
  id: number;
  runDate: string;
  selectedCount: number;
  createdAt: string;
}

export interface DoubanBaselineSongInput {
  songId: string;
  artist: string;
  tags: string[];
}

export interface NeteaseEventInput {
  idempotencyKey: string;
  eventId: string;
  songId: string;
  actionType: string;
  actionTime: number;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, "schema.sql");

export class DbClient {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  initSchema(): void {
    const schemaSql = readFileSync(schemaPath, "utf8");
    this.db.exec(schemaSql);
  }

  createRecommendationRun(input: CreateRecommendationRunInput): RecommendationRunRecord {
    const stmt = this.db.prepare(`
      INSERT INTO recommendation_runs (run_date, selected_count)
      VALUES (?, ?)
      RETURNING id, run_date, selected_count, created_at
    `);

    const row = stmt.get(input.runDate, input.selectedCount) as {
      id: number;
      run_date: string;
      selected_count: number;
      created_at: string;
    };

    return {
      id: row.id,
      runDate: row.run_date,
      selectedCount: row.selected_count,
      createdAt: row.created_at
    };
  }

  close(): void {
    this.db.close();
  }

  upsertDoubanBaselineSong(input: DoubanBaselineSongInput): void {
    const stmt = this.db.prepare(`
      INSERT INTO douban_baseline_songs (song_id, artist, tags)
      VALUES (?, ?, ?)
      ON CONFLICT(song_id) DO UPDATE SET
        artist = excluded.artist,
        tags = excluded.tags,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `);
    stmt.run(input.songId, input.artist, JSON.stringify(input.tags));
  }

  countDoubanBaselineSongs(): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM douban_baseline_songs
    `);
    const row = stmt.get() as { total: number };
    return row.total;
  }

  listDoubanBaselineSongs(limit: number): string[] {
    const stmt = this.db.prepare(`
      SELECT song_id AS songId
      FROM douban_baseline_songs
      ORDER BY updated_at DESC
      LIMIT ?
    `);
    return stmt.all(limit).map((row: { songId: string }) => row.songId);
  }

  insertNeteaseEvent(input: NeteaseEventInput): boolean {
    const stmt = this.db.prepare(`
      INSERT INTO netease_events (idempotency_key, event_id, song_id, action_type, action_time)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING
    `);
    const result = stmt.run(
      input.idempotencyKey,
      input.eventId,
      input.songId,
      input.actionType,
      input.actionTime
    );
    return result.changes > 0;
  }

  countNeteaseEvents(): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM netease_events
    `);
    const row = stmt.get() as { total: number };
    return row.total;
  }
}
