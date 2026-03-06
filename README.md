# top-songs

Daily AI recommendation service for Netease playlist updates using long-term and short-term preference signals.

## Setup

```bash
npm install
```

Required `.env` fields for Netease integration:

- `NETEASE_PLAYLIST_ID`: target fixed playlist id
- `MASTER_KEY`: credential encryption key

When running with Docker Compose, the app container overrides these values automatically:

- `NETEASE_API_BASE_URL=http://netease-api:3000`
- `DB_PATH=/app/data/top-songs.db`

`NETEASE_COOKIE` is now optional for normal operation. After a successful QR login check, the service stores the normalized cookie in the SQLite database automatically.

## Commands

```bash
npm test
npm run typecheck
npm run bootstrap-login
npm run douban-sync
npm run run-once -- --dry-run
```

## Docker Compose

Start both the app container and `NeteaseCloudMusicApi`:

```bash
docker compose up -d --build
```

Run commands inside the app container:

```bash
docker compose exec app npm run bootstrap-login
docker compose exec app npm run bootstrap-login -- --check <unikey>
docker compose exec app npm run douban-sync
docker compose exec app npm run run-once -- --dry-run
```

Douban baseline import reads [data/douban-baseline.json](/Users/shangliang/Documents/Xi/Code/topSongs/data/douban-baseline.json) by default. The file should be a JSON array like:

```json
[
  {
    "title": "Back To Bedlam",
    "artist": "Artist Name",
    "tags": ["indie", "dream pop"]
  }
]
```

If the file does not exist, `douban-sync` can fetch from a public Douban profile when either `DOUBAN_USER_ID` or `DOUBAN_PROFILE_URL` is provided.

If QR login behaves unexpectedly, see the troubleshooting section in [operations.md](/Users/shangliang/Documents/Xi/Code/topSongs/docs/operations.md).

Persistent SQLite data is stored on the host at [data](/Users/shangliang/Documents/Xi/Code/topSongs/data). The database file inside the container is `/app/data/top-songs.db`.

If you change application code, rebuild the app image:

```bash
docker compose build app
```

## Workflow

1. Run `bootstrap-login` once for Netease auth.
2. Run `douban-sync` once for baseline preference import.
3. Schedule `run-once` daily on a server.

## Verification (2026-03-06)

- `npm test`: PASS
- `npm run typecheck`: PASS
- `npm run run-once -- --dry-run`: output contains `selectedCount=20`

## Known Limitations

- Douban baseline import works best with a public Douban profile or a prepared local JSON file.
- Netease incremental event classification currently uses heuristics from event text.
- SQLite currently uses `node:sqlite` (experimental in Node 24).
