# Daily AI Playlist Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a secure daily job that ingests Netease incremental behavior, blends it with one-time Douban baseline, recommends 20 songs, and replaces tracks in one fixed Netease playlist.

**Architecture:** Build a TypeScript service with modular adapters (`auth`, `ingest`, `recommender`, `publisher`) and SQLite persistence. Keep Netease API integration behind one provider interface so auth and endpoint instability can be isolated. Run daily with a scheduler and expose bootstrap commands for QR login and one-time Douban import.

**Tech Stack:** Node.js, TypeScript, Vitest, SQLite, Prisma (or better-sqlite3 + SQL migrations), node-cron, pino.

---

### Task 1: Scaffold Project and Test Harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `src/index.ts`
- Create: `src/config.ts`
- Test: `tests/config.spec.ts`

**Skill refs:** `@test-driven-development`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("throws when MASTER_KEY is missing", () => {
    expect(() =>
      loadConfig({
        MASTER_KEY: "",
      } as NodeJS.ProcessEnv),
    ).toThrow(/MASTER_KEY/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/config.spec.ts`
Expected: FAIL with missing `loadConfig`.

**Step 3: Write minimal implementation**

```ts
export function loadConfig(env: NodeJS.ProcessEnv) {
  if (!env.MASTER_KEY) throw new Error("MASTER_KEY is required");
  return { masterKey: env.MASTER_KEY };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/config.spec.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .env.example src/config.ts src/index.ts tests/config.spec.ts
git commit -m "chore: scaffold service with config validation and tests"
```

### Task 2: Create Persistence Schema and Migration

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/db/client.ts`
- Test: `tests/db-schema.spec.ts`

**Skill refs:** `@test-driven-development`

**Step 1: Write the failing test**

```ts
it("stores recommendation run and song rows", async () => {
  const db = await createTestDb();
  const run = await db.recommendationRun.create({
    data: { runDate: "2026-03-05", selectedCount: 20 },
  });
  expect(run.selectedCount).toBe(20);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/db-schema.spec.ts`
Expected: FAIL because tables/models do not exist.

**Step 3: Write minimal implementation**

```prisma
model RecommendationRun {
  id            String   @id @default(cuid())
  runDate        String   @unique
  selectedCount  Int
  createdAt      DateTime @default(now())
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/db-schema.spec.ts`
Expected: PASS after migration.

**Step 5: Commit**

```bash
git add prisma/schema.prisma src/db/client.ts tests/db-schema.spec.ts
git commit -m "feat: add persistence schema for recommendation runs"
```

### Task 3: Implement Secure Credential Store

**Files:**
- Create: `src/security/crypto.ts`
- Create: `src/security/credential-store.ts`
- Test: `tests/credential-store.spec.ts`

**Skill refs:** `@test-driven-development`

**Step 1: Write the failing test**

```ts
it("round-trips encrypted credential payload", async () => {
  const store = new CredentialStore("test-master-key-32bytes-min");
  const cipher = store.encrypt({ cookie: "abc=1" });
  const plain = store.decrypt(cipher);
  expect(plain.cookie).toBe("abc=1");
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/credential-store.spec.ts`
Expected: FAIL due missing implementation.

**Step 3: Write minimal implementation**

```ts
export function encryptJson(masterKey: Buffer, data: object): string { /* aes-256-gcm */ }
export function decryptJson(masterKey: Buffer, blob: string): any { /* aes-256-gcm */ }
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/credential-store.spec.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/security/crypto.ts src/security/credential-store.ts tests/credential-store.spec.ts
git commit -m "feat: add encrypted credential storage"
```

### Task 4: Build Netease Auth Adapter (QR Login + Refresh)

**Files:**
- Create: `src/providers/netease/auth-client.ts`
- Create: `src/providers/netease/types.ts`
- Test: `tests/netease-auth.spec.ts`

**Skill refs:** `@test-driven-development`

**Step 1: Write the failing test**

```ts
it("returns relogin status when refresh endpoint rejects cookie", async () => {
  const client = new NeteaseAuthClient(fakeHttp401);
  await expect(client.refresh("bad-cookie")).resolves.toEqual({
    ok: false,
    reason: "RELOGIN_REQUIRED",
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/netease-auth.spec.ts`
Expected: FAIL due missing adapter.

**Step 3: Write minimal implementation**

```ts
export class NeteaseAuthClient {
  async refresh(cookie: string) {
    try { /* call refresh endpoint */ } catch { return { ok: false, reason: "RELOGIN_REQUIRED" }; }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/netease-auth.spec.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/providers/netease/auth-client.ts src/providers/netease/types.ts tests/netease-auth.spec.ts
git commit -m "feat: add netease auth refresh adapter"
```

### Task 5: Implement One-Time Douban Import Pipeline

**Files:**
- Create: `src/ingest/douban-import.ts`
- Create: `src/ingest/douban-parser.ts`
- Test: `tests/douban-import.spec.ts`

**Skill refs:** `@test-driven-development`

**Step 1: Write the failing test**

```ts
it("imports source records and marks baseline version", async () => {
  const count = await importDoubanBaseline(sampleRows, db);
  expect(count).toBe(3);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/douban-import.spec.ts`
Expected: FAIL due missing import module.

**Step 3: Write minimal implementation**

```ts
export async function importDoubanBaseline(rows: DoubanRow[], db: DbClient) {
  // upsert artist/song affinity rows
  return rows.length;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/douban-import.spec.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/ingest/douban-import.ts src/ingest/douban-parser.ts tests/douban-import.spec.ts
git commit -m "feat: add one-time douban baseline import"
```

### Task 6: Implement Netease Incremental Ingestion

**Files:**
- Create: `src/ingest/netease-incremental.ts`
- Modify: `prisma/schema.prisma`
- Test: `tests/netease-incremental.spec.ts`

**Skill refs:** `@test-driven-development`

**Step 1: Write the failing test**

```ts
it("persists only new events based on cursor and idempotency key", async () => {
  const result = await ingestIncremental({ cursor: "1000" }, db, provider);
  expect(result.inserted).toBe(2);
  expect(result.nextCursor).toBe("1200");
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/netease-incremental.spec.ts`
Expected: FAIL due missing ingestion and schema fields.

**Step 3: Write minimal implementation**

```ts
export async function ingestIncremental(state, db, provider) {
  // fetch new likes/favorites/listens after cursor
  // upsert by idempotency key
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/netease-incremental.spec.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/ingest/netease-incremental.ts prisma/schema.prisma tests/netease-incremental.spec.ts
git commit -m "feat: ingest netease incremental events with cursor"
```

### Task 7: Implement Hybrid Recommender with Behavior-Only Dedup

**Files:**
- Create: `src/recommendation/scoring.ts`
- Create: `src/recommendation/recommender.ts`
- Test: `tests/recommender.spec.ts`

**Skill refs:** `@test-driven-development`

**Step 1: Write the failing test**

```ts
it("keeps recommended-but-unlistened songs eligible", async () => {
  const picks = recommend({
    listenedSongIds: new Set(["s1"]),
    likedSongIds: new Set(["s2"]),
    previouslyRecommendedSongIds: new Set(["s3"]),
    listenedAfterRecommendation: new Set([]),
    candidates: ["s1", "s2", "s3", "s4"],
  });
  expect(picks).toContain("s3");
  expect(picks).not.toContain("s1");
  expect(picks).not.toContain("s2");
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/recommender.spec.ts`
Expected: FAIL due missing recommender.

**Step 3: Write minimal implementation**

```ts
const hardExclude = union(listenedSongIds, likedSongIds, favoritedSongIds);
// previously recommended song is not hard excluded unless listened/liked/favorited
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/recommender.spec.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/recommendation/scoring.ts src/recommendation/recommender.ts tests/recommender.spec.ts
git commit -m "feat: add hybrid recommender with behavior-only dedup rule"
```

### Task 8: Implement Fixed Playlist Replace Publisher

**Files:**
- Create: `src/publish/playlist-publisher.ts`
- Test: `tests/playlist-publisher.spec.ts`

**Skill refs:** `@test-driven-development`

**Step 1: Write the failing test**

```ts
it("clears existing tracks then adds exactly 20 picks", async () => {
  await publishDailyPlaylist("playlist-id", twentySongs, provider);
  expect(provider.removeAllCalled).toBe(true);
  expect(provider.added.length).toBe(20);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/playlist-publisher.spec.ts`
Expected: FAIL due missing publisher.

**Step 3: Write minimal implementation**

```ts
export async function publishDailyPlaylist(playlistId, picks, provider) {
  await provider.removeAllTracks(playlistId);
  await provider.addTracks(playlistId, picks.slice(0, 20));
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/playlist-publisher.spec.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/publish/playlist-publisher.ts tests/playlist-publisher.spec.ts
git commit -m "feat: replace fixed playlist tracks with daily picks"
```

### Task 9: Add Scheduler and Notification Workflow

**Files:**
- Create: `src/jobs/daily-job.ts`
- Create: `src/notify/notifier.ts`
- Modify: `src/index.ts`
- Test: `tests/daily-job.spec.ts`

**Skill refs:** `@test-driven-development`

**Step 1: Write the failing test**

```ts
it("sends relogin notification and aborts publish when auth refresh fails", async () => {
  const result = await runDailyJob(ctxAuthExpired);
  expect(result.status).toBe("AUTH_EXPIRED");
  expect(mockNotifier.sent).toBe(true);
  expect(mockPublisher.called).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/daily-job.spec.ts`
Expected: FAIL due missing orchestration.

**Step 3: Write minimal implementation**

```ts
if (!authResult.ok) {
  await notifier.sendReloginRequired();
  return { status: "AUTH_EXPIRED" };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/daily-job.spec.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/jobs/daily-job.ts src/notify/notifier.ts src/index.ts tests/daily-job.spec.ts
git commit -m "feat: add daily orchestration with auth-expiry notification path"
```

### Task 10: Add CLI Commands and Operational Docs

**Files:**
- Create: `src/cli.ts`
- Create: `docs/operations.md`
- Modify: `README.md`
- Test: `tests/cli.spec.ts`

**Skill refs:** `@test-driven-development @verification-before-completion`

**Step 1: Write the failing test**

```ts
it("supports commands: bootstrap-login, douban-sync, run-once", async () => {
  const out = await runCli(["--help"]);
  expect(out).toContain("bootstrap-login");
  expect(out).toContain("douban-sync");
  expect(out).toContain("run-once");
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/cli.spec.ts`
Expected: FAIL due missing CLI.

**Step 3: Write minimal implementation**

```ts
switch (command) {
  case "bootstrap-login": /* start QR flow */ break;
  case "douban-sync": /* run one-time import */ break;
  case "run-once": /* execute daily job */ break;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/cli.spec.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/cli.ts docs/operations.md README.md tests/cli.spec.ts
git commit -m "feat: add operational cli and runbook"
```

### Task 11: Final Verification Gate

**Files:**
- Modify: `README.md`

**Skill refs:** `@verification-before-completion @requesting-code-review`

**Step 1: Run full test suite**

Run: `npm test`
Expected: all tests PASS.

**Step 2: Run type checks**

Run: `npm run typecheck`
Expected: no TypeScript errors.

**Step 3: Run one dry-run command with fixtures**

Run: `npm run run-once -- --dry-run`
Expected: output includes exactly `selectedCount=20`.

**Step 4: Document verification evidence**

Update `README.md` with:
- test command outputs
- dry-run result
- known limitations and API risk note

**Step 5: Commit**

```bash
git add README.md
git commit -m "chore: add verification evidence and known risks"
```

