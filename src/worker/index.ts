import { appConfig } from "../server/config";
import { getDb } from "../server/db";
import type { EventRecord } from "../server/events";
import {
  getGpuActivitySummary,
  getGpuAverage,
  insertGpuSample,
  readGpuViaNvidiaSmi,
} from "../server/gpu";
import { checkUnclaimedCurrentSlot } from "../server/schedule";
import { evaluateOpenSessions } from "../server/sessions";
import { sendTelegramMessage } from "../server/telegram";

function formatAlert(event: EventRecord) {
  switch (event.type) {
    case "SESSION_INACTIVE":
      return `LabBeacon: ${event.message} Slot is free to claim.`;
    case "SLOT_UNCLAIMED":
      return `LabBeacon: ${event.message}`;
    case "SESSION_CLAIMED":
    case "SESSION_STARTED":
    case "SESSION_ENDED":
      return `LabBeacon: ${event.message}`;
    default:
      return null;
  }
}

export async function runWorkerOnce(now = new Date()) {
  const db = getDb();
  try {
    const gpu = await readGpuViaNvidiaSmi();
    insertGpuSample({ ...gpu, sampledAt: now }, db);
  } catch (error) {
    console.error("[LabBeacon] GPU sample failed", error);
  }

  const gpuAverage = getGpuAverage(now, appConfig.gpuIdleWindowMinutes, db);
  const gpuActivity = getGpuActivitySummary(now, undefined, db);
  const sessionEvents = evaluateOpenSessions(
    { now, gpuActivity },
    db,
  );
  const scheduleEvent = checkUnclaimedCurrentSlot(now, db);
  const events = [...sessionEvents, scheduleEvent].filter(
    (event): event is EventRecord => Boolean(event),
  );

  for (const event of events) {
    const alert = formatAlert(event);
    if (alert) {
      await sendTelegramMessage(alert);
    }
  }

  return {
    gpuAverage,
    events,
  };
}

export function startWorker() {
  console.log(
    `[LabBeacon] Worker started. Polling every ${appConfig.pollSeconds}s.`,
  );
  void runWorkerOnce();
  const interval = setInterval(() => {
    void runWorkerOnce();
  }, appConfig.pollSeconds * 1000);

  const stop = () => {
    clearInterval(interval);
    console.log("[LabBeacon] Worker stopped.");
    process.exit(0);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (process.env.NODE_ENV !== "test") {
  startWorker();
}
