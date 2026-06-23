import type { LabScheduleManagerDatabase } from "./db";

type UserIdRow = {
  id: number;
};

type UserNameRow = UserIdRow & {
  name: string;
};

const legacyDefaultUsers = [
  "Researcher 1",
  "Researcher 2",
  "Researcher 3",
  "Researcher 4",
  "Researcher 5",
] as const;

export function initializeDatabase(db: LabScheduleManagerDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      telegram_tag TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'NEEDS_CONFIRMATION', 'INACTIVE', 'ENDED')),
      started_at TEXT NOT NULL,
      last_checkin_at TEXT NOT NULL,
      ended_at TEXT,
      end_reason TEXT,
      claimed_from_session_id INTEGER REFERENCES sessions(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_one_open
      ON sessions((1))
      WHERE status IN ('ACTIVE', 'NEEDS_CONFIRMATION');

    CREATE TABLE IF NOT EXISTS schedule_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gpu_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sampled_at TEXT NOT NULL,
      gpu_util INTEGER NOT NULL,
      memory_used_mb INTEGER NOT NULL,
      memory_total_mb INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'nvidia-smi'
    );

    CREATE INDEX IF NOT EXISTS idx_gpu_samples_sampled_at
      ON gpu_samples(sampled_at);

    CREATE TABLE IF NOT EXISTS gpu_process_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sampled_at TEXT NOT NULL,
      pid INTEGER NOT NULL,
      process_name TEXT NOT NULL,
      command_line TEXT,
      used_memory_mb INTEGER NOT NULL,
      is_python INTEGER NOT NULL DEFAULT 0,
      is_likely_ml INTEGER NOT NULL DEFAULT 0,
      detection_reason TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'nvidia-smi'
    );

    CREATE INDEX IF NOT EXISTS idx_gpu_process_samples_sampled_at
      ON gpu_process_samples(sampled_at);

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id),
      session_id INTEGER REFERENCES sessions(id),
      schedule_slot_id INTEGER REFERENCES schedule_slots(id),
      dedupe_key TEXT UNIQUE,
      message TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_created_at
      ON events(created_at);
  `);

  const gpuColumns = db
    .prepare("PRAGMA table_info(gpu_samples)")
    .all() as Array<{ name: string }>;

  if (!gpuColumns.some((column) => column.name === "memory_total_mb")) {
    db.exec(
      "ALTER TABLE gpu_samples ADD COLUMN memory_total_mb INTEGER NOT NULL DEFAULT 0",
    );
  }

  db.exec(`
    UPDATE events
    SET message = REPLACE(message, 'LabBeacon', 'Lab Schedule Manager')
    WHERE instr(message, 'LabBeacon') > 0;
  `);
}

export function seedDefaultUsers(
  db: LabScheduleManagerDatabase,
  names: readonly string[] = [
    "User 1",
    "User 2",
    "User 3",
    "User 4",
    "User 5",
  ],
) {
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO users (name, created_at)
    VALUES (@name, @createdAt)
  `);
  const renameById = db.prepare(`
    UPDATE users
    SET name = @nextName, telegram_tag = NULL
    WHERE id = @userId
  `);
  const findByName = db.prepare("SELECT id, name FROM users WHERE name = ?") as {
    get(name: string): UserNameRow | undefined;
  };
  const findById = db.prepare("SELECT id, name FROM users WHERE id = ?") as {
    get(id: number): UserNameRow | undefined;
  };
  const migrateSessions = db.prepare(`
    UPDATE sessions
    SET user_id = @targetUserId
    WHERE user_id = @sourceUserId
  `);
  const migrateScheduleSlots = db.prepare(`
    UPDATE schedule_slots
    SET user_id = @targetUserId
    WHERE user_id = @sourceUserId
  `);
  const migrateEvents = db.prepare(`
    UPDATE events
    SET user_id = @targetUserId
    WHERE user_id = @sourceUserId
  `);
  const rewriteEventMessages = db.prepare(`
    UPDATE events
    SET message = REPLACE(message, @legacyName, @nextName)
    WHERE instr(message, @legacyName) > 0
  `);
  const deleteById = db.prepare("DELETE FROM users WHERE id = @userId");

  const seed = db.transaction(() => {
    const usesCanonicalDefaultNames =
      names.length === legacyDefaultUsers.length &&
      names.every((name, index) => name === `User ${index + 1}`);

    if (usesCanonicalDefaultNames) {
      for (let index = 0; index < legacyDefaultUsers.length; index += 1) {
        const legacyName = legacyDefaultUsers[index];
        const nextName = names[index];
        const canonicalUser = findById.get(index + 1) as
          | UserNameRow
          | undefined;
        const legacyUser = findByName.get(legacyName);
        const nextUser = findByName.get(nextName);
        const userToKeep = legacyUser ?? canonicalUser;

        if (userToKeep && nextUser && userToKeep.id !== nextUser.id) {
          migrateSessions.run({
            sourceUserId: nextUser.id,
            targetUserId: userToKeep.id,
          });
          migrateScheduleSlots.run({
            sourceUserId: nextUser.id,
            targetUserId: userToKeep.id,
          });
          migrateEvents.run({
            sourceUserId: nextUser.id,
            targetUserId: userToKeep.id,
          });
          deleteById.run({ userId: nextUser.id });
          if (legacyUser) {
            renameById.run({ userId: userToKeep.id, nextName });
          }
        } else if (
          legacyUser &&
          userToKeep &&
          userToKeep.name !== nextName
        ) {
          renameById.run({ userId: userToKeep.id, nextName });
        }

        rewriteEventMessages.run({ legacyName, nextName });
        if (
          legacyUser &&
          userToKeep?.name &&
          userToKeep.name !== legacyName
        ) {
          rewriteEventMessages.run({
            legacyName: userToKeep.name,
            nextName,
          });
        }
      }
    }

    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      if (
        usesCanonicalDefaultNames &&
        (findById.get(index + 1) || findByName.get(name))
      ) {
        continue;
      }

      insert.run({ name, createdAt: now });
    }
  });

  seed();
}
