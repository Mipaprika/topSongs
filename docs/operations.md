# Operations Runbook

## Environment

- `MASTER_KEY`: encryption key for credential store
- `NETEASE_PLAYLIST_ID`: fixed playlist id for daily replacement
- `NETEASE_EVENT_CURSOR`: last cursor for incremental events (default `0`)
- `LLM_PROVIDER`: optional, `openai` | `openai-compatible` | `aliyun-bailian`
- `LLM_API_KEY`: enable AI-based final selection
- `LLM_MODEL`: optional model id
- `LLM_BASE_URL`: optional provider base URL
- `AI_CANDIDATE_POOL_LIMIT`: optional candidate pool size before AI selection (default `120`)

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
6. Run one-time Netease baseline import:
   - `docker compose exec app npm run netease-sync`

### Douban Baseline File

`douban-sync` reads [data/douban-baseline.json](/Users/shangliang/Documents/Xi/Code/topSongs/data/douban-baseline.json) by default. The file must be a JSON array:

```json
[
  {
    "title": "Back To Bedlam",
    "artist": "Artist Name",
    "tags": ["indie", "dream pop"]
  }
]
```

The import is intentionally one-time:

- if `douban_baseline_songs` is empty, the rows are imported
- if the baseline table already has data, `douban-sync` returns `skipped=already-imported`

If the JSON file does not exist, `douban-sync` can fetch directly from a public Douban profile when one of these is set:

- `DOUBAN_USER_ID=sample_user_01`
- `DOUBAN_PROFILE_URL=https://www.douban.com/people/sample_user_01`

In that mode, the command first generates [data/douban-baseline.json](/Users/shangliang/Documents/Xi/Code/topSongs/data/douban-baseline.json), then imports it into SQLite.

### Netease Baseline Import

`netease-sync` imports your current Netease liked songs into `netease_baseline_songs`.

The import is intentionally one-time:

- if `netease_baseline_songs` is empty, the liked songs are imported
- if the table already has data, `netease-sync` returns `skipped=already-imported`

The command reads the encrypted cookie from SQLite first. If the database has no stored cookie yet, it falls back to `NETEASE_COOKIE`.

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
- Real runs use `netease_baseline_songs` plus recent incremental events as the `songId` candidate pool
- `douban_baseline_songs` stays as AI context only and is not mapped to Netease `songId` during daily runs
- Daily runs only fetch incremental events; the two baselines stay fixed unless you explicitly rebuild them
- `run-once` clears the current tracks in `NETEASE_PLAYLIST_ID` and writes the latest 20 recommendations back into the same playlist
- If `LLM_API_KEY` is present, the model selects final 20 from a larger candidate pool; failures fall back to deterministic ranking
- Bailian mainland setup uses:
  `LLM_PROVIDER=aliyun-bailian`
  `LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`
  `LLM_MODEL=qwen-plus-latest`

## Auth Expiry

- If refresh fails, job returns `AUTH_EXPIRED`
- Re-run bootstrap login inside the app container to refresh cookie/token
