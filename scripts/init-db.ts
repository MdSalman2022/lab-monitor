import { getDb } from "../src/server/db";
import { seedDefaultUsers } from "../src/server/schema";
import { appConfig } from "../src/server/config";

const db = getDb();
seedDefaultUsers(db, appConfig.defaultUsers);
console.log(`Lab Schedule Manager database ready at ${appConfig.databasePath}`);
