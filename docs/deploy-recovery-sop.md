# 部署与恢复 SOP（Docker 版）

## 1. 目标
- 每天自动更新同一个网易云歌单（固定 20 首）。
- 账号凭证过期时自动通知你扫码恢复。
- 故障时能快速定位、回滚、恢复数据。

## 2. 自动 vs 手动
- 系统自动做：
  - 每次 `run-once` 前先做 cookie 刷新校验。
  - 刷新失败时自动生成新的 `unikey/qrurl` 并通过 webhook 发通知。
  - 成功后自动发「今日歌单 + 推荐理由」通知。
  - 结构化运行日志写入 `data/run.log`，默认仅保留最近 24 小时。
- 你手动做：
  - 首次扫码登录。
  - 凭证失效后的手机扫码确认。
  - 发布新版本（`git pull` + `docker compose build app`）。
  - 必要时从备份恢复数据库。

## 3. 首次部署
你也可以直接执行一条命令自动引导：
- `bash scripts/setup-server.sh`

手动步骤：
1. 准备 `.env`（至少包含）：
   - `MASTER_KEY`
   - `NETEASE_PLAYLIST_ID`
   - `LLM_PROVIDER`
   - `LLM_API_KEY`
   - `LLM_MODEL`
   - `NOTIFY_WEBHOOK_URL`
   - `NOTIFY_WEBHOOK_FORMAT=generic`（Telegram）
2. 启动服务：`docker compose up -d --build`
3. 网易云登录绑定：
   - `docker compose exec app npm run bootstrap-login`
   - 扫码后执行：`docker compose exec app npm run bootstrap-login -- --check <unikey>`
   - 返回 `qr-status=AUTHORIZED cookie-stored=true` 即成功。
4. 一次性导入基线：
   - `docker compose exec app npm run douban-sync`
   - `docker compose exec app npm run netease-sync`
5. 验证：`docker compose exec app npm run run-once -- --dry-run`

## 4. 日常发布（升级代码）
1. 拉代码：`git pull`
2. 重建并重启：`docker compose build app && docker compose up -d app`
3. 冒烟：`docker compose exec app npm run run-once -- --dry-run`
4. 查看日志：`tail -n 50 data/run.log`

## 5. 日常运行检查
- 手工触发：`docker compose exec app npm run run-once`
- 成功标准：
  - 返回 `selectedCount=20`
  - Telegram 收到成功消息（含 20 首歌单与理由）
  - `data/run.log` 有 `run.success`

## 6. 故障恢复
### 6.1 认证过期
- 现象：收到登录失效通知或命令报 `AUTH_EXPIRED`。
- 处理：
  1. 使用通知中的 `qrurl` 扫码，或重新执行 `docker compose exec app npm run bootstrap-login`
  2. 扫码后执行 `docker compose exec app npm run bootstrap-login -- --check <unikey>`
  3. 成功后重跑 `docker compose exec app npm run run-once`

### 6.2 当天入歌单少于 20 首
1. 先看日志失败汇总：`tail -n 100 data/run.log`
2. 先重跑一次：`docker compose exec app npm run run-once`
3. 若连续异常，再检查 AI 配置和网络可达性。

### 6.3 AI 超时或接口失败
1. 检查模型与超时设置（如 `LLM_MODEL=qwen-turbo-latest`，`AI_REQUEST_TIMEOUT_MS`）。
2. 重试一次 `run-once`。
3. 若持续失败，服务会回退候选池逻辑，先保障歌单可更新。

### 6.4 服务不可用
- `docker compose ps`
- `docker compose logs --tail=200 app`
- `docker compose up -d app`

## 7. 回滚流程
1. 切回上一版本代码（tag/commit）。
2. 重新构建：`docker compose build app && docker compose up -d app`
3. 验证：`docker compose exec app npm run run-once -- --dry-run`

## 8. 数据恢复（SQLite）
- 数据文件：`data/top-songs.db`
- 恢复步骤：
  1. 停 app：`docker compose stop app`
  2. 用备份覆盖 `data/top-songs.db`
  3. 启动 app：`docker compose up -d app`
  4. 验证：`docker compose exec app npm run run-once -- --dry-run`

## 9. 安全约束（执行标准）
- `.env` 永不提交到 Git。
- `MASTER_KEY` 只保留在服务器环境变量或 `.env`（服务器本地）。
- 命令输出不再打印明文 cookie。
- 运行日志仅记录指标与错误，不写 token/cookie。
