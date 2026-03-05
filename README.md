# top-songs

Daily AI recommendation service for Netease playlist updates using long-term and short-term preference signals.

## Setup

```bash
npm install
cp .env.example .env
```

Required `.env` fields for Netease integration:

- `NETEASE_API_BASE_URL`: your NeteaseCloudMusicApi service URL (for example `http://127.0.0.1:3000`)
- `NETEASE_PLAYLIST_ID`: target fixed playlist id
- `NETEASE_COOKIE`: initial cookie after QR login

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

- `npm test`: PASS (14 files, 21 tests)
- `npm run typecheck`: PASS
- `npm run run-once -- --dry-run`: output contains `selectedCount=20`

## Known Limitations

- Douban data source is still placeholder (no real export parser/connector yet).
- Netease incremental event classification currently uses heuristics from event text.
- SQLite currently uses `node:sqlite` (experimental in Node 24).
