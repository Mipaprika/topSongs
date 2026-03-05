# top-songs

Daily AI recommendation service for Netease playlist updates using long-term and short-term preference signals.

## Setup

```bash
npm install
cp .env.example .env
```

## Commands

```bash
npm test
npm run typecheck
node dist/index.js --help
```

## Workflow

1. Run `bootstrap-login` once for Netease auth.
2. Run `douban-sync` once for baseline preference import.
3. Schedule `run-once` daily on a server.
