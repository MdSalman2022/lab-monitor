import { getDb } from "../src/server/db";
import { seedDefaultUsers } from "../src/server/schema";
import { appConfig } from "../src/server/config";

seedDefaultUsers(getDb(), appConfig.defaultUsers);
console.log(`Seeded users: ${appConfig.defaultUsers.join(", ")}`);
