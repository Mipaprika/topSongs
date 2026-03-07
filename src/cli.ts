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
import { createNotifierFromEnv } from "./notify/notifier";
import { createRunLogger, pruneRunLogs, type RunLogger } from "./ops/run-logger";

type NeteaseCliApi = Pick<
  NeteaseApiClient,
  | "createQrLogin"
  | "checkQrLogin"
  | "searchSongIds"
  | "searchSongs"
  | "getSongCommentCount"
  | "getLoginProfile"
  | "getLikedSongIds"
  | "getSongsDetail"
  | "refreshCookie"
  | "fetchEvents"
  | "getPlaylistTrackIds"
  | "updatePlaylistTracks"
  | "updatePlaylistDescription"
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
          return "qr-status=AUTHORIZED cookie-stored=true";
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
          const logger = createRunLogger(env);
          const result = await executeLiveRecommendation(env, liveContext.api, runLiveDryRun, {
            getCookie: () => liveContext.cookie
          }, logger);
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

function loadBaselineProfile(dbPath: string | undefined): {
  longTermSongWorks: DoubanBaselineWorkRecord[];
  longTermAlbumWorks: DoubanBaselineWorkRecord[];
} {
  if (!dbPath || !existsSync(dbPath)) {
    return {
      longTermSongWorks: [],
      longTermAlbumWorks: []
    };
  }
  const db = new DbClient(dbPath);
  db.initSchema();
  const longTermSongWorks = db.listNeteaseBaselineSongs(1000);
  const longTermAlbumWorks = db.listDoubanBaselineSongs(1000);
  db.close();
  return {
    longTermSongWorks,
    longTermAlbumWorks
  };
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

function resolveEventCursor(env: NodeJS.ProcessEnv): string {
  const db = openDb(env.DB_PATH);
  if (db) {
    const cursorInDb = db.getRuntimeState("netease_event_cursor");
    db.close();
    if (cursorInDb && cursorInDb.trim().length > 0) {
      return cursorInDb.trim();
    }
  }
  return (env.NETEASE_EVENT_CURSOR ?? "0").trim() || "0";
}

function persistEventCursor(dbPath: string | undefined, nextCursor: string): void {
  if (!dbPath || !nextCursor.trim()) {
    return;
  }
  const db = openDb(dbPath);
  if (!db) {
    return;
  }
  db.upsertRuntimeState("netease_event_cursor", nextCursor.trim());
  db.close();
}

async function executeLiveRecommendation(
  env: NodeJS.ProcessEnv,
  api: NeteaseCliApi,
  runLiveDryRun: typeof runOnceLiveDryRun,
  session: { getCookie(): string; setCookie?(cookie: string): void },
  logger: RunLogger
) {
  if (!session.getCookie()) {
    throw new Error("Netease cookie is required for live run");
  }

  const adapters = createNeteaseLiveAdapters({
    session,
    api
  });
  const cursor = resolveEventCursor(env);
  const fetchMaxPages = Number(env.NETEASE_EVENT_FETCH_MAX_PAGES ?? "5");
  const fetchMaxEvents = Number(env.NETEASE_EVENT_FETCH_MAX_EVENTS ?? "500");
  const hintSeed = reserveHintSeed(env.DB_PATH);
  const baselineProfile = loadBaselineProfile(env.DB_PATH);
  const longTermSongIds = baselineProfile.longTermSongWorks
    .map((work) => work.preferredSongId ?? null)
    .filter((songId): songId is string => Boolean(songId));

  const aiEnabled = isAiRecommenderEnabled(env);
  const baseResult = await runLiveDryRun({
    incrementalProvider: adapters.incrementalProvider,
    cursor,
    maxPages: Number.isFinite(fetchMaxPages) ? fetchMaxPages : 5,
    maxEvents: Number.isFinite(fetchMaxEvents) ? fetchMaxEvents : 500,
    limit: aiEnabled ? 100 : 20,
    longTermSongIds
  });
  logger.log("INFO", "candidates.ready", {
    aiEnabled,
    cursor,
    baseCandidates: baseResult.songIds.length,
    events: baseResult.events
  });

  if (!aiEnabled || baseResult.songIds.length === 0) {
    logger.log("INFO", "recommendation.rule_based", {
      selectedCount: Math.min(baseResult.songIds.length, 20)
    });
    return {
      ...baseResult,
      songIds: baseResult.songIds.slice(0, 20),
      selectedCount: Math.min(baseResult.songIds.length, 20),
      playlistDescription: undefined,
      reasonBySongId: {} as Record<string, string>
    };
  }

  const selectedByAi = await tryGenerateByAi(env, api, {
    candidateSongIds: baseResult.songIds,
    recentLikedSongIds: fillRecentLikedSongIds(env.DB_PATH, baseResult.recentLikedSongIds, 30),
    longTermSongWorks: baselineProfile.longTermSongWorks,
    longTermAlbumWorks: baselineProfile.longTermAlbumWorks,
    hintSeed,
    cookie: session.getCookie(),
    logger
  });
  logger.log("INFO", "recommendation.ai", {
    selectedCount: selectedByAi.songIds.length
  });
  return {
    ...baseResult,
    songIds: selectedByAi.songIds,
    selectedCount: selectedByAi.songIds.length,
    playlistDescription: selectedByAi.playlistDescription,
    reasonBySongId: selectedByAi.reasonBySongId
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
  const notifier = createNotifierFromEnv(env);
  pruneRunLogs(env);
  const logger = createRunLogger(env);

  const playlistId = env.NETEASE_PLAYLIST_ID;
  if (!playlistId) {
    throw new Error("NETEASE_PLAYLIST_ID is required for run-once");
  }

  let sessionCookie = liveContext.cookie;
  const session = {
    getCookie: () => sessionCookie,
    setCookie: (nextCookie: string) => {
      sessionCookie = nextCookie;
      persistAuthorizedCookie(env, nextCookie);
    }
  };

  const adapters = createNeteaseLiveAdapters({
    session,
    api: liveContext.api
  });

  try {
    logger.log("INFO", "run.start", { playlistId });
    const auth = await adapters.authClient.refresh(session.getCookie());
    if (!auth.ok) {
      const qr = await adapters.authClient.createQrLogin();
      persistPendingQr(env, qr.unikey, qr.qrurl);
      await notifier.sendReloginRequired({
        unikey: qr.unikey,
        qrurl: qr.qrurl,
        qrimg: qr.qrimg
      });
      logger.log("WARN", "auth.expired", { reason: auth.reason, unikey: qr.unikey });
      throw new Error("AUTH_EXPIRED: cookie invalid, relogin QR has been generated and notified.");
    }
    logger.log("INFO", "auth.refresh_ok");

    const result = await executeLiveRecommendation(env, liveContext.api, runLiveDryRun, session, logger);

    await publishDailyPlaylist(playlistId, result.songIds, adapters.playlistProvider, result.playlistDescription);
    persistRecommendationRun(env.DB_PATH, result.songIds);
    persistEventCursor(env.DB_PATH, result.nextCursor);

    if (result.selectedCount < 20) {
      await notifier.sendJobWarning?.(`实际入歌单 ${result.selectedCount} 首，低于目标 20 首。`);
      logger.log("WARN", "publish.low_count", { selectedCount: result.selectedCount });
    }
    try {
      const successMessage = await buildSuccessNotificationMessage(
        liveContext.api,
        session.getCookie(),
        result.songIds,
        result.reasonBySongId
      );
      await notifier.sendJobSuccess?.(successMessage);
    } catch (notifyError) {
      const notifyMessage = notifyError instanceof Error ? notifyError.message : String(notifyError);
      await notifier.sendJobWarning?.(`成功通知发送失败：${notifyMessage}`);
      logger.log("WARN", "notify.success_failed", { message: notifyMessage });
    }
    logger.log("INFO", "run.success", { selectedCount: result.selectedCount, playlistId });

    return `run-once published: selectedCount=${result.selectedCount} playlistId=${playlistId}\ntop20SongIds=${result.songIds.join(",")}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.log("ERROR", "run.failed", { message });
    if (!message.startsWith("AUTH_EXPIRED")) {
      await notifier.sendJobFailure?.(message);
    }
    throw error;
  }
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
    recentLikedSongIds: string[];
    longTermSongWorks: DoubanBaselineWorkRecord[];
    longTermAlbumWorks: DoubanBaselineWorkRecord[];
    hintSeed: number;
    cookie: string;
    logger: RunLogger;
  }
): Promise<{ songIds: string[]; playlistDescription?: string; reasonBySongId: Record<string, string> }> {
  const targetCount = 20;
  const apiKey = resolveAiApiKey(env);
  if (!apiKey) {
    return { songIds: input.candidateSongIds.slice(0, targetCount), reasonBySongId: {} };
  }

  const cookie = input.cookie;
  if (!cookie) {
    return { songIds: input.candidateSongIds.slice(0, targetCount), reasonBySongId: {} };
  }

  const provider = resolveAiProvider(env);
  const model = resolveAiModel(env);
  const baseUrl = resolveAiBaseUrl(env);
  const timeoutMs = Number(env.AI_REQUEST_TIMEOUT_MS ?? "45000");
  const retryCount = Number(env.AI_REQUEST_RETRY_COUNT ?? "2");

  try {
    const startedAt = Date.now();
    const recentLikeSongIds = input.recentLikedSongIds.slice(0, 30);
    const recentLikeDetails = await fetchNeteaseSongDetails(api, recentLikeSongIds, cookie);
    const detailBySongId = new Map(recentLikeDetails.map((item) => [item.songId, item] as const));
    const excludedWorks = dedupeWorks([
      ...input.longTermSongWorks.map((item) => ({ title: item.title, artist: item.artist })),
      ...recentLikeDetails.map((item) => ({ title: item.title, artist: item.artist }))
    ]);
    const recentHints = input.recentLikedSongIds
      .slice(0, 30)
      .map((songId) => detailBySongId.get(songId))
      .filter((item): item is NeteaseSongDetail => Boolean(item))
      .map((item) => `${item.title} - ${item.artist}`);
    const longTermSongHints = buildRotatingTasteHints(input.longTermSongWorks, 40, input.hintSeed);
    const longTermAlbumHints = buildRotatingTasteHints(input.longTermAlbumWorks, 20, input.hintSeed + 7919);
    const preferenceTags = Array.from(
      new Set(
        [...input.longTermSongWorks, ...input.longTermAlbumWorks]
          .flatMap((item) => item.tags)
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0 && !tag.startsWith("douban:") && !tag.startsWith("netease:"))
      )
    );

    for (const generationLimit of [40, 80, 120]) {
      const generatedWorks = await generateWorksWithAi({
        provider,
        apiKey,
        model,
        baseUrl,
        limit: generationLimit,
        recentHints,
        longTermSongHints,
        longTermAlbumHints,
        preferenceTags,
        excludedWorks,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 45_000,
        retryCount: Number.isFinite(retryCount) ? retryCount : 2
      });
      console.error(
        `[ai] generation succeeded in ${Date.now() - startedAt}ms, works=${generatedWorks.length}, limit=${generationLimit}`
      );
      input.logger.log("INFO", "ai.generation", {
        durationMs: Date.now() - startedAt,
        works: generatedWorks.length,
        limit: generationLimit
      });

      const resolution = await resolveGeneratedWorksToSongIds(api, generatedWorks, excludedWorks, targetCount);
      if (resolution.resolved.length > 0) {
        const resolvedSongIds = resolution.resolved.map((item) => item.songId);
        const finalSongIds = mergeWithFallbackCandidates(resolvedSongIds, input.candidateSongIds, targetCount);
        if (finalSongIds.length < targetCount) {
          console.error(`[ai] fallback candidate pool不足: final=${finalSongIds.length}, target=${targetCount}`);
          input.logger.log("WARN", "ai.fill_from_pool", {
            final: finalSongIds.length,
            target: targetCount
          });
        }
        const reasonBySongId = buildReasonBySongId(finalSongIds, resolution.resolved);
        return {
          songIds: finalSongIds,
          playlistDescription: buildPlaylistDescription(resolution.resolved.slice(0, targetCount)),
          reasonBySongId
        };
      }

      console.error(
        `[ai] resolvedSongIds is empty at limit=${generationLimit}, failureSummary=${JSON.stringify(resolution.failureSummary)}`
      );
      input.logger.log("WARN", "ai.resolve_empty", {
        limit: generationLimit,
        failureSummary: resolution.failureSummary
      });
    }
    console.error("[ai] resolvedSongIds is empty, fallback to candidate pool");
    input.logger.log("WARN", "ai.total_empty");
    return { songIds: input.candidateSongIds.slice(0, targetCount), reasonBySongId: {} };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[ai] generation failed, fallback to candidate pool: ${message}; timeoutMs=${Number.isFinite(timeoutMs) ? timeoutMs : 45_000}; retryCount=${Number.isFinite(retryCount) ? retryCount : 2}`
    );
    input.logger.log("ERROR", "ai.failed", {
      message,
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 45_000,
      retryCount: Number.isFinite(retryCount) ? retryCount : 2
    });
    return { songIds: input.candidateSongIds.slice(0, targetCount), reasonBySongId: {} };
  }
}

function buildReasonBySongId(
  finalSongIds: string[],
  resolved: Array<{ songId: string; title: string; artist: string; reason?: string }>
): Record<string, string> {
  const reasonMap = new Map<string, string>();
  for (const item of resolved) {
    const normalized = (item.reason ?? "").replace(/\s+/g, " ").trim();
    if (normalized) {
      reasonMap.set(item.songId, normalized);
    }
  }
  const output: Record<string, string> = {};
  for (const songId of finalSongIds) {
    output[songId] = reasonMap.get(songId) ?? "这首和你最近循环的风格很对味，想让你今天也听到一点新鲜感。";
  }
  return output;
}

async function buildSuccessNotificationMessage(
  api: NeteaseCliApi,
  cookie: string,
  songIds: string[],
  reasonBySongId: Record<string, string>
): Promise<string> {
  const date = new Date().toISOString().slice(0, 10);
  const songs = await fetchNeteaseSongDetails(api, songIds, cookie);
  const detailById = new Map(songs.map((item) => [item.songId, item] as const));
  const lines = [`今天的 20 首推荐已更新（${date}）`, "歌单已替换好，给你整理成清单："];
  for (let i = 0; i < songIds.length; i += 1) {
    const songId = songIds[i];
    const detail = detailById.get(songId);
    const title = detail?.title ?? songId;
    const artist = detail?.artist ?? "未知歌手";
    const reason = (reasonBySongId[songId] ?? "这首和你最近循环的风格很对味，想让你今天也听到一点新鲜感。")
      .replace(/\s+/g, " ")
      .trim();
    lines.push(`${i + 1}. ${title} - ${artist}`);
    lines.push(reason);
    lines.push("");
  }
  lines.push("希望你今天能刷到几首想立刻红心的。");
  return lines.join("\n");
}

async function resolveGeneratedWorksToSongIds(
  api: NeteaseCliApi,
  works: AiRecommendedWork[],
  excludedWorks: Array<{ title: string; artist: string }>,
  targetCount: number
): Promise<{
  resolved: Array<{ songId: string; title: string; artist: string; reason?: string }>;
  failureSummary: Partial<
    Record<"NO_SEARCH_RESULT" | "NO_EXACT_MATCH" | "NO_RELAXED_MATCH" | "DUPLICATE_SONG_ID", number>
  >;
}> {
  const maxAttempts = 120;
  const batchSize = 40;
  const concurrency = 4;
  const excluded = new Set(excludedWorks.map((item) => normalizeWorkKey(item.title, item.artist)));
  const filteredWorks = works
    .filter((work) => !excluded.has(normalizeWorkKey(work.title, work.artist)))
    .slice(0, maxAttempts);
  const commentCountCache = new Map<string, number>();
  const failureSummary: Partial<
    Record<"NO_SEARCH_RESULT" | "NO_EXACT_MATCH" | "NO_RELAXED_MATCH" | "DUPLICATE_SONG_ID", number>
  > = {};

  const seenSongIds = new Set<string>();
  const resolved: Array<{ songId: string; title: string; artist: string; reason?: string }> = [];

  for (let start = 0; start < filteredWorks.length; start += batchSize) {
    if (resolved.length >= targetCount) {
      break;
    }

    const batch = filteredWorks.slice(start, start + batchSize);
    const withIndex = batch.map((work, offset) => ({ work, index: start + offset }));
    const searchResults = await mapWithConcurrency(withIndex, concurrency, async ({ work, index }) => {
      try {
        const matches = await api.searchSongs(`${work.title} ${work.artist}`, 5);
        if (matches.length === 0) {
          return { index, song: null, failureReason: "NO_SEARCH_RESULT" as const };
        }

        const exactMatches = matches.filter((candidate) => isExactWorkMatch(work, candidate));
        if (exactMatches.length > 0) {
          const picked = await pickByMostComments(api, exactMatches, commentCountCache);
          return {
            index,
            song: picked
              ? {
                  songId: picked.songId,
                  title: work.title,
                  artist: work.artist,
                  reason: work.reason
                }
              : null,
            failureReason: picked ? null : ("NO_EXACT_MATCH" as const)
          };
        }

        const relaxedMatches = matches.filter((candidate) => isRelaxedWorkMatch(work, candidate));
        if (relaxedMatches.length === 0) {
          return { index, song: null, failureReason: "NO_RELAXED_MATCH" as const };
        }
        const picked = await pickByMostComments(api, relaxedMatches, commentCountCache);
        return {
          index,
          song: picked
            ? {
                songId: picked.songId,
                title: work.title,
                artist: work.artist,
                reason: work.reason
              }
            : null,
          failureReason: picked ? null : ("NO_RELAXED_MATCH" as const)
        };
      } catch {
        return { index, song: null, failureReason: "NO_SEARCH_RESULT" as const };
      }
    });

    for (const item of searchResults.sort((a, b) => a.index - b.index)) {
      if (!item.song) {
        if (item.failureReason) {
          failureSummary[item.failureReason] = (failureSummary[item.failureReason] ?? 0) + 1;
        }
        continue;
      }
      if (seenSongIds.has(item.song.songId)) {
        failureSummary.DUPLICATE_SONG_ID = (failureSummary.DUPLICATE_SONG_ID ?? 0) + 1;
        continue;
      }
      seenSongIds.add(item.song.songId);
      resolved.push(item.song);
      if (resolved.length >= targetCount) {
        break;
      }
    }
  }

  return {
    resolved,
    failureSummary
  };
}

function mergeWithFallbackCandidates(primarySongIds: string[], candidateSongIds: string[], limit: number): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const songId of [...primarySongIds, ...candidateSongIds]) {
    if (!songId || seen.has(songId)) {
      continue;
    }
    seen.add(songId);
    merged.push(songId);
    if (merged.length >= limit) {
      break;
    }
  }
  return merged;
}

function normalizeWorkKey(title: string, artist: string): string {
  return `${title}\n${artist}`.trim().toLowerCase();
}

function dedupeWorks(works: Array<{ title: string; artist: string }>): Array<{ title: string; artist: string }> {
  const seen = new Set<string>();
  const result: Array<{ title: string; artist: string }> = [];
  for (const work of works) {
    const key = normalizeWorkKey(work.title, work.artist);
    if (!work.title.trim() || !work.artist.trim() || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(work);
  }
  return result;
}

async function pickByMostComments(
  api: NeteaseCliApi,
  matches: NeteaseSongDetail[],
  cache: Map<string, number>
): Promise<NeteaseSongDetail | null> {
  let best: NeteaseSongDetail | null = null;
  let bestCount = -1;
  for (const match of matches) {
    const count = await loadCommentCount(api, match.songId, cache);
    if (count > bestCount) {
      best = match;
      bestCount = count;
    }
  }
  return best;
}

async function loadCommentCount(api: NeteaseCliApi, songId: string, cache: Map<string, number>): Promise<number> {
  const cached = cache.get(songId);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const count = await api.getSongCommentCount(songId);
    cache.set(songId, count);
    return count;
  } catch {
    cache.set(songId, 0);
    return 0;
  }
}

function isExactWorkMatch(work: AiRecommendedWork, candidate: NeteaseSongDetail): boolean {
  const titleExact = normalizeComparableText(work.title) === normalizeComparableText(candidate.title);
  if (!titleExact) {
    return false;
  }

  const workArtists = splitArtists(work.artist);
  const candidateArtists = splitArtists(candidate.artist);
  return workArtists.some((workArtist) =>
    candidateArtists.some(
      (candidateArtist) =>
        workArtist === candidateArtist || workArtist.includes(candidateArtist) || candidateArtist.includes(workArtist)
    )
  );
}

function isRelaxedWorkMatch(work: AiRecommendedWork, candidate: NeteaseSongDetail): boolean {
  const workTitle = normalizeComparableText(work.title);
  const candidateTitle = normalizeComparableText(candidate.title);
  const titleMatch =
    workTitle === candidateTitle || workTitle.includes(candidateTitle) || candidateTitle.includes(workTitle);
  if (!titleMatch) {
    return false;
  }

  const workArtists = splitArtists(work.artist);
  const candidateArtists = splitArtists(candidate.artist);
  return workArtists.some((workArtist) =>
    candidateArtists.some(
      (candidateArtist) => workArtist.includes(candidateArtist) || candidateArtist.includes(workArtist)
    )
  );
}

function splitArtists(value: string): string[] {
  return value
    .split(/[,&/、，;；]+/g)
    .map((item) => normalizeComparableText(item))
    .filter((item) => item.length > 0);
}

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s'"`’‘"“”·\-_.:：()（）[\]【】]+/g, "")
    .trim();
}

function buildPlaylistDescription(
  songs: Array<{ title: string; artist: string; reason?: string }>,
  maxLength = 980
): string {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [`每日AI推荐 ${date}`];
  for (let index = 0; index < songs.length; index += 1) {
    const song = songs[index];
    const title = song.title;
    const reason = (song.reason ?? "风格贴合你近期口味").replace(/\s+/g, " ").trim();
    const nextLine = `${index + 1}. ${title}：${reason}`;
    const next = `${lines.join("\n")}\n${nextLine}`;
    if (next.length > maxLength) {
      break;
    }
    lines.push(nextLine);
  }
  return lines.join("\n");
}

function fillRecentLikedSongIds(dbPath: string | undefined, recentSongIds: string[], limit: number): string[] {
  const seen = new Set(recentSongIds);
  const filled = recentSongIds.slice(0, limit);
  if (!dbPath || filled.length >= limit) {
    return filled;
  }

  const db = openDb(dbPath);
  if (!db) {
    return filled;
  }

  const history = db.listRecentLikedSongIds(Math.max(limit * 5, 200));
  db.close();
  for (const songId of history) {
    if (seen.has(songId)) {
      continue;
    }
    seen.add(songId);
    filled.push(songId);
    if (filled.length >= limit) {
      break;
    }
  }

  return filled;
}

function reserveHintSeed(dbPath: string | undefined): number {
  if (!dbPath) {
    return Date.now();
  }
  const db = openDb(dbPath);
  if (!db) {
    return Date.now();
  }
  const current = Number(db.getRuntimeState("ai_hint_seed") ?? "0");
  const next = Number.isFinite(current) ? current + 1 : 1;
  db.upsertRuntimeState("ai_hint_seed", String(next));
  db.close();
  return next;
}

function buildRotatingTasteHints(works: DoubanBaselineWorkRecord[], limit: number, seed: number): string[] {
  if (works.length <= limit) {
    return works.map((item) => `${item.title} - ${item.artist}`);
  }

  const start = Math.abs(seed) % works.length;
  const step = Math.max(1, Math.floor(works.length / limit));
  const picked: string[] = [];
  const seen = new Set<string>();

  for (let offset = 0; offset < works.length && picked.length < limit; offset += step) {
    const idx = (start + offset) % works.length;
    const work = works[idx];
    const key = normalizeWorkKey(work.title, work.artist);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    picked.push(`${work.title} - ${work.artist}`);
  }

  if (picked.length >= limit) {
    return picked.slice(0, limit);
  }

  for (let offset = 0; offset < works.length && picked.length < limit; offset += 1) {
    const idx = (start + offset) % works.length;
    const work = works[idx];
    const key = normalizeWorkKey(work.title, work.artist);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    picked.push(`${work.title} - ${work.artist}`);
  }

  return picked;
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
