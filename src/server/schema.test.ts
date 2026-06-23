import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type LabScheduleManagerDatabase } from "./db";
import { seedDefaultUsers } from "./schema";

const tempDirs: string[] = [];

function testDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-schedule-manager-schema-"));
  tempDirs.push(dir);
  return openDatabase(path.join(dir, "test.sqlite"));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function close(db: LabScheduleManagerDatabase) {
  db.close();
}

describe("seedDefaultUsers", () => {
  it("renames legacy researcher rows in place and removes duplicate user rows", () => {
    const db = testDb();
    const createdAt = "2026-06-23T00:00:00.000Z";
    const insertUser = db.prepare(`
      INSERT INTO users (name, created_at)
      VALUES (?, ?)
    `);

    for (const name of [
      "Researcher 1",
      "Researcher 2",
      "Researcher 3",
      "Researcher 4",
      "Researcher 5",
    ]) {
      insertUser.run(name, createdAt);
    }

    const duplicate = insertUser.run("User 1", createdAt);
    const duplicateUserId = Number(duplicate.lastInsertRowid);

    db.prepare(`
      INSERT INTO sessions (
        user_id, status, started_at, last_checkin_at, ended_at, end_reason, created_at, updated_at
      )
      VALUES (?, 'ENDED', ?, ?, ?, 'manual', ?, ?)
    `).run(
      duplicateUserId,
      createdAt,
      createdAt,
      createdAt,
      createdAt,
      createdAt,
    );

    db.prepare(`
      INSERT INTO schedule_slots (
        user_id, day_of_week, start_time, end_time, created_at, updated_at
      )
      VALUES (?, 1, '00:00', '00:00', ?, ?)
    `).run(duplicateUserId, createdAt, createdAt);

    db.prepare(`
      INSERT INTO events (type, user_id, message, created_at)
      VALUES ('SESSION_CLAIMED', ?, 'Researcher 1 claimed the lab PC.', ?)
    `).run(duplicateUserId, createdAt);

    seedDefaultUsers(db, [
      "User 1",
      "User 2",
      "User 3",
      "User 4",
      "User 5",
    ]);

    const users = db
      .prepare("SELECT id, name FROM users ORDER BY id")
      .all() as Array<{ id: number; name: string }>;
    const migratedSession = db
      .prepare("SELECT user_id FROM sessions LIMIT 1")
      .get() as { user_id: number };
    const migratedScheduleSlot = db
      .prepare("SELECT user_id FROM schedule_slots LIMIT 1")
      .get() as { user_id: number };
    const migratedEvent = db
      .prepare("SELECT user_id, message FROM events LIMIT 1")
      .get() as { user_id: number; message: string };

    expect(users).toEqual([
      { id: 1, name: "User 1" },
      { id: 2, name: "User 2" },
      { id: 3, name: "User 3" },
      { id: 4, name: "User 4" },
      { id: 5, name: "User 5" },
    ]);
    expect(migratedSession.user_id).toBe(1);
    expect(migratedScheduleSlot.user_id).toBe(1);
    expect(migratedEvent).toEqual({
      user_id: 1,
      message: "User 1 claimed the lab PC.",
    });

    close(db);
  });

  it("keeps custom names on canonical user ids while removing duplicate default rows", () => {
    const db = testDb();
    const createdAt = "2026-06-23T00:00:00.000Z";
    const insertUser = db.prepare(`
      INSERT INTO users (name, created_at)
      VALUES (?, ?)
    `);

    for (const name of ["User 1", "Salman", "User 3", "User 4", "User 5"]) {
      insertUser.run(name, createdAt);
    }

    const duplicate = insertUser.run("User 2", createdAt);
    const duplicateUserId = Number(duplicate.lastInsertRowid);

    db.prepare(`
      INSERT INTO events (type, user_id, message, created_at)
      VALUES ('SESSION_CLAIMED', ?, 'Salman claimed the lab PC.', ?)
    `).run(duplicateUserId, createdAt);

    seedDefaultUsers(db, [
      "User 1",
      "User 2",
      "User 3",
      "User 4",
      "User 5",
    ]);

    const users = db
      .prepare("SELECT id, name FROM users ORDER BY id")
      .all() as Array<{ id: number; name: string }>;
    const migratedEvent = db
      .prepare("SELECT user_id, message FROM events LIMIT 1")
      .get() as { user_id: number; message: string };

    expect(users).toEqual([
      { id: 1, name: "User 1" },
      { id: 2, name: "Salman" },
      { id: 3, name: "User 3" },
      { id: 4, name: "User 4" },
      { id: 5, name: "User 5" },
    ]);
    expect(migratedEvent).toEqual({
      user_id: 2,
      message: "Salman claimed the lab PC.",
    });

    close(db);
  });
});
