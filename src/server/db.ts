import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { appConfig, ensureRuntimeDirs } from "./config";
import { initializeDatabase, seedDefaultUsers } from "./schema";

export type LabScheduleManagerDatabase = Database.Database;

let singleton: LabScheduleManagerDatabase | null = null;

export function openDatabase(dbPath = appConfig.databasePath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initializeDatabase(db);
  return db;
}

export function getDb() {
  if (!singleton) {
    ensureRuntimeDirs();
    singleton = openDatabase();
    seedDefaultUsers(singleton, appConfig.defaultUsers);
  }

  return singleton;
}

export function closeDb() {
  if (singleton) {
    singleton.close();
    singleton = null;
  }
}
