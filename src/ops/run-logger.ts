import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type LogLevel = "INFO" | "WARN" | "ERROR";

export interface RunLogger {
  log(level: LogLevel, event: string, data?: Record<string, unknown>): void;
}

class JsonlRunLogger implements RunLogger {
  constructor(private readonly filePath: string) {}

  log(level: LogLevel, event: string, data?: Record<string, unknown>): void {
    try {
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        event,
        ...data
      });
      appendFileSync(this.filePath, `${line}\n`, "utf8");
    } catch {
      // Never break main flow because of logging failure.
    }
  }
}

class NoopRunLogger implements RunLogger {
  log(): void {}
}

export function createRunLogger(env: NodeJS.ProcessEnv): RunLogger {
  const filePath = resolveRunLogPath(env);
  if (!filePath) {
    return new NoopRunLogger();
  }

  try {
    mkdirSync(dirname(filePath), { recursive: true });
    return new JsonlRunLogger(filePath);
  } catch {
    return new NoopRunLogger();
  }
}

export function pruneRunLogs(env: NodeJS.ProcessEnv): void {
  const filePath = resolveRunLogPath(env);
  if (!filePath || !existsSync(filePath)) {
    return;
  }

  const retentionMs = resolveRetentionMs(env);
  try {
    const stat = statSync(filePath);
    if (Date.now() - stat.mtimeMs > retentionMs) {
      writeFileSync(filePath, "", "utf8");
      return;
    }

    const cutoff = Date.now() - retentionMs;
    const lines = readFileSync(filePath, "utf8").split("\n").filter((line) => line.trim().length > 0);
    const kept: string[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as { ts?: string };
        const ts = parsed.ts ? Date.parse(parsed.ts) : NaN;
        if (Number.isFinite(ts) && ts >= cutoff) {
          kept.push(line);
        }
      } catch {
        // Drop malformed lines during compaction.
      }
    }
    writeFileSync(filePath, kept.length > 0 ? `${kept.join("\n")}\n` : "", "utf8");
  } catch {
    // Keep silent; retention should not affect the job.
  }
}

function resolveRunLogPath(env: NodeJS.ProcessEnv): string | null {
  const explicitPath = (env.RUN_LOG_PATH ?? "").trim();
  if (explicitPath) {
    return explicitPath;
  }

  const dbPath = (env.DB_PATH ?? "").trim();
  if (!dbPath) {
    return null;
  }

  return join(dirname(dbPath), "run.log");
}

function resolveRetentionMs(env: NodeJS.ProcessEnv): number {
  const hours = Number(env.RUN_LOG_RETENTION_HOURS ?? "24");
  if (!Number.isFinite(hours) || hours <= 0) {
    return 24 * 60 * 60 * 1000;
  }
  return hours * 60 * 60 * 1000;
}

