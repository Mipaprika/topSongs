# top-songs

Daily AI recommendation service for Netease playlist updates using long-term and short-term preference signals.

## Setup

```bash
npm install
cp .env.example .env
```

## Commands

```bash
npm test
npm run typecheck
npm run bootstrap-login
npm run douban-sync
npm run run-once -- --dry-run
```

## Workflow

1. Run `bootstrap-login` once for Netease auth.
2. Run `douban-sync` once for baseline preference import.
3. Schedule `run-once` daily on a server.

## Verification (2026-03-05)

- `npm test`: PASS (10 files, 13 tests)
- `npm run typecheck`: PASS
- `npm run run-once -- --dry-run`: output contains `selectedCount=20`

## Known Limitations

- Netease and Douban providers are adapter skeletons; real API endpoint binding and retry/backoff policy still need to be completed.
- SQLite currently uses `node:sqlite` (experimental in Node 24).
