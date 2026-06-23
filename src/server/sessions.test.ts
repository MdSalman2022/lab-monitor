import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LabBeaconDatabase } from "./db";
import { openDatabase } from "./db";
import { seedDefaultUsers } from "./schema";
import {
  checkInSession,
  evaluateOpenSessions,
  getOpenSession,
  startSession,
} from "./sessions";

const tempDirs: string[] = [];

function testDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-beacon-"));
  tempDirs.push(dir);
  const db = openDatabase(path.join(dir, "test.sqlite"));
  seedDefaultUsers(db, ["A", "B"]);
  return db;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function close(db: LabBeaconDatabase) {
  db.close();
}

describe("sessions", () => {
  it("starts one active session and rejects a second open session", () => {
    const db = testDb();
    const started = startSession(1, new Date("2026-06-23T00:00:00.000Z"), db);

    expect(started.status).toBe("ACTIVE");
    expect(started.userName).toBe("A");
    expect(() =>
      startSession(2, new Date("2026-06-23T00:01:00.000Z"), db),
    ).toThrow("A is already using the lab PC");
    close(db);
  });

  it("marks an overdue session as needing confirmation while the GPU is busy", () => {
    const db = testDb();
    startSession(1, new Date("2026-06-23T00:00:00.000Z"), db);

    const events = evaluateOpenSessions(
      {
        now: new Date("2026-06-23T03:16:00.000Z"),
        gpuActivity: {
          averageUtil: 75,
          activeSampleRatio: 1,
          consecutiveActiveSamples: 5,
          isSustained: true,
          threshold: 10,
          windowMinutes: 10,
        },
      },
      db,
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("SESSION_NEEDS_CONFIRMATION");
    expect(getOpenSession(db)?.status).toBe("NEEDS_CONFIRMATION");
    close(db);
  });

  it("marks an overdue session inactive when GPU average is below threshold", () => {
    const db = testDb();
    startSession(1, new Date("2026-06-23T00:00:00.000Z"), db);

    const events = evaluateOpenSessions(
      {
        now: new Date("2026-06-23T03:16:00.000Z"),
        gpuActivity: {
          averageUtil: 3,
          activeSampleRatio: 0.2,
          consecutiveActiveSamples: 1,
          isSustained: false,
          threshold: 10,
          windowMinutes: 10,
        },
      },
      db,
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("SESSION_INACTIVE");
    expect(getOpenSession(db)).toBeNull();
    close(db);
  });

  it("check-in restores an overdue protected session to active", () => {
    const db = testDb();
    const started = startSession(
      1,
      new Date("2026-06-23T00:00:00.000Z"),
      db,
    );
    evaluateOpenSessions(
      {
        now: new Date("2026-06-23T03:16:00.000Z"),
        gpuActivity: {
          averageUtil: 40,
          activeSampleRatio: 0.8,
          consecutiveActiveSamples: 4,
          isSustained: true,
          threshold: 10,
          windowMinutes: 10,
        },
      },
      db,
    );

    const checkedIn = checkInSession(
      started.id,
      new Date("2026-06-23T03:20:00.000Z"),
      db,
    );

    expect(checkedIn.status).toBe("ACTIVE");
    expect(checkedIn.lastCheckinAt).toBe("2026-06-23T03:20:00.000Z");
    close(db);
  });

  it("marks a spike-only overdue session inactive even if one sample crosses the threshold", () => {
    const db = testDb();
    startSession(1, new Date("2026-06-23T00:00:00.000Z"), db);

    const events = evaluateOpenSessions(
      {
        now: new Date("2026-06-23T03:16:00.000Z"),
        gpuActivity: {
          averageUtil: 14,
          activeSampleRatio: 0.17,
          consecutiveActiveSamples: 1,
          isSustained: false,
          threshold: 10,
          windowMinutes: 10,
        },
      },
      db,
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("SESSION_INACTIVE");
    expect(getOpenSession(db)).toBeNull();
    close(db);
  });
});
