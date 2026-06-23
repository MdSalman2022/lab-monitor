import fs from "node:fs";
import path from "node:path";
import { staticConfig } from "./static-config";

const rootDir = process.cwd();

export const appConfig = {
  rootDir,
  dataDir: path.join(/*turbopackIgnore: true*/ rootDir, staticConfig.dataDirName),
  databasePath: path.join(
    /*turbopackIgnore: true*/ rootDir,
    staticConfig.dataDirName,
    staticConfig.databaseFileName,
  ),
  defaultUsers: [...staticConfig.users],
  checkinIntervalMinutes: staticConfig.timings.checkinIntervalMinutes,
  graceMinutes: staticConfig.timings.graceMinutes,
  confirmationWarningMinutes: staticConfig.timings.confirmationWarningMinutes,
  confirmationDangerMinutes: staticConfig.timings.confirmationDangerMinutes,
  gpuIdleThreshold: staticConfig.gpu.idleThreshold,
  gpuIdleWindowMinutes: staticConfig.timings.gpuIdleWindowMinutes,
  gpuBusyMinActiveRatio: staticConfig.gpu.busyMinActiveRatio,
  gpuBusyMinConsecutiveSamples: staticConfig.gpu.busyMinConsecutiveSamples,
  recentGpuSamplesLimit: staticConfig.gpu.recentSamplesLimit,
  mlProcessMinMemoryMb: staticConfig.gpu.mlProcessMinMemoryMb,
  mlProcessKeywords: [...staticConfig.gpu.mlProcessKeywords],
  pollSeconds: staticConfig.timings.pollSeconds,
  scheduleStartGraceMinutes: staticConfig.timings.scheduleStartGraceMinutes,
  telegramBotToken: staticConfig.telegram.botToken,
  telegramChatId: staticConfig.telegram.chatId,
  telegramDryRun: staticConfig.telegram.dryRun,
  nvidiaSmiPath: staticConfig.system.nvidiaSmiPath,
} as const;

export type AppConfig = typeof appConfig;

export function ensureRuntimeDirs(config: AppConfig = appConfig) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(path.join(/*turbopackIgnore: true*/ config.rootDir, "logs"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(/*turbopackIgnore: true*/ config.rootDir, "backups"), {
    recursive: true,
  });
}
