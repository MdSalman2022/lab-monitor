import type { LabScheduleManagerDatabase } from "./db";
import { getDb } from "./db";

export type EventType =
  | "SESSION_STARTED"
  | "SESSION_CHECKED_IN"
  | "SESSION_ENDED"
  | "SESSION_INACTIVE"
  | "SESSION_NEEDS_CONFIRMATION"
  | "SESSION_CLAIMED"
  | "SESSION_AUTO_RENEWED"
  | "SLOT_UNCLAIMED"
  | "TELEGRAM_TEST";

export type EventRecord = {
  id: number;
  type: EventType;
  userId: number | null;
  sessionId: number | null;
  scheduleSlotId: number | null;
  dedupeKey: string | null;
  message: string;
  metadata: string | null;
  createdAt: string;
};

type EventInput = {
  type: EventType;
  message: string;
  userId?: number | null;
  sessionId?: number | null;
  scheduleSlotId?: number | null;
  dedupeKey?: string | null;
  metadata?: unknown;
};

type EventRow = {
  id: number;
  type: EventType;
  user_id: number | null;
  session_id: number | null;
  schedule_slot_id: number | null;
  dedupe_key: string | null;
  message: string;
  metadata: string | null;
  created_at: string;
};

function mapEvent(row: EventRow): EventRecord {
  return {
    id: row.id,
    type: row.type,
    userId: row.user_id,
    sessionId: row.session_id,
    scheduleSlotId: row.schedule_slot_id,
    dedupeKey: row.dedupe_key,
    message: row.message,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

export function recordEvent(input: EventInput, db: LabScheduleManagerDatabase = getDb()) {
  const createdAt = new Date().toISOString();
  const metadata =
    input.metadata === undefined ? null : JSON.stringify(input.metadata);

  db.prepare(`
    INSERT OR IGNORE INTO events (
      type, user_id, session_id, schedule_slot_id, dedupe_key, message, metadata, created_at
    )
    VALUES (
      @type, @userId, @sessionId, @scheduleSlotId, @dedupeKey, @message, @metadata, @createdAt
    )
  `).run({
    type: input.type,
    userId: input.userId ?? null,
    sessionId: input.sessionId ?? null,
    scheduleSlotId: input.scheduleSlotId ?? null,
    dedupeKey: input.dedupeKey ?? null,
    message: input.message,
    metadata,
    createdAt,
  });

  const row = input.dedupeKey
    ? db
        .prepare("SELECT * FROM events WHERE dedupe_key = ?")
        .get(input.dedupeKey)
    : db.prepare("SELECT * FROM events WHERE id = last_insert_rowid()").get();

  return mapEvent(row as EventRow);
}

export function listRecentEvents(
  limit = 20,
  db: LabScheduleManagerDatabase = getDb(),
) {
  const rows = db
    .prepare(
      "SELECT * FROM events ORDER BY datetime(created_at) DESC, id DESC LIMIT ?",
    )
    .all(limit) as EventRow[];

  return rows.map(mapEvent);
}
