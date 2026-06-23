process.env.TZ = "Asia/Dhaka";

import fs from "node:fs";
import path from "node:path";
import { appConfig } from "../server/config";
import { getDb } from "../server/db";
import type { EventRecord } from "../server/events";
import {
  getGpuActivitySummary,
  getGpuAverage,
  getGpuMlActivitySummary,
  insertGpuSample,
  readGpuViaNvidiaSmi,
  sampleGpuProcessesNow,
} from "../server/gpu";
import { checkUnclaimedCurrentSlot } from "../server/schedule";
import { evaluateOpenSessions } from "../server/sessions";
import { sendTelegramMessage } from "../server/telegram";

function formatAlert(event: EventRecord) {
  switch (event.type) {
    case "SESSION_INACTIVE":
      return `Lab Schedule Manager: ${event.message} Slot is free to claim.`;
    case "SLOT_UNCLAIMED":
      return `Lab Schedule Manager: ${event.message}`;
    case "SESSION_CLAIMED":
    case "SESSION_STARTED":
    case "SESSION_ENDED":
      return `Lab Schedule Manager: ${event.message}`;
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
    console.error("[Lab Schedule Manager] GPU sample failed", error);
  }

  try {
    await sampleGpuProcessesNow(db, now);
  } catch (error) {
    console.error("[Lab Schedule Manager] GPU process sample failed", error);
  }

  const gpuAverage = getGpuAverage(now, appConfig.gpuIdleWindowMinutes, db);
  const gpuActivity = getGpuActivitySummary(now, undefined, db);
  const mlActivity = getGpuMlActivitySummary(
    now,
    appConfig.gpuIdleWindowMinutes,
    db,
  );
  const sessionEvents = evaluateOpenSessions(
    { now, gpuActivity, mlActivity },
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

let tunnelUrlSent = false;

async function sendTunnelUrlToTelegram() {
  if (tunnelUrlSent) {
    return;
  }

  const tunnelUrlPath = path.join(appConfig.rootDir, "tunnel-url.txt");
  try {
    if (fs.existsSync(tunnelUrlPath)) {
      const url = fs.readFileSync(tunnelUrlPath, "utf-8").trim();
      if (url) {
        const result = await sendTelegramMessage(
          `🚀 Lab Monitor is live\n\n${url}`,
        );
        if (result.sent) {
          tunnelUrlSent = true;
          console.log("[Lab Schedule Manager] Tunnel URL sent to Telegram");
        } else {
          console.log(
            `[Lab Schedule Manager] Telegram not sent: ${result.reason}`,
          );
          tunnelUrlSent = true; // don't retry if it's a config issue
        }
      }
    }
  } catch (error) {
    console.error("[Lab Schedule Manager] Failed to read tunnel URL", error);
  }
}

export function startWorker() {
  console.log(
    `[Lab Schedule Manager] Worker started. Polling every ${appConfig.pollSeconds}s.`,
  );
  void runWorkerOnce();
  const interval = setInterval(() => {
    void runWorkerOnce();
  }, appConfig.pollSeconds * 1000);

  // Try sending tunnel URL after a delay so the tunnel has time to start
  setTimeout(() => {
    void sendTunnelUrlToTelegram();
  }, 20_000);

  const stop = () => {
    clearInterval(interval);
    console.log("[Lab Schedule Manager] Worker stopped.");
    process.exit(0);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (process.env.NODE_ENV !== "test") {
  startWorker();
}
