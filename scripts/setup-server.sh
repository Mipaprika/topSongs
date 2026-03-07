#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
CRON_MARKER="# topsongs-daily-job"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少命令: $1"
    exit 1
  fi
}

prompt() {
  local label="$1"
  local default="${2:-}"
  local value
  if [[ -n "$default" ]]; then
    read -r -p "$label [$default]: " value
    echo "${value:-$default}"
  else
    read -r -p "$label: " value
    echo "$value"
  fi
}

prompt_secret() {
  local label="$1"
  local value
  read -r -s -p "$label: " value
  echo
  echo "$value"
}

format_env_value() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

upsert_env() {
  local key="$1"
  local raw_value="$2"
  local value
  value="$(format_env_value "$raw_value")"

  touch "$ENV_FILE"
  local tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$value" '
    BEGIN { done = 0 }
    $0 ~ ("^" k "=") {
      print k "=" v
      done = 1
      next
    }
    { print }
    END {
      if (!done) {
        print k "=" v
      }
    }
  ' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
}

get_env_value() {
  local key="$1"
  if [[ ! -f "$ENV_FILE" ]]; then
    return 0
  fi
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 || true)"
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  echo "$line"
}

install_cron() {
  local hour="$1"
  local minute="$2"
  local cmd="cd $ROOT_DIR && docker compose exec -T app npm run run-once >> $ROOT_DIR/data/cron-run.log 2>&1 $CRON_MARKER"
  local current
  current="$(crontab -l 2>/dev/null | sed "/$CRON_MARKER/d" || true)"
  {
    [[ -n "$current" ]] && echo "$current"
    echo "$minute $hour * * * $cmd"
  } | crontab -
}

bootstrap_qr() {
  echo
  echo "正在生成网易云登录二维码..."
  local out
  out="$(cd "$ROOT_DIR" && docker compose exec -T app npm run bootstrap-login | tr -d '\r')"
  echo "$out"

  local unikey
  local qrurl
  unikey="$(printf '%s\n' "$out" | sed -n 's/^unikey=//p' | tail -n1)"
  qrurl="$(printf '%s\n' "$out" | sed -n 's/^qrurl=//p' | tail -n1)"
  if [[ -n "$unikey" && -n "$qrurl" ]]; then
    echo
    echo "扫码链接（可直接在手机浏览器打开）:"
    echo "https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=$(python3 - <<PY
import urllib.parse
print(urllib.parse.quote(\"\"\"$qrurl\"\"\", safe=\"\"))
PY
)"
    echo
    echo "扫码并在手机确认后，执行："
    echo "docker compose exec app npm run bootstrap-login -- --check $unikey"
  fi
}

main() {
  need_cmd docker
  need_cmd crontab
  need_cmd awk
  need_cmd sed
  need_cmd python3

  cd "$ROOT_DIR"
  mkdir -p "$ROOT_DIR/data"

  echo "== TopSongs 一键初始化 =="
  echo "将会引导你写入 .env、启动容器并安装每日定时任务。"
  echo

  local current_playlist
  local current_douban
  local current_provider
  local current_model
  local current_chat_id
  current_playlist="$(get_env_value "NETEASE_PLAYLIST_ID")"
  current_douban="$(get_env_value "DOUBAN_PROFILE_URL")"
  current_provider="$(get_env_value "LLM_PROVIDER")"
  current_model="$(get_env_value "LLM_MODEL")"
  current_chat_id="$(get_env_value "TELEGRAM_CHAT_ID")"

  local playlist_id
  playlist_id="$(prompt "网易云歌单ID (NETEASE_PLAYLIST_ID)" "${current_playlist:-}")"
  if [[ -z "$playlist_id" ]]; then
    echo "NETEASE_PLAYLIST_ID 不能为空。"
    exit 1
  fi

  local douban_profile
  douban_profile="$(prompt "豆瓣主页URL (可留空)" "${current_douban:-}")"

  local provider
  provider="$(prompt "LLM提供方" "${current_provider:-aliyun-bailian}")"
  local llm_api_key
  llm_api_key="$(prompt_secret "LLM_API_KEY")"
  if [[ -z "$llm_api_key" ]]; then
    echo "LLM_API_KEY 不能为空。"
    exit 1
  fi

  local default_model="qwen-turbo-latest"
  if [[ "$provider" == "openai" ]]; then
    default_model="gpt-4.1-mini"
  fi
  local model
  model="$(prompt "LLM_MODEL" "${current_model:-$default_model}")"

  local base_url_default=""
  if [[ "$provider" == "aliyun-bailian" ]]; then
    base_url_default="https://dashscope.aliyuncs.com/compatible-mode/v1"
  fi
  local base_url
  base_url="$(prompt "LLM_BASE_URL (可留空)" "$base_url_default")"

  local telegram_bot_token
  telegram_bot_token="$(prompt_secret "Telegram Bot Token (不含 bot 前缀)")"
  local telegram_chat_id
  telegram_chat_id="$(prompt "Telegram Chat ID" "$current_chat_id")"
  if [[ -z "$telegram_bot_token" || -z "$telegram_chat_id" ]]; then
    echo "Telegram 配置不完整（bot token / chat id 不能为空）。"
    exit 1
  fi

  local cron_time
  cron_time="$(prompt "每日执行时间 (HH:MM, 24小时制)" "07:10")"
  if [[ ! "$cron_time" =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]]; then
    echo "时间格式错误，应为 HH:MM。"
    exit 1
  fi
  local cron_hour="${cron_time%:*}"
  local cron_minute="${cron_time#*:}"

  local master_key
  master_key="$(get_env_value "MASTER_KEY")"
  if [[ -z "$master_key" ]]; then
    master_key="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)"
  fi

  local notify_webhook
  notify_webhook="https://api.telegram.org/bot${telegram_bot_token}/sendMessage?chat_id=${telegram_chat_id}"

  upsert_env "MASTER_KEY" "$master_key"
  upsert_env "NETEASE_PLAYLIST_ID" "$playlist_id"
  upsert_env "DOUBAN_PROFILE_URL" "$douban_profile"
  upsert_env "LLM_PROVIDER" "$provider"
  upsert_env "LLM_API_KEY" "$llm_api_key"
  upsert_env "LLM_MODEL" "$model"
  upsert_env "LLM_BASE_URL" "$base_url"
  upsert_env "NOTIFY_WEBHOOK_FORMAT" "generic"
  upsert_env "NOTIFY_WEBHOOK_URL" "$notify_webhook"
  upsert_env "TELEGRAM_CHAT_ID" "$telegram_chat_id"
  upsert_env "RUN_LOG_RETENTION_HOURS" "24"
  upsert_env "AI_REQUEST_TIMEOUT_MS" "120000"
  upsert_env "AI_REQUEST_RETRY_COUNT" "2"

  echo
  echo "已写入 .env（敏感值已覆盖更新）。"
  echo "正在启动服务..."
  docker compose up -d --build

  echo "安装每日 cron 任务..."
  install_cron "$cron_hour" "$cron_minute"

  echo
  echo "初始化完成。"
  echo "- 服务状态：docker compose ps"
  echo "- 手动跑一次：docker compose exec app npm run run-once"
  echo "- cron 日志：$ROOT_DIR/data/cron-run.log"

  local do_qr
  do_qr="$(prompt "现在要执行一次网易云扫码登录引导吗? (y/n)" "y")"
  if [[ "$do_qr" =~ ^[Yy]$ ]]; then
    bootstrap_qr
  fi
}

main "$@"

