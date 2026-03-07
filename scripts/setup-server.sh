#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
CRON_MARKER="# topsongs-daily-job"

generate_master_key() {
  LC_ALL=C od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少命令: $1"
    exit 1
  fi
}

send_telegram_message() {
  local bot_token="$1"
  local chat_id="$2"
  local message="$3"
  local api="https://api.telegram.org/bot${bot_token}/sendMessage"
  curl -fsS -X POST "$api" \
    --data-urlencode "chat_id=${chat_id}" \
    --data-urlencode "text=${message}" >/dev/null
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
  value="${value//$'\n'/}"
  value="${value//$'\r'/}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ "${value:0:1}" == "\"" && "${value: -1}" == "\"" && "${#value}" -ge 2 ]]; then
    value="${value:1:${#value}-2}"
  fi
  if [[ "${value:0:1}" == "'" && "${value: -1}" == "'" && "${#value}" -ge 2 ]]; then
    value="${value:1:${#value}-2}"
  fi
  echo "$value"
}

format_env_value() {
  local value="$1"
  value="${value//$'\r'/}"
  value="${value//$'\n'/}"
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
  chmod 600 "$ENV_FILE"
  local tmp_file
  tmp_file="$(mktemp)"
  local replaced=0
  local skip_broken=0

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$skip_broken" -eq 1 ]]; then
      if [[ -z "$line" || "$line" =~ ^[[:space:]]*# || "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
        skip_broken=0
      else
        continue
      fi
    fi

    if [[ "$line" == "$key="* ]]; then
      if [[ "$replaced" -eq 0 ]]; then
        printf '%s=%s\n' "$key" "$value" >> "$tmp_file"
        replaced=1
      fi
      skip_broken=1
      continue
    fi

    printf '%s\n' "$line" >> "$tmp_file"
  done < "$ENV_FILE"

  if [[ "$replaced" -eq 0 ]]; then
    printf '%s=%s\n' "$key" "$value" >> "$tmp_file"
  fi

  mv "$tmp_file" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
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
  local bot_token="$1"
  local chat_id="$2"
  echo
  echo "正在生成网易云登录二维码并发送到 Telegram..."
  cd "$ROOT_DIR" && docker compose exec -T app npm run bootstrap-login >/dev/null

  local parsed
  parsed="$(cd "$ROOT_DIR" && docker compose exec -T app node --input-type=module -e '
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

const dbPath = "data/top-songs.db";
if (!existsSync(dbPath)) {
  console.log("|");
  process.exit(0);
}
const db = new DatabaseSync(dbPath, { readonly: true });
const row = db
  .prepare("SELECT pending_unikey, pending_qr_url FROM netease_auth_state WHERE provider = ? LIMIT 1")
  .get("netease");
db.close();
if (!row?.pending_unikey || !row?.pending_qr_url) {
  console.log("|");
} else {
  console.log(`${row.pending_unikey}|${row.pending_qr_url}`);
}
')"

  local unikey
  local qrurl
  unikey="${parsed%%|*}"
  qrurl="${parsed#*|}"
  if [[ -n "$unikey" && -n "$qrurl" ]]; then
    local msg
    msg=$'网易云登录二维码已生成，请在可信设备打开下面链接并完成扫码确认。\n\n'"$qrurl"$'\n\n扫码确认后，回到服务器执行：\n'"docker compose exec app npm run bootstrap-login -- --check"
    if send_telegram_message "$bot_token" "$chat_id" "$msg"; then
      echo "已发送到 Telegram，请在手机上完成扫码。"
      echo "然后执行：docker compose exec app npm run bootstrap-login -- --check"
    else
      echo "发送 Telegram 失败。请手动执行 bootstrap-login 查看链接。"
    fi
  else
    echo "未能解析 unikey/qrurl，请手动执行 bootstrap-login 检查。"
  fi
}

main() {
  need_cmd docker
  need_cmd crontab
  need_cmd sed
  need_cmd od
  need_cmd tr
  need_cmd curl

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
    master_key="$(generate_master_key)"
  fi

  upsert_env "MASTER_KEY" "$master_key"
  upsert_env "NETEASE_PLAYLIST_ID" "$playlist_id"
  upsert_env "DOUBAN_PROFILE_URL" "$douban_profile"
  upsert_env "LLM_PROVIDER" "$provider"
  upsert_env "LLM_API_KEY" "$llm_api_key"
  upsert_env "LLM_MODEL" "$model"
  upsert_env "LLM_BASE_URL" "$base_url"
  upsert_env "NOTIFY_WEBHOOK_FORMAT" "telegram"
  upsert_env "NOTIFY_TELEGRAM_BOT_TOKEN" "$telegram_bot_token"
  upsert_env "NOTIFY_TELEGRAM_CHAT_ID" "$telegram_chat_id"
  upsert_env "TELEGRAM_CHAT_ID" "$telegram_chat_id"
  upsert_env "RUN_LOG_RETENTION_HOURS" "24"
  upsert_env "AI_REQUEST_TIMEOUT_MS" "120000"
  upsert_env "AI_REQUEST_RETRY_COUNT" "2"
  chmod 600 "$ENV_FILE"

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
    bootstrap_qr "$telegram_bot_token" "$telegram_chat_id"
  fi
}

main "$@"
