// Runtime-safe migration runner for Railway (uses only production dependencies).
// Usage: node scripts/migrate.mjs   (run as the service's pre-deploy command)
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied");
} catch (err) {
  console.error("Migration failed", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
