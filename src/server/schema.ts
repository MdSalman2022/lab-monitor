import type { LabBeaconDatabase } from "./db";

export function initializeDatabase(db: LabBeaconDatabase) {
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
}

export function seedDefaultUsers(
  db: LabBeaconDatabase,
  names = [
    "Researcher 1",
    "Researcher 2",
    "Researcher 3",
    "Researcher 4",
    "Researcher 5",
  ],
) {
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO users (name, created_at)
    VALUES (@name, @createdAt)
  `);

  const seed = db.transaction(() => {
    for (const name of names) {
      insert.run({ name, createdAt: now });
    }
  });

  seed();
}
