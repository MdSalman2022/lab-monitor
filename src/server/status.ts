import { appConfig } from "./config";
import type { LabBeaconDatabase } from "./db";
import { getDb } from "./db";
import { listRecentEvents } from "./events";
import {
  getGpuActivitySummary,
  getGpuAverage,
  getLatestGpuSample,
  listRecentGpuSamples,
} from "./gpu";
import { getCurrentScheduleSlot, listScheduleSlots } from "./schedule";
import { getOpenSession, listSessionsForDay, listUsers } from "./sessions";

function todayKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDashboardStatus(
  now = new Date(),
  db: LabBeaconDatabase = getDb(),
) {
  const gpuAverage = getGpuAverage(now, appConfig.gpuIdleWindowMinutes, db);
  const gpuActivity = getGpuActivitySummary(now, undefined, db);

  return {
    now: now.toISOString(),
    config: {
      checkinIntervalMinutes: appConfig.checkinIntervalMinutes,
      graceMinutes: appConfig.graceMinutes,
      gpuIdleThreshold: appConfig.gpuIdleThreshold,
      gpuIdleWindowMinutes: appConfig.gpuIdleWindowMinutes,
      gpuBusyMinActiveRatio: appConfig.gpuBusyMinActiveRatio,
      gpuBusyMinConsecutiveSamples: appConfig.gpuBusyMinConsecutiveSamples,
      pollSeconds: appConfig.pollSeconds,
    },
    users: listUsers(db),
    openSession: getOpenSession(db),
    gpu: {
      latest: getLatestGpuSample(db),
      recent: listRecentGpuSamples(28, db),
      average: gpuAverage,
      activity: gpuActivity,
      isIdle: gpuActivity.sampleCount === 0 ? null : !gpuActivity.isSustained,
    },
    schedule: {
      current: getCurrentScheduleSlot(now, db),
      slots: listScheduleSlots(db),
    },
    today: {
      date: todayKey(now),
      sessions: listSessionsForDay(todayKey(now), db),
    },
    events: listRecentEvents(12, db),
  };
}
