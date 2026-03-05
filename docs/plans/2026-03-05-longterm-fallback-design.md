# Long-Term Fallback & 14-Day Mix Design

## Goal

Ensure daily recommendations always produce 20 songs by mixing long-term preference candidates with recent (14-day) incremental events, and falling back to long-term-only when no recent events exist. For dry-run, output a compact summary and top 20 song IDs without writing to DB or modifying playlists.

## Requirements (Confirmed)

1. Long-term preference pool is ~1000 songs.
2. Recent window is 14 days.
3. Always combine long-term + recent when recent exists.
4. If no recent events, use long-term only.
5. Hard dedup remains based on listened/liked/favorited only.
6. Recommended-but-unlistened is NOT deduped.
7. If candidates < 20, enable adjacent-style exploration to fill to 20.
8. Dry-run prints `events / candidates / selectedCount / nextCursor / top20SongIds`.

## Data Flow

1. Build recent pool from last 14 days of events (incremental likes/favorites).
2. Build long-term pool from baseline (~1000).
3. If recent pool empty:
   - score only long-term pool
4. If recent pool present:
   - score recent + long-term with weighted mix
5. Apply hard dedup (listened/liked/favorited only).
6. If result < 20:
   - add exploration pool candidates until 20.
7. Dry-run output summary + top 20 IDs.

## Scoring

When recent exists:
```
score = 0.60 * recent_similarity
      + 0.40 * long_term_similarity
      + 0.10 * freshness
      + 0.05 * diversity
```

When no recent:
```
score = 1.00 * long_term_similarity
      + 0.10 * freshness
      + 0.05 * diversity
```

Weights can be tuned later.

## Exploration Pool

Adjacent style/genre expansion for fill-up only:
- used only when < 20 candidates after dedup
- small cap (e.g. 5-10 max) to avoid drift

## Dry-Run Output

Example:
```
events=12 candidates=45 selectedCount=20 nextCursor=123456
top20SongIds=s1,s2,...,s20
```

