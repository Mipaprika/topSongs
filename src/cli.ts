import { runOnceDryRun, runOnceLiveDryRun } from "./jobs/run-once";
import { NeteaseApiClient } from "./providers/netease/api-client";
import { createNeteaseLiveAdapters } from "./providers/netease/live-adapters";
import { existsSync } from "node:fs";
import { DbClient } from "./db/client";

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
          return `qr-status=AUTHORIZED cookie=${status.cookie}`;
        }
        return `qr-status=${status.status}`;
      }

      const payload = await api.createQrLogin();
      return `unikey=${payload.unikey}\nqrurl=${payload.qrurl}`;
    }
    case "douban-sync":
      return "douban-sync started";
    case "run-once":
      if (flags.includes("--dry-run")) {
        const baseUrl = env.NETEASE_API_BASE_URL;
        const cookie = env.NETEASE_COOKIE;
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
