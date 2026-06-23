import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db";
import { seedDefaultUsers } from "./schema";
import {
  checkUnclaimedCurrentSlot,
  createScheduleSlot,
  getCurrentScheduleSlot,
  timeToMinutes,
} from "./schedule";

const tempDirs: string[] = [];

function testDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-schedule-manager-"));
  tempDirs.push(dir);
  const db = openDatabase(path.join(dir, "test.sqlite"));
  seedDefaultUsers(db, ["A"]);
  return db;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("schedule", () => {
  it("parses HH:mm time strings into minutes", () => {
    expect(timeToMinutes("09:30")).toBe(570);
    expect(() => timeToMinutes("9:30")).toThrow("Time must use HH:mm format");
  });

  it("finds the active weekly schedule slot", () => {
    const db = testDb();
    createScheduleSlot(
      { userId: 1, dayOfWeek: 2, startTime: "10:00", endTime: "13:00" },
      db,
    );

    const slot = getCurrentScheduleSlot(
      new Date("2026-06-23T11:15:00"),
      db,
    );

    expect(slot?.userName).toBe("A");
    db.close();
  });

  it("creates one unclaimed event for a missed schedule start", () => {
    const db = testDb();
    createScheduleSlot(
      { userId: 1, dayOfWeek: 2, startTime: "10:00", endTime: "13:00" },
      db,
    );

    const first = checkUnclaimedCurrentSlot(
      new Date("2026-06-23T10:20:00"),
      db,
    );
    const second = checkUnclaimedCurrentSlot(
      new Date("2026-06-23T10:25:00"),
      db,
    );

    expect(first?.type).toBe("SLOT_UNCLAIMED");
    expect(second?.id).toBe(first?.id);
    db.close();
  });
});
