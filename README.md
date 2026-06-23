# LabBeacon

LabBeacon is a local-first Next.js PWA for tracking a shared Windows GPU lab PC. It serves a dashboard, stores sessions in SQLite, polls `nvidia-smi` from a separate Node worker, and sends Telegram alerts when a scheduled or active slot goes idle.

## Getting Started

Create local configuration:

```bash
copy .env.example .env.local
npm run db:init
```

Run the web app and worker in separate terminals:

```bash
npm run dev
npm run worker:dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production Build

```bash
npm run test
npm run typecheck
npm run lint
npm run build
npm run build:worker
```

The Next.js server is configured with standalone output. After building, the Windows services should run:

```text
LabBeaconWeb    -> node .next\standalone\server.js
LabBeaconWorker -> node dist-worker\src\worker\index.js
```

Install the services with NSSM after the build:

```powershell
.\scripts\install-windows-services.ps1
```

Cloudflare Tunnel should point to `http://localhost:3000`, with Cloudflare Access protecting the URL. The visible Edge/Chrome PWA can open at Windows logon, while the web server and worker start at boot through services.

## Environment

Key variables live in `.env.local`:

- `LAB_BEACON_USERS`: comma-separated list of the five users
- `LAB_BEACON_CHECKIN_INTERVAL_MINUTES`: default `180`
- `LAB_BEACON_GRACE_MINUTES`: default `15`
- `LAB_BEACON_GPU_IDLE_THRESHOLD`: default `10`
- `TELEGRAM_DRY_RUN`: default `true`
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`: required for real alerts

## Project Shape

```text
src/app        Next.js App Router pages and API routes
src/components PWA dashboard UI
src/server     SQLite, session rules, schedule, GPU, Telegram
src/worker     background monitor
scripts        DB and Windows service helpers
data           local SQLite runtime data
```

## References

- Installation: https://nextjs.org/docs/app/getting-started/installation.md
- PWA guide: https://nextjs.org/docs/app/guides/progressive-web-apps
- Route Handlers: https://nextjs.org/docs/app/getting-started/route-handlers
- Standalone output: https://nextjs.org/docs/app/api-reference/config/next-config-js/output
# lab-monitor
