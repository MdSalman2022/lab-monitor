import { getDb } from "../src/server/db";
import { seedDefaultUsers } from "../src/server/schema";
import { appConfig } from "../src/server/config";

const db = getDb();
seedDefaultUsers(db, appConfig.defaultUsers);
console.log(`LabBeacon database ready at ${appConfig.databasePath}`);
