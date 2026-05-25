import "dotenv/config";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closeDbPool, getDbPool } from "./client.js";

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFile), "../..");
const migrationsDir = path.join(projectRoot, "db", "migrations");

async function ensureMigrationsTable(): Promise<void> {
  await getDbPool().query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    );
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await getDbPool().query<{ filename: string }>(
    "select filename from schema_migrations"
  );

  return new Set(result.rows.map((row) => row.filename));
}

async function getMigrationFiles(): Promise<string[]> {
  const files = await readdir(migrationsDir);

  return files
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
}

async function applyMigration(filename: string): Promise<void> {
  const sql = await readFile(path.join(migrationsDir, filename), "utf8");
  const db = getDbPool();
  const client = await db.connect();

  try {
    await client.query("begin");
    await client.query(sql);
    await client.query(
      "insert into schema_migrations (filename) values ($1)",
      [filename]
    );
    await client.query("commit");
    console.log(`Applied ${filename}`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function runMigrations(): Promise<void> {
  await ensureMigrationsTable();

  const appliedMigrations = await getAppliedMigrations();
  const migrationFiles = await getMigrationFiles();
  const pendingMigrations = migrationFiles.filter(
    (file) => !appliedMigrations.has(file)
  );

  if (pendingMigrations.length === 0) {
    console.log("No pending migrations.");
    return;
  }

  for (const filename of pendingMigrations) {
    await applyMigration(filename);
  }
}

runMigrations()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool();
  });
