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

export interface RecommendationRunSongInput {
  runId: number;
  songId: string;
  score?: number | null;
}

export interface DoubanBaselineSongInput {
  title: string;
  artist: string;
  tags: string[];
}

export interface DoubanBaselineWorkRecord {
  title: string;
  artist: string;
  preferredSongId?: string | null;
  tags: string[];
}

export interface NeteaseBaselineSongInput {
  title: string;
  artist: string;
  preferredSongId?: string | null;
  tags: string[];
}

export interface NeteaseEventInput {
  idempotencyKey: string;
  eventId: string;
  songId: string;
  actionType: string;
  actionTime: number;
}

export interface NeteaseAuthStateInput {
  encryptedCookie?: string | null;
  pendingUnikey?: string | null;
  pendingQrUrl?: string | null;
}

export interface NeteaseAuthStateRecord {
  provider: string;
  encryptedCookie: string | null;
  pendingUnikey: string | null;
  pendingQrUrl: string | null;
  updatedAt: string;
}

interface RuntimeStateRow {
  value: string;
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
    this.migrateLegacyDoubanBaselineSongs();
    this.migrateNeteaseBaselineSongs();
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

  countRecommendationRuns(): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM recommendation_runs
    `);
    const row = stmt.get() as { total: number };
    return row.total;
  }

  countRecommendationRunSongs(): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM recommendation_run_songs
    `);
    const row = stmt.get() as { total: number };
    return row.total;
  }

  close(): void {
    this.db.close();
  }

  deleteRecommendationRunByDate(runDate: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM recommendation_runs
      WHERE run_date = ?
    `);
    stmt.run(runDate);
  }

  insertRecommendationRunSong(input: RecommendationRunSongInput): void {
    const stmt = this.db.prepare(`
      INSERT INTO recommendation_run_songs (run_id, song_id, score)
      VALUES (?, ?, ?)
    `);
    stmt.run(input.runId, input.songId, input.score ?? null);
  }

  upsertDoubanBaselineSong(input: DoubanBaselineSongInput): void {
    const stmt = this.db.prepare(`
      INSERT INTO douban_baseline_songs (title, artist, tags)
      VALUES (?, ?, ?)
      ON CONFLICT(artist, title) DO UPDATE SET
        tags = excluded.tags,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `);
    stmt.run(input.title, input.artist, JSON.stringify(input.tags));
  }

  countDoubanBaselineSongs(): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM douban_baseline_songs
    `);
    const row = stmt.get() as { total: number };
    return row.total;
  }

  listDoubanBaselineSongs(limit: number): DoubanBaselineWorkRecord[] {
    const stmt = this.db.prepare(`
      SELECT title, artist, tags
      FROM douban_baseline_songs
      ORDER BY updated_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as Array<{ title: string; artist: string; tags: string }>;
    return rows.map((row) => ({
      title: row.title,
      artist: row.artist,
      preferredSongId: null,
      tags: JSON.parse(row.tags) as string[]
    }));
  }

  upsertNeteaseBaselineSong(input: NeteaseBaselineSongInput): void {
    const stmt = this.db.prepare(`
      INSERT INTO netease_baseline_songs (title, artist, preferred_song_id, tags)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(artist, title) DO UPDATE SET
        preferred_song_id = excluded.preferred_song_id,
        tags = excluded.tags,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `);
    stmt.run(input.title, input.artist, input.preferredSongId ?? null, JSON.stringify(input.tags));
  }

  countNeteaseBaselineSongs(): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM netease_baseline_songs
    `);
    const row = stmt.get() as { total: number };
    return row.total;
  }

  countNeteaseBaselineSongsWithoutPreferredSongId(): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM netease_baseline_songs
      WHERE preferred_song_id IS NULL OR preferred_song_id = ''
    `);
    const row = stmt.get() as { total: number };
    return row.total;
  }

  listNeteaseBaselineSongs(limit: number): DoubanBaselineWorkRecord[] {
    const stmt = this.db.prepare(`
      SELECT title, artist, preferred_song_id AS preferredSongId, tags
      FROM netease_baseline_songs
      ORDER BY updated_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as Array<{ title: string; artist: string; preferredSongId: string | null; tags: string }>;
    return rows.map((row) => ({
      title: row.title,
      artist: row.artist,
      preferredSongId: row.preferredSongId,
      tags: JSON.parse(row.tags) as string[]
    }));
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

  listRecentLikedSongIds(limit: number): string[] {
    const stmt = this.db.prepare(`
      SELECT song_id AS songId, MAX(action_time) AS latestActionTime
      FROM netease_events
      WHERE action_type = 'LIKE'
      GROUP BY song_id
      ORDER BY latestActionTime DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as Array<{ songId: string }>;
    return rows.map((row) => row.songId);
  }

  upsertNeteaseAuthState(input: NeteaseAuthStateInput): void {
    const stmt = this.db.prepare(`
      INSERT INTO netease_auth_state (provider, encrypted_cookie, pending_unikey, pending_qr_url)
      VALUES ('netease', ?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET
        encrypted_cookie = excluded.encrypted_cookie,
        pending_unikey = excluded.pending_unikey,
        pending_qr_url = excluded.pending_qr_url,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `);

    stmt.run(input.encryptedCookie ?? null, input.pendingUnikey ?? null, input.pendingQrUrl ?? null);
  }

  getNeteaseAuthState(): NeteaseAuthStateRecord | null {
    const stmt = this.db.prepare(`
      SELECT provider,
             encrypted_cookie AS encryptedCookie,
             pending_unikey AS pendingUnikey,
             pending_qr_url AS pendingQrUrl,
             updated_at AS updatedAt
      FROM netease_auth_state
      WHERE provider = 'netease'
      LIMIT 1
    `);

    const row = stmt.get() as NeteaseAuthStateRecord | undefined;
    return row ?? null;
  }

  getRuntimeState(key: string): string | null {
    const stmt = this.db.prepare(`
      SELECT value
      FROM runtime_state
      WHERE key = ?
      LIMIT 1
    `);
    const row = stmt.get(key) as RuntimeStateRow | undefined;
    return row?.value ?? null;
  }

  upsertRuntimeState(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO runtime_state (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `);
    stmt.run(key, value);
  }

  private migrateLegacyDoubanBaselineSongs(): void {
    const columns = this.db.prepare(`PRAGMA table_info(douban_baseline_songs)`).all() as Array<{ name: string }>;
    const hasSongId = columns.some((column) => column.name === "song_id");
    const hasTitle = columns.some((column) => column.name === "title");

    if (!hasSongId || hasTitle) {
      return;
    }

    this.db.exec(`
      ALTER TABLE douban_baseline_songs RENAME TO douban_baseline_songs_legacy;

      CREATE TABLE douban_baseline_songs (
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        tags TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (artist, title)
      );

      INSERT INTO douban_baseline_songs (title, artist, tags, updated_at)
      SELECT song_id, artist, tags, updated_at
      FROM douban_baseline_songs_legacy;

      DROP TABLE douban_baseline_songs_legacy;
    `);
  }

  private migrateNeteaseBaselineSongs(): void {
    const columns = this.db.prepare(`PRAGMA table_info(netease_baseline_songs)`).all() as Array<{ name: string }>;
    const hasPreferredSongId = columns.some((column) => column.name === "preferred_song_id");
    if (hasPreferredSongId) {
      return;
    }

    this.db.exec(`
      ALTER TABLE netease_baseline_songs
      ADD COLUMN preferred_song_id TEXT;
    `);
  }
}
