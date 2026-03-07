import { runOnceDryRun, runOnceLiveDryRun } from "./jobs/run-once";
import { NeteaseApiClient } from "./providers/netease/api-client";
import { createNeteaseLiveAdapters } from "./providers/netease/live-adapters";
import { publishDailyPlaylist } from "./publish/playlist-publisher";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DbClient, type DoubanBaselineWorkRecord } from "./db/client";
import { CredentialStore } from "./security/credential-store";
import { importDoubanBaseline } from "./ingest/douban-import";
import type { DoubanSongRow } from "./ingest/douban-parser";
import type { NeteaseSongDetail } from "./providers/netease/types";
import {
  generateWorksWithAi,
  isAiRecommenderEnabled,
  resolveAiApiKey,
  resolveAiBaseUrl,
  resolveAiModel,
  resolveAiProvider,
  type AiRecommendedWork
} from "./recommendation/ai-selector";
import {
  fetchDoubanBaselineFromPublicPages,
  resolveDoubanUserId,
  writeDoubanBaselineJson
} from "./ingest/douban-public";

type NeteaseCliApi = Pick<
  NeteaseApiClient,
  | "createQrLogin"
  | "checkQrLogin"
  | "searchSongIds"
  | "getLoginProfile"
  | "getLikedSongIds"
  | "getSongsDetail"
  | "refreshCookie"
  | "fetchEvents"
  | "getPlaylistTrackIds"
  | "updatePlaylistTracks"
>;

export interface CliDeps {
  env?: NodeJS.ProcessEnv;
  createNeteaseApiClient?: (baseUrl: string) => NeteaseCliApi;
  runOnceLiveDryRun?: typeof runOnceLiveDryRun;
}

const HELP_TEXT = `
Usage: top-songs <command>

Commands:
  bootstrap-login   Start Netease QR login bootstrap
  douban-sync       Run one-time Douban baseline import
  netease-sync      Run one-time Netease baseline import
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
      return await runDoubanSync(env);
    case "netease-sync":
      return await runNeteaseSync(env, createNeteaseApiClient);
    case "run-once":
      if (flags.includes("--dry-run")) {
        const liveContext = createLiveRunContext(env, createNeteaseApiClient);
        if (liveContext) {
          const result = await executeLiveRecommendation(env, liveContext.api, runLiveDryRun);
          return `run-once dry-run completed: selectedCount=${result.selectedCount} events=${result.events} candidates=${result.candidates} nextCursor=${result.nextCursor}\ntop20SongIds=${result.songIds.join(",")}`;
        }

        const result = runOnceDryRun();
        return `run-once dry-run completed: selectedCount=${result.selectedCount}`;
      }
      return await runOnceAndPublish(env, createNeteaseApiClient, runLiveDryRun);
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

function loadLongTermWorks(dbPath: string | undefined): DoubanBaselineWorkRecord[] {
  if (!dbPath || !existsSync(dbPath)) {
    return [];
  }
  const db = new DbClient(dbPath);
  db.initSchema();
  const songs = mergeWorkRows(db.listDoubanBaselineSongs(1000), db.listNeteaseBaselineSongs(1000), 1000);
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

function createLiveRunContext(
  env: NodeJS.ProcessEnv,
  createNeteaseApiClient: (baseUrl: string) => NeteaseCliApi
): { api: NeteaseCliApi; cookie: string } | null {
  const baseUrl = env.NETEASE_API_BASE_URL;
  const cookie = loadPersistedCookie(env) ?? env.NETEASE_COOKIE;
  if (!baseUrl || !cookie) {
    return null;
  }

  return {
    api: createNeteaseApiClient(baseUrl),
    cookie
  };
}

async function executeLiveRecommendation(
  env: NodeJS.ProcessEnv,
  api: NeteaseCliApi,
  runLiveDryRun: typeof runOnceLiveDryRun
) {
  const cookie = loadPersistedCookie(env) ?? env.NETEASE_COOKIE;
  if (!cookie) {
    throw new Error("Netease cookie is required for live run");
  }

  const adapters = createNeteaseLiveAdapters({
    session: {
      getCookie: () => cookie
    },
    api
  });
  const cursor = env.NETEASE_EVENT_CURSOR ?? "0";
  const longTermWorks = loadLongTermWorks(env.DB_PATH);
  const longTermSongIds = longTermWorks
    .map((work) => work.preferredSongId ?? null)
    .filter((songId): songId is string => Boolean(songId));

  const aiEnabled = isAiRecommenderEnabled(env);
  const baseResult = await runLiveDryRun({
    incrementalProvider: adapters.incrementalProvider,
    cursor,
    limit: aiEnabled ? 100 : 20,
    longTermSongIds
  });

  if (!aiEnabled || baseResult.songIds.length === 0) {
    return {
      ...baseResult,
      songIds: baseResult.songIds.slice(0, 20),
      selectedCount: Math.min(baseResult.songIds.length, 20)
    };
  }

  const selectedByAi = await tryGenerateByAi(env, api, {
    candidateSongIds: baseResult.songIds,
    longTermWorks
  });
  return {
    ...baseResult,
    songIds: selectedByAi,
    selectedCount: selectedByAi.length
  };
}

async function runOnceAndPublish(
  env: NodeJS.ProcessEnv,
  createNeteaseApiClient: (baseUrl: string) => NeteaseCliApi,
  runLiveDryRun: typeof runOnceLiveDryRun
): Promise<string> {
  const liveContext = createLiveRunContext(env, createNeteaseApiClient);
  if (!liveContext) {
    throw new Error("NETEASE_API_BASE_URL and valid Netease cookie are required for run-once");
  }

  const playlistId = env.NETEASE_PLAYLIST_ID;
  if (!playlistId) {
    throw new Error("NETEASE_PLAYLIST_ID is required for run-once");
  }

  const result = await executeLiveRecommendation(env, liveContext.api, runLiveDryRun);
  const adapters = createNeteaseLiveAdapters({
    session: {
      getCookie: () => liveContext.cookie
    },
    api: liveContext.api
  });

  await publishDailyPlaylist(playlistId, result.songIds, adapters.playlistProvider);
  persistRecommendationRun(env.DB_PATH, result.songIds);

  return `run-once published: selectedCount=${result.selectedCount} playlistId=${playlistId}\ntop20SongIds=${result.songIds.join(",")}`;
}

function persistRecommendationRun(dbPath: string | undefined, songIds: string[]): void {
  if (!dbPath) {
    return;
  }

  const db = openDb(dbPath);
  if (!db) {
    return;
  }

  const runDate = new Date().toISOString().slice(0, 10);
  db.deleteRecommendationRunByDate(runDate);

  const run = db.createRecommendationRun({
    runDate,
    selectedCount: songIds.length
  });

  for (const songId of songIds) {
    db.insertRecommendationRunSong({
      runId: run.id,
      songId
    });
  }

  db.close();
}

async function runDoubanSync(env: NodeJS.ProcessEnv): Promise<string> {
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
  let rows: DoubanSongRow[];

  if (existsSync(sourcePath)) {
    const parsed = JSON.parse(readFileSync(sourcePath, "utf8")) as unknown;
    if (!Array.isArray(parsed)) {
      db.close();
      throw new Error("Douban baseline JSON must be an array");
    }
    rows = parsed as DoubanSongRow[];
  } else {
    const userId = resolveDoubanUserId(env);
    if (!userId) {
      db.close();
      throw new Error(`Douban baseline file not found: ${sourcePath}`);
    }

    rows = await fetchDoubanBaselineFromPublicPages({ userId });
    writeDoubanBaselineJson(rows, process.cwd());
  }

  const imported = importDoubanBaseline(rows, db);
  const total = db.countDoubanBaselineSongs();
  db.close();
  return `douban-sync imported=${imported} total=${total}`;
}

async function runNeteaseSync(
  env: NodeJS.ProcessEnv,
  createNeteaseApiClient: (baseUrl: string) => NeteaseCliApi
): Promise<string> {
  const dbPath = env.DB_PATH;
  if (!dbPath) {
    throw new Error("DB_PATH is required for netease-sync");
  }

  const baseUrl = env.NETEASE_API_BASE_URL;
  if (!baseUrl) {
    throw new Error("NETEASE_API_BASE_URL is required for netease-sync");
  }

  const cookie = loadPersistedCookie(env) ?? env.NETEASE_COOKIE;
  if (!cookie) {
    throw new Error("Netease cookie is required for netease-sync");
  }

  const db = openDb(dbPath);
  if (!db) {
    throw new Error("failed to open database for netease-sync");
  }

  const existingCount = db.countNeteaseBaselineSongs();
  const missingPreferredSongIdCount = db.countNeteaseBaselineSongsWithoutPreferredSongId();
  if (existingCount > 0 && missingPreferredSongIdCount === 0) {
    db.close();
    return `netease-sync skipped=already-imported existing=${existingCount}`;
  }

  const api = createNeteaseApiClient(baseUrl);
  const profile = await api.getLoginProfile(cookie);
  if (!profile.userId) {
    db.close();
    throw new Error("netease-sync could not resolve current user id");
  }

  const likedSongIds = await api.getLikedSongIds(profile.userId, cookie);
  const details = await fetchNeteaseSongDetails(api, likedSongIds, cookie);
  for (const detail of details) {
    db.upsertNeteaseBaselineSong({
      title: detail.title,
      artist: detail.artist,
      preferredSongId: detail.songId,
      tags: ["netease:liked"]
    });
  }

  const total = db.countNeteaseBaselineSongs();
  db.close();
  return `netease-sync imported=${details.length} total=${total} backfilled=${missingPreferredSongIdCount}`;
}

async function fetchNeteaseSongDetails(api: NeteaseCliApi, songIds: string[], cookie: string): Promise<NeteaseSongDetail[]> {
  const deduped = Array.from(new Set(songIds));
  const details: NeteaseSongDetail[] = [];
  const batchSize = 20;

  for (let index = 0; index < deduped.length; index += batchSize) {
    const batch = deduped.slice(index, index + batchSize);
    details.push(...(await api.getSongsDetail(batch, cookie)));
  }

  return details;
}

async function tryGenerateByAi(
  env: NodeJS.ProcessEnv,
  api: NeteaseCliApi,
  input: {
    candidateSongIds: string[];
    longTermWorks: DoubanBaselineWorkRecord[];
  }
): Promise<string[]> {
  const apiKey = resolveAiApiKey(env);
  if (!apiKey) {
    return input.candidateSongIds.slice(0, 20);
  }

  const cookie = loadPersistedCookie(env) ?? env.NETEASE_COOKIE;
  if (!cookie) {
    return input.candidateSongIds.slice(0, 20);
  }

  const provider = resolveAiProvider(env);
  const model = resolveAiModel(env);
  const baseUrl = resolveAiBaseUrl(env);

  try {
    const exclusionSongIds = Array.from(
      new Set(
        [
          ...input.candidateSongIds,
          ...input.longTermWorks
            .map((item) => item.preferredSongId ?? null)
            .filter((songId): songId is string => Boolean(songId))
        ]
      )
    );
    const exclusionDetails = await fetchNeteaseSongDetails(api, exclusionSongIds, cookie);
    const excludedWorks = [
      ...exclusionDetails.map((item) => ({ title: item.title, artist: item.artist })),
      ...input.longTermWorks.map((item) => ({ title: item.title, artist: item.artist }))
    ];
    const recentHints = exclusionDetails.slice(0, 30).map((item) => `${item.title} - ${item.artist}`);
    const longTermHints = input.longTermWorks.slice(0, 60).map((item) => `${item.title} - ${item.artist}`);
    const preferenceTags = Array.from(
      new Set(
        input.longTermWorks
          .flatMap((item) => item.tags)
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0 && !tag.startsWith("douban:") && !tag.startsWith("netease:"))
      )
    );

    const generatedWorks = await generateWorksWithAi({
      provider,
      apiKey,
      model,
      baseUrl,
      limit: 40,
      recentHints,
      longTermHints,
      preferenceTags,
      excludedWorks
    });

    const resolvedSongIds = await resolveGeneratedWorksToSongIds(api, generatedWorks, excludedWorks);
    if (resolvedSongIds.length > 0) {
      return resolvedSongIds.slice(0, 20);
    }

    return input.candidateSongIds.slice(0, 20);
  } catch {
    return input.candidateSongIds.slice(0, 20);
  }
}

async function resolveGeneratedWorksToSongIds(
  api: NeteaseCliApi,
  works: AiRecommendedWork[],
  excludedWorks: Array<{ title: string; artist: string }>
): Promise<string[]> {
  const maxAttempts = 24;
  const concurrency = 6;
  const excluded = new Set(excludedWorks.map((item) => normalizeWorkKey(item.title, item.artist)));
  const filteredWorks = works
    .filter((work) => !excluded.has(normalizeWorkKey(work.title, work.artist)))
    .slice(0, maxAttempts);

  const withIndex = filteredWorks.map((work, index) => ({ work, index }));
  const searchResults = await mapWithConcurrency(withIndex, concurrency, async ({ work, index }) => {
    try {
      const matches = await api.searchSongIds(`${work.title} ${work.artist}`, 5);
      return { index, songId: matches[0] ?? null };
    } catch {
      return { index, songId: null };
    }
  });

  const seenSongIds = new Set<string>();
  const resolved: string[] = [];
  for (const item of searchResults.sort((a, b) => a.index - b.index)) {
    if (!item.songId || seenSongIds.has(item.songId)) {
      continue;
    }
    seenSongIds.add(item.songId);
    resolved.push(item.songId);
    if (resolved.length >= 20) {
      break;
    }
  }

  return resolved;
}

function normalizeWorkKey(title: string, artist: string): string {
  return `${title}\n${artist}`.trim().toLowerCase();
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput) => Promise<TOutput>
): Promise<TOutput[]> {
  if (items.length === 0) {
    return [];
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, async (_, workerIndex) => {
    const outputs: TOutput[] = [];
    for (let index = workerIndex; index < items.length; index += Math.max(1, concurrency)) {
      outputs.push(await mapper(items[index]));
    }
    return outputs;
  });

  const chunks = await Promise.all(workers);
  return chunks.flat();
}

function mergeWorkRows(...args: [...rows: DoubanBaselineWorkRecord[][], limit: number]): DoubanBaselineWorkRecord[] {
  const limit = args[args.length - 1] as number;
  const groups = args.slice(0, -1) as DoubanBaselineWorkRecord[][];
  const merged: DoubanBaselineWorkRecord[] = [];
  const seen = new Set<string>();

  for (const rows of groups) {
    for (const row of rows) {
      const key = `${row.artist}\n${row.title}`.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(row);
      if (merged.length >= limit) {
        return merged;
      }
    }
  }

  return merged;
}
