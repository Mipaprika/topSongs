import { runOnceDryRun, runOnceLiveDryRun } from "./jobs/run-once";
import { NeteaseApiClient } from "./providers/netease/api-client";
import { createNeteaseLiveAdapters } from "./providers/netease/live-adapters";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DbClient } from "./db/client";
import { CredentialStore } from "./security/credential-store";
import { importDoubanBaseline } from "./ingest/douban-import";
import type { DoubanSongRow } from "./ingest/douban-parser";

type NeteaseBootstrapApi = Pick<NeteaseApiClient, "createQrLogin" | "checkQrLogin">;

export interface CliDeps {
  env?: NodeJS.ProcessEnv;
  createNeteaseApiClient?: (baseUrl: string) => NeteaseBootstrapApi;
  runOnceLiveDryRun?: typeof runOnceLiveDryRun;
}

const HELP_TEXT = `
Usage: top-songs <command>

Commands:
  bootstrap-login   Start Netease QR login bootstrap
  douban-sync       Run one-time Douban baseline import
  run-once          Execute one daily recommendation run
`;

export async function runCli(args: string[], deps: CliDeps = {}): Promise<string> {
  const [command, ...flags] = args;
  const env = deps.env ?? process.env;
  const createNeteaseApiClient =
    deps.createNeteaseApiClient ??
    ((baseUrl: string) =>
      new NeteaseApiClient({
        baseUrl
      }));
  const runLiveDryRun = deps.runOnceLiveDryRun ?? runOnceLiveDryRun;

  if (!command || command === "--help" || command === "-h") {
    return HELP_TEXT.trim();
  }

  switch (command) {
    case "bootstrap-login": {
      const baseUrl = env.NETEASE_API_BASE_URL ?? "http://127.0.0.1:3000";
      const api = createNeteaseApiClient(baseUrl);
      const unikey = readFlagValue(flags, "--check");

      if (unikey) {
        const status = await api.checkQrLogin(unikey);
        if (status.status === "AUTHORIZED") {
          persistAuthorizedCookie(env, status.cookie);
          return `qr-status=AUTHORIZED cookie=${status.cookie}`;
        }
        return `qr-status=${status.status}`;
      }

      const payload = await api.createQrLogin();
      persistPendingQr(env, payload.unikey, payload.qrurl);
      return `unikey=${payload.unikey}\nqrurl=${payload.qrurl}`;
    }
    case "douban-sync":
      return runDoubanSync(env);
    case "run-once":
      if (flags.includes("--dry-run")) {
        const baseUrl = env.NETEASE_API_BASE_URL;
        const cookie = loadPersistedCookie(env) ?? env.NETEASE_COOKIE;
        if (baseUrl && cookie) {
          const adapters = createNeteaseLiveAdapters({
            session: {
              getCookie: () => cookie
            },
            apiClientOptions: {
              baseUrl
            }
          });
          const cursor = env.NETEASE_EVENT_CURSOR ?? "0";
          const longTermSongIds = loadLongTermSongIds(env.DB_PATH);
          const result = await runLiveDryRun({
            incrementalProvider: adapters.incrementalProvider,
            cursor,
            limit: 20,
            longTermSongIds
          });
          return `run-once dry-run completed: selectedCount=${result.selectedCount} events=${result.events} candidates=${result.candidates} nextCursor=${result.nextCursor}\ntop20SongIds=${result.songIds.join(",")}`;
        }

        const result = runOnceDryRun();
        return `run-once dry-run completed: selectedCount=${result.selectedCount}`;
      }
      return "run-once started";
    default:
      return `Unknown command: ${command}\n\n${HELP_TEXT.trim()}`;
  }
}

function readFlagValue(flags: string[], flag: string): string | null {
  const index = flags.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return flags[index + 1] ?? null;
}

function loadLongTermSongIds(dbPath: string | undefined): string[] {
  if (!dbPath || !existsSync(dbPath)) {
    return [];
  }
  const db = new DbClient(dbPath);
  db.initSchema();
  const songs = db.listDoubanBaselineSongs(1000);
  db.close();
  return songs;
}

function persistPendingQr(env: NodeJS.ProcessEnv, unikey: string, qrurl: string): void {
  const db = openDb(env.DB_PATH);
  if (!db) {
    return;
  }

  db.upsertNeteaseAuthState({
    encryptedCookie: db.getNeteaseAuthState()?.encryptedCookie ?? null,
    pendingUnikey: unikey,
    pendingQrUrl: qrurl
  });
  db.close();
}

function persistAuthorizedCookie(env: NodeJS.ProcessEnv, cookie: string): void {
  const db = openDb(env.DB_PATH);
  const masterKey = env.MASTER_KEY;
  if (!db || !masterKey) {
    db?.close();
    return;
  }

  const store = new CredentialStore(masterKey);
  const encryptedCookie = store.encrypt({ cookie });
  db.upsertNeteaseAuthState({
    encryptedCookie,
    pendingUnikey: null,
    pendingQrUrl: null
  });
  db.close();
}

function loadPersistedCookie(env: NodeJS.ProcessEnv): string | null {
  const db = openDb(env.DB_PATH);
  const masterKey = env.MASTER_KEY;
  if (!db || !masterKey) {
    db?.close();
    return null;
  }

  const state = db.getNeteaseAuthState();
  db.close();
  if (!state?.encryptedCookie) {
    return null;
  }

  const store = new CredentialStore(masterKey);
  const payload = store.decrypt<{ cookie: string }>(state.encryptedCookie);
  return payload.cookie;
}

function openDb(dbPath: string | undefined): DbClient | null {
  if (!dbPath) {
    return null;
  }

  const db = new DbClient(dbPath);
  db.initSchema();
  return db;
}

function runDoubanSync(env: NodeJS.ProcessEnv): string {
  const dbPath = env.DB_PATH;
  if (!dbPath) {
    throw new Error("DB_PATH is required for douban-sync");
  }

  const db = openDb(dbPath);
  if (!db) {
    throw new Error("failed to open database for douban-sync");
  }

  const existingCount = db.countDoubanBaselineSongs();
  if (existingCount > 0) {
    db.close();
    return `douban-sync skipped=already-imported existing=${existingCount}`;
  }

  const sourcePath = env.DOUBAN_BASELINE_PATH ?? join(process.cwd(), "data", "douban-baseline.json");
  if (!existsSync(sourcePath)) {
    db.close();
    throw new Error(`Douban baseline file not found: ${sourcePath}`);
  }

  const rows = JSON.parse(readFileSync(sourcePath, "utf8")) as unknown;
  if (!Array.isArray(rows)) {
    db.close();
    throw new Error("Douban baseline JSON must be an array");
  }

  const imported = importDoubanBaseline(rows as DoubanSongRow[], db);
  const total = db.countDoubanBaselineSongs();
  db.close();
  return `douban-sync imported=${imported} total=${total}`;
}
