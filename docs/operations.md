# Operations Runbook

## Environment

- `MASTER_KEY`: encryption key for credential store
- `NETEASE_API_BASE_URL`: NeteaseCloudMusicApi endpoint
- `NETEASE_PLAYLIST_ID`: fixed playlist id for daily replacement
- `NETEASE_COOKIE`: login cookie (updated after QR login success)
- `NETEASE_EVENT_CURSOR`: last cursor for incremental events (default `0`)

## Bootstrap

1. Install deps: `npm install`
2. Start QR login bootstrap and get QR URL:
   - `npm run bootstrap-login`
3. Poll login status after scan:
   - `npm run bootstrap-login -- --check <unikey>`
4. Persist returned cookie to `NETEASE_COOKIE`
5. Run one-time Douban import: `npm run douban-sync`

## Daily Run

- Execute daily job manually: `npm run run-once`
- Run with scheduler on server (cron/systemd timer)
- Dry-run with real data uses `NETEASE_COOKIE` and `NETEASE_API_BASE_URL` when set

## Auth Expiry

- If refresh fails, job returns `AUTH_EXPIRED`
- Re-run bootstrap login to refresh cookie/token
