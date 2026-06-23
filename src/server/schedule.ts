import type { LabScheduleManagerDatabase } from "./db";
import { getDb } from "./db";
import { notFound, validationError } from "./errors";
import { recordEvent } from "./events";
import { appConfig, type AppConfig } from "./config";

export type ScheduleSlot = {
  id: number;
  userId: number;
  userName: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
};

type ScheduleRow = {
  id: number;
  user_id: number;
  user_name: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: number;
};

function mapSlot(row: ScheduleRow): ScheduleSlot {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
    isActive: row.is_active === 1,
  };
}

export function timeToMinutes(time: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) {
    throw validationError("Time must use HH:mm format");
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function isWithinSlot(minutes: number, start: number, end: number) {
  if (start === end) {
    return true;
  }

  if (start < end) {
    return minutes >= start && minutes < end;
  }

  return minutes >= start || minutes < end;
}

export function listScheduleSlots(db: LabScheduleManagerDatabase = getDb()) {
  const rows = db
    .prepare(
      `
      SELECT ss.*, u.name as user_name
      FROM schedule_slots ss
      JOIN users u ON u.id = ss.user_id
      WHERE ss.is_active = 1
      ORDER BY ss.day_of_week, ss.start_time
    `,
    )
    .all() as ScheduleRow[];

  return rows.map(mapSlot);
}

export function createScheduleSlot(
  input: {
    userId: number;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
  },
  db: LabScheduleManagerDatabase = getDb(),
) {
  timeToMinutes(input.startTime);
  timeToMinutes(input.endTime);
  if (input.dayOfWeek < 0 || input.dayOfWeek > 6) {
    throw validationError("Day of week must be between 0 and 6");
  }

  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      INSERT INTO schedule_slots (
        user_id, day_of_week, start_time, end_time, created_at, updated_at
      )
      VALUES (@userId, @dayOfWeek, @startTime, @endTime, @now, @now)
    `,
    )
    .run({ ...input, now });

  const slot = getScheduleSlot(Number(result.lastInsertRowid), db);
  return slot;
}

export function getScheduleSlot(
  slotId: number,
  db: LabScheduleManagerDatabase = getDb(),
) {
  const row = db
    .prepare(
      `
      SELECT ss.*, u.name as user_name
      FROM schedule_slots ss
      JOIN users u ON u.id = ss.user_id
      WHERE ss.id = ?
    `,
    )
    .get(slotId) as ScheduleRow | undefined;

  if (!row) {
    throw notFound("Schedule slot not found");
  }

  return mapSlot(row);
}

export function deleteScheduleSlot(
  slotId: number,
  db: LabScheduleManagerDatabase = getDb(),
) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      UPDATE schedule_slots
      SET is_active = 0, updated_at = @now
      WHERE id = @slotId
    `,
    )
    .run({ slotId, now });

  if (result.changes === 0) {
    throw notFound("Schedule slot not found");
  }
}

export function updateScheduleSlot(
  slotId: number,
  input: Partial<{
    userId: number;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    isActive: boolean;
  }>,
  db: LabScheduleManagerDatabase = getDb(),
) {
  const current = getScheduleSlot(slotId, db);
  const next = {
    userId: input.userId ?? current.userId,
    dayOfWeek: input.dayOfWeek ?? current.dayOfWeek,
    startTime: input.startTime ?? current.startTime,
    endTime: input.endTime ?? current.endTime,
    isActive: input.isActive ?? current.isActive,
  };

  timeToMinutes(next.startTime);
  timeToMinutes(next.endTime);
  if (next.dayOfWeek < 0 || next.dayOfWeek > 6) {
    throw validationError("Day of week must be between 0 and 6");
  }

  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE schedule_slots
    SET user_id = @userId,
        day_of_week = @dayOfWeek,
        start_time = @startTime,
        end_time = @endTime,
        is_active = @isActive,
        updated_at = @now
    WHERE id = @slotId
  `,
  ).run({
    slotId,
    userId: next.userId,
    dayOfWeek: next.dayOfWeek,
    startTime: next.startTime,
    endTime: next.endTime,
    isActive: next.isActive ? 1 : 0,
    now,
  });

  return getScheduleSlot(slotId, db);
}

export function getCurrentScheduleSlot(
  now = new Date(),
  db: LabScheduleManagerDatabase = getDb(),
) {
  const dayOfWeek = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const rows = db
    .prepare(
      `
      SELECT ss.*, u.name as user_name
      FROM schedule_slots ss
      JOIN users u ON u.id = ss.user_id
      WHERE ss.is_active = 1 AND ss.day_of_week = ?
      ORDER BY ss.start_time
    `,
    )
    .all(dayOfWeek) as ScheduleRow[];

  const current = rows.find((row) =>
    isWithinSlot(
      minutes,
      timeToMinutes(row.start_time),
      timeToMinutes(row.end_time),
    ),
  );

  return current ? mapSlot(current) : null;
}

export function checkUnclaimedCurrentSlot(
  now = new Date(),
  db: LabScheduleManagerDatabase = getDb(),
  config: AppConfig = appConfig,
) {
  const currentSlot = getCurrentScheduleSlot(now, db);
  if (!currentSlot) {
    return null;
  }

  const [hours, minutes] = currentSlot.startTime.split(":").map(Number);
  const slotStart = new Date(now);
  slotStart.setHours(hours, minutes, 0, 0);
  const alertAfter = new Date(
    slotStart.getTime() + config.scheduleStartGraceMinutes * 60_000,
  );

  if (now.getTime() < alertAfter.getTime()) {
    return null;
  }

  const session = db
    .prepare(
      `
      SELECT id
      FROM sessions
      WHERE user_id = @userId
        AND started_at >= @slotStart
      LIMIT 1
    `,
    )
    .get({
      userId: currentSlot.userId,
      slotStart: slotStart.toISOString(),
    });

  if (session) {
    return null;
  }

  const dateKey = slotStart.toISOString().slice(0, 10);
  return recordEvent(
    {
      type: "SLOT_UNCLAIMED",
      userId: currentSlot.userId,
      scheduleSlotId: currentSlot.id,
      dedupeKey: `slot-unclaimed:${currentSlot.id}:${dateKey}`,
      message: `${currentSlot.userName}'s scheduled slot has not been started.`,
      metadata: {
        slotStart: slotStart.toISOString(),
      },
    },
    db,
  );
}
