# Douban + Netease Daily Recommendation Design

## Goal

Build a secure, server-side automation that generates 20 daily song recommendations and publishes them to one fixed Netease playlist. Recommendations must combine long-term taste (Douban one-time import + Netease baseline history) with short-term taste (daily new Netease likes/favorites).

## User-Confirmed Requirements

1. Runtime is a 24/7 server.
2. Netease login uses QR code once, with automatic token refresh.
3. If token expires, notify user to re-login.
4. Account security is the top priority.
5. Douban ingestion runs once (manual re-sync only when requested).
6. Netease ingestion runs daily with incremental events only.
7. Daily playlist should not accumulate many copies.
8. Reuse one fixed playlist and replace tracks each day.
9. Songs that were recommended but not listened should NOT be deduplicated by recommendation history.
10. Deduplication should be based on user behavior only (listened/liked/favorited).

## Architecture

Single service with six modules:

1. `auth`: QR login, cookie refresh, secure credential storage.
2. `ingest_douban`: one-time import for long-term preference baseline.
3. `ingest_netease_incremental`: daily incremental likes/favorites/listening signals.
4. `recommender`: hybrid scoring using long-term + short-term vectors and exploration pool.
5. `playlist_publisher`: replace tracks in one fixed playlist with 20 selected songs.
6. `notifier`: login-expiry and job-failure notifications.

Storage uses SQLite (metadata + event history + recommendation runs).

## Data Flow

1. Bootstrapping:
- user scans QR code once
- service stores encrypted auth material
- import Douban history once
- import Netease baseline history once

2. Daily job:
- refresh auth
- fetch Netease incremental changes since `last_cursor`
- persist event rows with idempotency keys
- rebuild short-term profile from recent incremental events
- merge with long-term profile and compute candidate scores
- filter out listened/liked/favorited songs
- keep songs previously recommended but never listened eligible
- produce top 20 songs
- clear fixed playlist and write new 20 tracks
- persist run report and send notification on failures

## Recommendation Logic

## Candidate pools

1. Similarity pool (majority, target 75%): nearest songs/artists/tags to long-term + short-term profile.
2. Exploration pool (minority, target 25%): adjacent genres only, gated by minimum affinity.

## Scoring

`score = 0.55 * short_term_similarity + 0.30 * long_term_similarity + 0.10 * freshness + 0.05 * diversity`

Adjustments:
- penalty for too many songs from same artist in one day
- boost for songs aligned with both short-term and long-term vectors

## Filtering and dedup

1. Hard exclude:
- user has listened recently (window configurable, default 90 days)
- user has liked or favorited the song
- song is unavailable on Netease

2. Recommendation history rule:
- `recommended_but_not_listened` remains eligible for future days
- recommendation history is NOT used as hard dedup

## Playlist Lifecycle

1. Use one fixed playlist id (for example `Daily AI Picks`).
2. On each daily run:
- fetch current tracks in that playlist
- remove all tracks
- add newly selected 20 tracks
3. Store run metadata in DB rather than creating date-specific playlists.

## Security Design

1. Credentials:
- encrypt cookies/tokens with AES-256-GCM
- key provided via `MASTER_KEY` environment variable
- never write tokens in logs

2. Runtime:
- least-privilege server account
- firewall only required outbound endpoints
- rotate master key with migration procedure

3. Failure handling:
- if auth refresh fails, stop job before any write operation
- send immediate re-login notification with one-time link/command hint

## Observability and Alerts

Metrics:
- ingestion duration
- number of incremental events
- recommendation candidate count
- final selected count
- publish latency

Alerts:
- auth expired
- no candidates available
- publish failure
- repeated job failure N times

## Testing Strategy

1. Unit tests:
- score composition
- filter behavior
- dedup rule for recommended-but-not-listened

2. Integration tests:
- incremental ingestion cursor correctness
- playlist replacement workflow
- auth refresh and expiry branch

3. End-to-end dry run:
- seeded fixture data
- produce exactly 20 songs
- verify fixed playlist is replaced, not duplicated

## Deployment Shape

1. Service runs as one process with:
- daily scheduler (cron-style)
- optional command mode for `bootstrap`, `douban-sync`, `run-once`

2. Recommended stack:
- Node.js + TypeScript
- SQLite + Prisma (or lightweight SQL client)
- Netease API client (community-maintained, monitored for breakage)
- HTTP notification provider (Telegram/Email/Webhook)

## Risks and Mitigations

1. Non-official API changes:
- isolate provider in adapter layer
- add health check and contract tests

2. Auth fragility:
- explicit refresh job and expiry alarms
- manual re-login command documented

3. Data sparsity in incremental window:
- fallback to long-term profile only when short-term signals are too few

