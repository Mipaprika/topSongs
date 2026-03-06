# Operations Runbook

## Environment

- `MASTER_KEY`: encryption key for credential store
- `NETEASE_PLAYLIST_ID`: fixed playlist id for daily replacement
- `NETEASE_COOKIE`: login cookie (updated after QR login success)
- `NETEASE_EVENT_CURSOR`: last cursor for incremental events (default `0`)

When using Docker Compose:

- the app service forces `NETEASE_API_BASE_URL=http://netease-api:3000`
- the app service forces `DB_PATH=/app/data/top-songs.db`
- host-side SQLite data lives under [data](/Users/shangliang/Documents/Xi/Code/topSongs/data)

## Bootstrap

1. Build and start services: `docker compose up -d --build`
2. Start QR login bootstrap and get QR URL:
   - `docker compose exec app npm run bootstrap-login`
3. Poll login status after scan:
   - `docker compose exec app npm run bootstrap-login -- --check <unikey>`
4. Persist returned cookie to `NETEASE_COOKIE` in [`.env`](/Users/shangliang/Documents/Xi/Code/topSongs/.env)
5. Run one-time Douban import:
   - `docker compose exec app npm run douban-sync`

## Daily Run

- Execute daily job manually: `docker compose exec app npm run run-once`
- Dry-run with real data: `docker compose exec app npm run run-once -- --dry-run`
- Run with scheduler on server after compose is up
- Real runs use the same `.env` credentials and the container-internal `netease-api` endpoint

## Auth Expiry

- If refresh fails, job returns `AUTH_EXPIRED`
- Re-run bootstrap login inside the app container to refresh cookie/token
