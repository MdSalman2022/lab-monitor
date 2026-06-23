import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const rootDir = process.cwd();

dotenv.config({ path: path.join(rootDir, ".env.local"), quiet: true });
dotenv.config({ path: path.join(rootDir, ".env"), quiet: true });

function numberFromEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }

  return parsed;
}

function booleanFromEnv(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function namesFromEnv() {
  const raw = process.env.LAB_BEACON_USERS;
  if (!raw) {
    return [
      "Researcher 1",
      "Researcher 2",
      "Researcher 3",
      "Researcher 4",
      "Researcher 5",
    ];
  }

  return raw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

export const appConfig = {
  rootDir,
  dataDir: process.env.LAB_BEACON_DATA_DIR ?? path.join(rootDir, "data"),
  databasePath:
    process.env.LAB_BEACON_DB_PATH ??
    path.join(rootDir, "data", "lab-beacon.sqlite"),
  defaultUsers: namesFromEnv(),
  checkinIntervalMinutes: numberFromEnv(
    "LAB_BEACON_CHECKIN_INTERVAL_MINUTES",
    180,
  ),
  graceMinutes: numberFromEnv("LAB_BEACON_GRACE_MINUTES", 15),
  gpuIdleThreshold: numberFromEnv("LAB_BEACON_GPU_IDLE_THRESHOLD", 10),
  gpuIdleWindowMinutes: numberFromEnv("LAB_BEACON_GPU_IDLE_WINDOW_MINUTES", 10),
  gpuBusyMinActiveRatio: numberFromEnv(
    "LAB_BEACON_GPU_BUSY_MIN_ACTIVE_RATIO",
    0.6,
  ),
  gpuBusyMinConsecutiveSamples: numberFromEnv(
    "LAB_BEACON_GPU_BUSY_MIN_CONSECUTIVE_SAMPLES",
    3,
  ),
  pollSeconds: numberFromEnv("LAB_BEACON_POLL_SECONDS", 60),
  scheduleStartGraceMinutes: numberFromEnv(
    "LAB_BEACON_SCHEDULE_START_GRACE_MINUTES",
    15,
  ),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
  telegramDryRun: booleanFromEnv("TELEGRAM_DRY_RUN", true),
  nvidiaSmiPath: process.env.NVIDIA_SMI_PATH ?? "nvidia-smi",
};

export type AppConfig = typeof appConfig;

export function ensureRuntimeDirs(config: AppConfig = appConfig) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(path.join(config.rootDir, "logs"), { recursive: true });
  fs.mkdirSync(path.join(config.rootDir, "backups"), { recursive: true });
}
