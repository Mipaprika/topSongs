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
}
