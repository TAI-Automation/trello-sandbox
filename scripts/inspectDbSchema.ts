import "dotenv/config";

import pg from "pg";

const expectedTables = [
  "app_settings",
  "board_department_labels",
  "board_project_labels",
  "departments",
  "label_priorities",
  "label_sync_jobs",
  "members",
  "project_folder_routes",
  "project_manager_field_apply_jobs",
  "project_managers",
  "projects",
  "trello_boards",
];

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

const pool = new pg.Pool({ connectionString });

try {
  const tables = await pool.query<{
    table_name: string;
    columns: string;
  }>(
    `
      select
        table_name,
        string_agg(column_name, ',' order by ordinal_position) as columns
      from information_schema.columns
      where table_schema = current_schema()
        and table_name = any($1::text[])
      group by table_name
      order by table_name
    `,
    [expectedTables]
  );
  const boardProjectLabelForeignKey = await pool.query<{
    delete_rule: string;
  }>(`
    select rc.delete_rule
    from information_schema.referential_constraints rc
    join information_schema.table_constraints tc
      on tc.constraint_schema = rc.constraint_schema
     and tc.constraint_name = rc.constraint_name
    join information_schema.key_column_usage kcu
      on kcu.constraint_schema = tc.constraint_schema
     and kcu.constraint_name = tc.constraint_name
    where tc.table_schema = current_schema()
      and tc.table_name = 'board_project_labels'
      and tc.constraint_type = 'FOREIGN KEY'
      and kcu.column_name = 'trello_board_id'
  `);
  const metadataTables = await pool.query<{
    schema_migrations_exists: boolean;
    schema_changes_exists: boolean;
  }>(`
    select
      to_regclass(current_schema() || '.schema_migrations') is not null
        as schema_migrations_exists,
      to_regclass(current_schema() || '.schema_changes') is not null
        as schema_changes_exists
  `);
  const legacyMigrations = metadataTables.rows[0]?.schema_migrations_exists
    ? await pool.query<{ filename: string }>(
        "select filename from schema_migrations order by filename"
      )
    : { rows: [] };
  const foundTables = new Set(tables.rows.map((row) => row.table_name));

  console.log(
    JSON.stringify(
      {
        tables: tables.rows,
        missingTables: expectedTables.filter(
          (tableName) => !foundTables.has(tableName)
        ),
        boardProjectLabelsBoardDeleteRules:
          boardProjectLabelForeignKey.rows.map((row) => row.delete_rule),
        schemaChangesExists:
          metadataTables.rows[0]?.schema_changes_exists === true,
        legacyMigrations: legacyMigrations.rows.map((row) => row.filename),
      },
      null,
      2
    )
  );
} finally {
  await pool.end();
}
