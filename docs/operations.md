# Operations Runbook

## Environment

- `MASTER_KEY`: encryption key for credential store
- `NETEASE_PLAYLIST_ID`: fixed playlist id for daily replacement
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
4. On `qr-status=AUTHORIZED`, the app automatically encrypts and stores the normalized cookie in the SQLite database
5. Run one-time Douban import:
   - `docker compose exec app npm run douban-sync`

### Douban Baseline File

`douban-sync` reads [data/douban-baseline.json](/Users/shangliang/Documents/Xi/Code/topSongs/data/douban-baseline.json) by default. The file must be a JSON array:

```json
[
  {
    "songId": "12345",
    "artist": "Artist Name",
    "tags": ["indie", "dream pop"]
  }
]
```

The import is intentionally one-time:

- if `douban_baseline_songs` is empty, the rows are imported
- if the baseline table already has data, `douban-sync` returns `skipped=already-imported`

### QR Login Troubleshooting

If `bootstrap-login -- --check <unikey>` returns `WAITING_SCAN`, `EXPIRED`, or you suspect the wrong QR code was scanned, avoid copying `unikey` and `qrurl` by hand. Generate and open the QR image from the same command output:

```bash
OUT="$(docker compose exec app npm run bootstrap-login | tr -d '\r')"
echo "$OUT"

UNIKEY="$(printf '%s\n' "$OUT" | sed -n 's/^unikey=//p')"
QRURL="$(printf '%s\n' "$OUT" | sed -n 's/^qrurl=//p')"

python3 - <<PY
import urllib.parse, webbrowser
qrurl = """$QRURL"""
img = "https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=" + urllib.parse.quote(qrurl, safe="") + "&t=" + urllib.parse.quote("$UNIKEY", safe="")
print("unikey=", "$UNIKEY")
print("qrimg=", img)
webbrowser.open(img)
PY
```

Then scan the QR code immediately and poll the status using the same `UNIKEY`:

```bash
docker compose exec app npm run bootstrap-login -- --check "$UNIKEY"
```

Status meanings:

- `WAITING_SCAN`: QR code has not been scanned yet
- `WAITING_CONFIRM`: QR code was scanned, waiting for phone confirmation
- `EXPIRED`: discard the old `UNIKEY` and generate a new QR code
- `AUTHORIZED`: the app already stored the normalized `cookie=...` in the database; no manual `.env` update is required

If `run-once -- --dry-run` returns `HttpError: 301 Moved Permanently`, verify the actual login state inside the container:

```bash
docker compose exec app node -e 'const cookie=process.env.NETEASE_COOKIE||""; fetch("http://netease-api:3000/login/status",{headers:{cookie}}).then(async r=>{console.log(await r.text())})'
```

If the response contains `account: null` and `profile: null`, the cookie is not accepted by the current `netease-api` container. Re-run the QR login flow so the app can replace the stored cookie.

## Daily Run

- Execute daily job manually: `docker compose exec app npm run run-once`
- Dry-run with real data: `docker compose exec app npm run run-once -- --dry-run`
- Run with scheduler on server after compose is up
- Real runs use the same `.env` credentials and the container-internal `netease-api` endpoint

## Auth Expiry

- If refresh fails, job returns `AUTH_EXPIRED`
- Re-run bootstrap login inside the app container to refresh cookie/token
