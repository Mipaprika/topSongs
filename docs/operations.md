# Operations Runbook

## Environment

- `MASTER_KEY`: encryption key for credential store

## Bootstrap

1. Install deps: `npm install`
2. Start QR login bootstrap: `npm run bootstrap-login`
3. Run one-time Douban import: `npm run douban-sync`

## Daily Run

- Execute daily job manually: `npm run run-once`
- Run with scheduler on server (cron/systemd timer)

## Auth Expiry

- If refresh fails, job returns `AUTH_EXPIRED`
- Re-run bootstrap login to refresh cookie/token
