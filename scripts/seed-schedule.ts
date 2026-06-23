import { appConfig } from "../src/server/config";
import { getDb } from "../src/server/db";
import { seedDefaultUsers } from "../src/server/schema";

const db = getDb();
const now = new Date().toISOString();

seedDefaultUsers(db, appConfig.defaultUsers);

const seedSchedule = db.transaction(() => {
  db.prepare(
    `
    UPDATE schedule_slots
    SET is_active = 0, updated_at = @now
    WHERE is_active = 1
  `,
  ).run({ now });

  const researcher2 = db
    .prepare("SELECT id FROM users WHERE name = ?")
    .get("Researcher 2") as { id: number } | undefined;

  if (!researcher2) {
    throw new Error("Researcher 2 was not found in the users table");
  }

  const insert = db.prepare(`
    INSERT INTO schedule_slots (
      user_id, day_of_week, start_time, end_time, created_at, updated_at
    )
    VALUES (@userId, @dayOfWeek, '00:00', '00:00', @now, @now)
  `);

  for (const dayOfWeek of [1, 2]) {
    insert.run({
      userId: researcher2.id,
      dayOfWeek,
      now,
    });
  }
});

seedSchedule();

console.log(
  "Seeded weekly schedule: Researcher 2 on Monday and Tuesday; all other days free.",
);
