# Long-Term Fallback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add long-term + recent mixed recommendation for dry-run, with 14-day recent window and long-term-only fallback when no recent events exist.

**Architecture:** Extend dry-run to ingest recent incremental events and merge with long-term pool. Long-term pool is read from DB (douban baseline) when available. Recent and long-term candidates are scored with weighted mix; if candidates < 20, fill with adjacent-style exploration candidates.

**Tech Stack:** Node.js, TypeScript, Vitest, SQLite, NeteaseCloudMusicApi.

---

### Task 1: Long-Term Pool Reader

**Files:**
- Modify: `src/db/client.ts`
- Test: `tests/longterm-pool.spec.ts`

**Skill refs:** `@test-driven-development`

**Step 1: Write the failing test**

```ts
import { DbClient } from "../src/db/client";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

it("returns up to N long-term songs from douban baseline", () => {
  const dir = mkdtempSync(join(tmpdir(), "top-songs-longterm-"));
  const db = new DbClient(join(dir, "app.sqlite"));
  db.initSchema();
  db.upsertDoubanBaselineSong({ songId: "s1", artist: "a1", tags: ["rock"] });
  db.upsertDoubanBaselineSong({ songId: "s2", artist: "a2", tags: ["pop"] });

  const pool = db.listDoubanBaselineSongs(1);
  expect(pool).toEqual(["s1"]);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/longterm-pool.spec.ts`  
Expected: FAIL (method missing)

**Step 3: Write minimal implementation**

```ts
listDoubanBaselineSongs(limit: number): string[] {
  const stmt = this.db.prepare(`
    SELECT song_id AS songId FROM douban_baseline_songs
    ORDER BY updated_at DESC
    LIMIT ?
  `);
  return stmt.all(limit).map((row: { songId: string }) => row.songId);
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/longterm-pool.spec.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/client.ts tests/longterm-pool.spec.ts
git commit -m "feat: add long-term pool reader from douban baseline"
```

---

### Task 2: Mixed Candidate Builder

**Files:**
- Create: `src/recommendation/mixer.ts`
- Test: `tests/recommendation-mixer.spec.ts`

**Skill refs:** `@test-driven-development`

**Step 1: Write the failing test**

```ts
import { mixCandidates } from "../src/recommendation/mixer";

it("uses recent + long-term when recent exists, long-term only otherwise", () => {
  const withRecent = mixCandidates({
    recentSongIds: ["r1", "r2"],
    longTermSongIds: ["l1", "l2"],
    recentWeight: 0.6,
    longTermWeight: 0.4
  });
  expect(withRecent.some(c => c.songId === "r1")).toBe(true);
  expect(withRecent.some(c => c.songId === "l1")).toBe(true);

  const noRecent = mixCandidates({
    recentSongIds: [],
    longTermSongIds: ["l1", "l2"],
    recentWeight: 0.6,
    longTermWeight: 0.4
  });
  expect(noRecent.length).toBe(2);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/recommendation-mixer.spec.ts`  
Expected: FAIL (module missing)

**Step 3: Write minimal implementation**

```ts
export function mixCandidates(input) {
  // if recent empty: only long-term
  // else: concat with weights
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/recommendation-mixer.spec.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/recommendation/mixer.ts tests/recommendation-mixer.spec.ts
git commit -m "feat: add recent/long-term candidate mixer"
```

---

### Task 3: Dry-Run Uses Mixed Pool

**Files:**
- Modify: `src/jobs/run-once.ts`
- Modify: `src/cli.ts`
- Test: `tests/run-once-live.spec.ts`

**Skill refs:** `@test-driven-development`

**Step 1: Write the failing test**

```ts
it("falls back to long-term only when no recent events", async () => {
  const incrementalProvider = { async fetchSince() { return { nextCursor: "1", events: [] }; } };
  const result = await runOnceLiveDryRun({
    incrementalProvider,
    cursor: "0",
    limit: 20,
    longTermSongIds: ["l1", "l2", "l3"]
  });
  expect(result.selectedCount).toBe(3);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/run-once-live.spec.ts`  
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
// extend runOnceLiveDryRun to accept longTermSongIds
// call mixCandidates() to build candidate list
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/run-once-live.spec.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/jobs/run-once.ts src/cli.ts tests/run-once-live.spec.ts
git commit -m "feat: use mixed long-term+recent pool in live dry-run"
```

---

### Task 4: Exploration Pool Fill

**Files:**
- Create: `src/recommendation/exploration.ts`
- Modify: `src/jobs/run-once.ts`
- Test: `tests/exploration-fill.spec.ts`

**Skill refs:** `@test-driven-development`

**Step 1: Write the failing test**

```ts
it("fills to 20 with exploration pool when candidates不足", () => {
  const picks = fillWithExploration(["s1"], ["e1","e2","e3"], 3);
  expect(picks.length).toBe(3);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/exploration-fill.spec.ts`  
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
export function fillWithExploration(primary, exploration, limit) { /* ... */ }
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/exploration-fill.spec.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/recommendation/exploration.ts src/jobs/run-once.ts tests/exploration-fill.spec.ts
git commit -m "feat: add exploration fill for low candidate counts"
```

---

### Task 5: Verification

**Files:**
- Modify: `README.md`

**Skill refs:** `@verification-before-completion`

**Step 1: Run tests**

Run: `npm test`  
Expected: PASS

**Step 2: Run typecheck**

Run: `npm run typecheck`  
Expected: PASS

**Step 3: Dry-run live**

Run: `npm run run-once -- --dry-run`  
Expected: output includes `events / candidates / selectedCount / nextCursor / top20SongIds`

**Step 4: Update README with verification evidence**

```bash
git add README.md
git commit -m "chore: update verification evidence for mixed pool"
```

