import { appConfig, type AppConfig } from "./config";
import type { LabScheduleManagerDatabase } from "./db";
import { getDb } from "./db";
import { conflict, notFound } from "./errors";
import { recordEvent, type EventRecord } from "./events";
import type { GpuMlActivitySummary } from "./gpu";

export type SessionStatus =
  | "ACTIVE"
  | "NEEDS_CONFIRMATION"
  | "INACTIVE"
  | "ENDED";

export type UserRecord = {
  id: number;
  name: string;
  isActive: boolean;
};

export type SessionRecord = {
  id: number;
  userId: number;
  userName: string;
  status: SessionStatus;
  startedAt: string;
  lastCheckinAt: string;
  endedAt: string | null;
  endReason: string | null;
  claimedFromSessionId: number | null;
  nextCheckinDueAt: string;
  overdueAt: string;
};

type UserRow = {
  id: number;
  name: string;
  telegram_tag: string | null;
  is_active: number;
};

type SessionRow = {
  id: number;
  user_id: number;
  user_name: string;
  status: SessionStatus;
  started_at: string;
  last_checkin_at: string;
  ended_at: string | null;
  end_reason: string | null;
  claimed_from_session_id: number | null;
};

function iso(date: Date) {
  return date.toISOString();
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active === 1,
  };
}

function addMinutes(isoDate: string, minutes: number) {
  return new Date(new Date(isoDate).getTime() + minutes * 60_000).toISOString();
}

function mapSession(
  row: SessionRow,
  config: AppConfig = appConfig,
): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    status: row.status,
    startedAt: row.started_at,
    lastCheckinAt: row.last_checkin_at,
    endedAt: row.ended_at,
    endReason: row.end_reason,
    claimedFromSessionId: row.claimed_from_session_id,
    nextCheckinDueAt: addMinutes(
      row.last_checkin_at,
      config.checkinIntervalMinutes,
    ),
    overdueAt: addMinutes(
      row.last_checkin_at,
      config.checkinIntervalMinutes + config.graceMinutes,
    ),
  };
}

export function listUsers(db: LabScheduleManagerDatabase = getDb()) {
  const rows = db
    .prepare("SELECT * FROM users WHERE is_active = 1 ORDER BY id")
    .all() as UserRow[];

  return rows.map(mapUser);
}

export function createUser(
  input: { name: string },
  db: LabScheduleManagerDatabase = getDb(),
) {
  const name = input.name.trim();
  if (!name) {
    throw conflict("Name is required");
  }

  const existing = db
    .prepare("SELECT id FROM users WHERE name = ? AND is_active = 1")
    .get(name) as { id: number } | undefined;

  if (existing) {
    throw conflict("A researcher with that name already exists");
  }

  const result = db
    .prepare(
      `
      INSERT INTO users (name, is_active, created_at)
      VALUES (@name, 1, @createdAt)
    `,
    )
    .run({ name, createdAt: new Date().toISOString() });

  const newId = Number(result.lastInsertRowid);
  return getUser(newId, db);
}

export function getUser(userId: number, db: LabScheduleManagerDatabase = getDb()) {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as
    | UserRow
    | undefined;

  if (!row || row.is_active !== 1) {
    throw notFound("User not found");
  }

  return mapUser(row);
}

export function updateUser(
  userId: number,
  input: Partial<{
    name: string;
  }>,
  db: LabScheduleManagerDatabase = getDb(),
) {
  const current = getUser(userId, db);
  const next = {
    name: input.name ?? current.name,
  };

  try {
    db.prepare(
      `
      UPDATE users
      SET name = @name
      WHERE id = @userId AND is_active = 1
    `,
    ).run({
      userId,
      name: next.name,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("unique")
    ) {
      throw conflict("A researcher with that name already exists");
    }

    throw error;
  }

  return getUser(userId, db);
}

export function getOpenSession(db: LabScheduleManagerDatabase = getDb()) {
  const row = db
    .prepare(
      `
      SELECT s.*, u.name as user_name
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.status IN ('ACTIVE', 'NEEDS_CONFIRMATION')
      ORDER BY datetime(s.started_at) DESC
      LIMIT 1
    `,
    )
    .get() as SessionRow | undefined;

  return row ? mapSession(row) : null;
}

export function getSessionById(
  sessionId: number,
  db: LabScheduleManagerDatabase = getDb(),
) {
  const row = db
    .prepare(
      `
      SELECT s.*, u.name as user_name
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ?
    `,
    )
    .get(sessionId) as SessionRow | undefined;

  if (!row) {
    throw notFound("Session not found");
  }

  return mapSession(row);
}

export function startSession(
  userId: number,
  now = new Date(),
  db: LabScheduleManagerDatabase = getDb(),
) {
  return db.transaction(() => {
    const user = getUser(userId, db);
    const openSession = getOpenSession(db);
    if (openSession) {
      throw conflict(`${openSession.userName} is already using the lab PC`);
    }

    const startedAt = iso(now);
    const result = db
      .prepare(
        `
        INSERT INTO sessions (
          user_id, status, started_at, last_checkin_at, created_at, updated_at
        )
        VALUES (@userId, 'ACTIVE', @startedAt, @startedAt, @startedAt, @startedAt)
      `,
      )
      .run({ userId, startedAt });

    const session = getSessionById(Number(result.lastInsertRowid), db);
    recordEvent(
      {
        type: "SESSION_STARTED",
        userId: user.id,
        sessionId: session.id,
        message: `${user.name} started a Lab Schedule Manager session.`,
      },
      db,
    );

    return session;
  })();
}

export function checkInSession(
  sessionId: number,
  now = new Date(),
  db: LabScheduleManagerDatabase = getDb(),
) {
  return db.transaction(() => {
    const session = getSessionById(sessionId, db);
    if (!["ACTIVE", "NEEDS_CONFIRMATION"].includes(session.status)) {
      throw conflict("Only an active session can be checked in");
    }

    const checkedAt = iso(now);
    db.prepare(
      `
      UPDATE sessions
      SET status = 'ACTIVE', last_checkin_at = @checkedAt, updated_at = @checkedAt
      WHERE id = @sessionId
    `,
    ).run({ checkedAt, sessionId });

    const updated = getSessionById(sessionId, db);
    recordEvent(
      {
        type: "SESSION_CHECKED_IN",
        userId: updated.userId,
        sessionId: updated.id,
        message: `${updated.userName} confirmed they are still working.`,
      },
      db,
    );
    return updated;
  })();
}

export function endSession(
  sessionId: number,
  now = new Date(),
  db: LabScheduleManagerDatabase = getDb(),
) {
  return db.transaction(() => {
    const session = getSessionById(sessionId, db);
    if (session.status === "ENDED") {
      return session;
    }

    const endedAt = iso(now);
    db.prepare(
      `
      UPDATE sessions
      SET status = 'ENDED', ended_at = @endedAt, end_reason = 'manual', updated_at = @endedAt
      WHERE id = @sessionId
    `,
    ).run({ endedAt, sessionId });

    const updated = getSessionById(sessionId, db);
    recordEvent(
      {
        type: "SESSION_ENDED",
        userId: updated.userId,
        sessionId: updated.id,
        message: `${updated.userName} ended their Lab Schedule Manager session.`,
      },
      db,
    );
    return updated;
  })();
}

export function claimSession(
  userId: number,
  now = new Date(),
  db: LabScheduleManagerDatabase = getDb(),
) {
  return db.transaction(() => {
    const user = getUser(userId, db);
    const openSession = getOpenSession(db);
    if (openSession) {
      throw conflict(`${openSession.userName} is still active`);
    }

    const previousInactive = db
      .prepare(
        `
        SELECT s.*, u.name as user_name
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.status = 'INACTIVE'
        ORDER BY datetime(s.ended_at) DESC, s.id DESC
        LIMIT 1
      `,
      )
      .get() as SessionRow | undefined;

    const startedAt = iso(now);
    const result = db
      .prepare(
        `
        INSERT INTO sessions (
          user_id, status, started_at, last_checkin_at, claimed_from_session_id, created_at, updated_at
        )
        VALUES (
          @userId, 'ACTIVE', @startedAt, @startedAt, @claimedFromSessionId, @startedAt, @startedAt
        )
      `,
      )
      .run({
        userId,
        startedAt,
        claimedFromSessionId: previousInactive?.id ?? null,
      });

    const session = getSessionById(Number(result.lastInsertRowid), db);
    recordEvent(
      {
        type: "SESSION_CLAIMED",
        userId: user.id,
        sessionId: session.id,
        message: `${user.name} claimed the lab PC.`,
        metadata: {
          claimedFromSessionId: previousInactive?.id ?? null,
        },
      },
      db,
    );

    return session;
  })();
}

export function evaluateOpenSessions(
  params: {
    now?: Date;
    gpuActivity: {
      averageUtil: number | null;
      activeSampleRatio: number;
      consecutiveActiveSamples: number;
      isSustained: boolean;
      threshold: number;
      windowMinutes: number;
    };
    mlActivity?: GpuMlActivitySummary;
    config?: AppConfig;
  },
  db: LabScheduleManagerDatabase = getDb(),
) {
  const now = params.now ?? new Date();
  const config = params.config ?? appConfig;
  const openSession = getOpenSession(db);
  const events: EventRecord[] = [];

  if (!openSession) {
    return events;
  }

  const overdueAt = new Date(openSession.overdueAt);
  if (now.getTime() <= overdueAt.getTime()) {
    return events;
  }

  const nowIso = iso(now);
  const isProtectedByWorkload =
    params.gpuActivity.isSustained ||
    Boolean(params.mlActivity?.isLikelyMlWorkload);

  if (!isProtectedByWorkload) {
    db.prepare(
      `
      UPDATE sessions
      SET status = 'INACTIVE',
          ended_at = @nowIso,
          end_reason = 'no_checkin_gpu_idle',
          updated_at = @nowIso
      WHERE id = @sessionId
    `,
    ).run({ nowIso, sessionId: openSession.id });

    events.push(
      recordEvent(
        {
          type: "SESSION_INACTIVE",
          userId: openSession.userId,
          sessionId: openSession.id,
          message: `${openSession.userName} missed check-in and sustained GPU or ML/DL activity was not detected.`,
          metadata: {
            gpuActivity: params.gpuActivity,
            mlActivity: params.mlActivity ?? null,
          },
        },
        db,
      ),
    );
    return events;
  }

  if (openSession.status === "ACTIVE") {
    if (params.mlActivity?.isLikelyMlWorkload) {
      db.prepare(
        `
        UPDATE sessions
        SET status = 'ACTIVE',
            last_checkin_at = @nowIso,
            updated_at = @nowIso
        WHERE id = @sessionId
      `,
      ).run({ nowIso, sessionId: openSession.id });

      events.push(
        recordEvent(
          {
            type: "SESSION_AUTO_RENEWED",
            userId: openSession.userId,
            sessionId: openSession.id,
            message: `${openSession.userName} missed check-in, but an ML/DL GPU process is still running. Session was auto-renewed.`,
            metadata: {
              gpuActivity: params.gpuActivity,
              mlActivity: params.mlActivity ?? null,
            },
          },
          db,
        ),
      );
      return events;
    }

    db.prepare(
      `
      UPDATE sessions
      SET status = 'NEEDS_CONFIRMATION', updated_at = @nowIso
      WHERE id = @sessionId
    `,
    ).run({ nowIso, sessionId: openSession.id });

    events.push(
      recordEvent(
        {
          type: "SESSION_NEEDS_CONFIRMATION",
          userId: openSession.userId,
          sessionId: openSession.id,
          message: `${openSession.userName} needs to confirm, but sustained GPU activity is still running.`,
          metadata: {
            gpuActivity: params.gpuActivity,
            mlActivity: params.mlActivity ?? null,
          },
        },
        db,
      ),
    );
  }

  return events;
}

export function listSessionsForDay(
  date: string,
  db: LabScheduleManagerDatabase = getDb(),
) {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60_000);
  const rows = db
    .prepare(
      `
      SELECT s.*, u.name as user_name
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.started_at >= @start AND s.started_at < @end
      ORDER BY datetime(s.started_at) ASC
    `,
    )
    .all({ start: iso(start), end: iso(end) }) as SessionRow[];

  return rows.map((row) => mapSession(row));
}
