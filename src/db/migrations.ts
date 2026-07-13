import "dotenv/config";

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type pg from "pg";

import { closeDbPool, getDbPool } from "./client.js";

type SqlFile = {
  filename: string;
  sql: string;
  checksum: string;
};

type AppliedChangeRow = {
  filename: string;
  checksum: string;
};

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFile), "../..");
const schemaDir = path.join(projectRoot, "db", "schema");
const changesDir = path.join(projectRoot, "db", "changes");
const migrationLockName = "trello-permission-manager-suite:db-schema";

const legacyChangeEquivalents = new Map<string, string>([
  [
    "001_board_project_labels_board_delete_cascade.sql",
    "008_update_board_project_labels_board_delete.sql",
  ],
]);

async function loadSqlFiles(directory: string): Promise<SqlFile[]> {
  const filenames = (await readdir(directory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    filenames.map(async (filename) => {
      const sql = await readFile(path.join(directory, filename), "utf8");

      return {
        filename,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    })
  );
}

async function ensureChangesTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    create table if not exists schema_changes (
      filename text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    );
  `);
}

async function isFreshDatabase(client: pg.PoolClient): Promise<boolean> {
  const result = await client.query<{ fresh: boolean }>(`
    select to_regclass(current_schema() || '.trello_boards') is null as fresh
  `);

  return result.rows[0]?.fresh === true;
}

async function applyCurrentSchema(
  client: pg.PoolClient,
  files: SqlFile[]
): Promise<void> {
  await client.query("begin");

  try {
    for (const file of files) {
      await client.query(file.sql);
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function recordLegacyEquivalents(
  client: pg.PoolClient,
  changes: SqlFile[]
): Promise<void> {
  const tableResult = await client.query<{ exists: boolean }>(`
    select to_regclass(current_schema() || '.schema_migrations') is not null as exists
  `);

  if (tableResult.rows[0]?.exists !== true) {
    return;
  }

  for (const change of changes) {
    const legacyFilename = legacyChangeEquivalents.get(change.filename);

    if (!legacyFilename) {
      continue;
    }

    await client.query(
      `
        insert into schema_changes (filename, checksum)
        select $1, $2
        where exists (
          select 1 from schema_migrations where filename = $3
        )
        on conflict (filename) do nothing
      `,
      [change.filename, change.checksum, legacyFilename]
    );
  }
}

async function getAppliedChanges(
  client: pg.PoolClient
): Promise<Map<string, string>> {
  const result = await client.query<AppliedChangeRow>(
    "select filename, checksum from schema_changes"
  );

  return new Map(
    result.rows.map((row) => [row.filename, row.checksum])
  );
}

function assertAppliedChangeChecksums(
  changes: SqlFile[],
  appliedChanges: Map<string, string>
): void {
  for (const change of changes) {
    const appliedChecksum = appliedChanges.get(change.filename);

    if (appliedChecksum && appliedChecksum !== change.checksum) {
      throw new Error(
        `Applied database change ${change.filename} was modified. ` +
          "Restore it and add a new one-time change instead."
      );
    }
  }
}

async function baselineChanges(
  client: pg.PoolClient,
  changes: SqlFile[]
): Promise<void> {
  await client.query("begin");

  try {
    for (const change of changes) {
      await client.query(
        `
          insert into schema_changes (filename, checksum)
          values ($1, $2)
          on conflict (filename) do nothing
        `,
        [change.filename, change.checksum]
      );
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function applyChange(
  client: pg.PoolClient,
  change: SqlFile
): Promise<void> {
  await client.query("begin");

  try {
    await client.query(change.sql);
    await client.query(
      "insert into schema_changes (filename, checksum) values ($1, $2)",
      [change.filename, change.checksum]
    );
    await client.query("commit");
    console.log(`Applied one-time change ${change.filename}`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function runMigrations(): Promise<void> {
  const schemaFiles = await loadSqlFiles(schemaDir);
  const changes = await loadSqlFiles(changesDir);
  const client = await getDbPool().connect();

  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [
      migrationLockName,
    ]);
    await ensureChangesTable(client);

    const freshDatabase = await isFreshDatabase(client);

    await applyCurrentSchema(client, schemaFiles);

    if (freshDatabase) {
      await baselineChanges(client, changes);
      console.log(
        `Created current schema and baselined ${changes.length} one-time change(s).`
      );
      return;
    }

    await recordLegacyEquivalents(client, changes);

    const appliedChanges = await getAppliedChanges(client);
    assertAppliedChangeChecksums(changes, appliedChanges);

    const pendingChanges = changes.filter(
      (change) => !appliedChanges.has(change.filename)
    );

    for (const change of pendingChanges) {
      await applyChange(client, change);
    }

    console.log(
      pendingChanges.length === 0
        ? "Schema is current; no one-time changes were pending."
        : "Schema and one-time changes are current."
    );
  } finally {
    await client
      .query("select pg_advisory_unlock(hashtext($1))", [migrationLockName])
      .catch(() => undefined);
    client.release();
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
