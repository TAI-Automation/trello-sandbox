import { getDbPool } from "../db/client.js";
import type { SafeListRecord } from "../db/repositories/safeLists.js";

type SafeListRow = {
  id: string;
  name: string;
  name_normalized: string;
  created_at: Date;
  updated_at: Date;
};

export async function listSafeLists(): Promise<SafeListRecord[]> {
  const result = await getDbPool().query<SafeListRow>(`
    select id::text, name, name_normalized, created_at, updated_at
    from safe_lists
    order by name asc
  `);

  return result.rows.map(mapSafeList);
}

export async function addSafeList(name: string): Promise<SafeListRecord> {
  const result = await getDbPool().query<SafeListRow>(
    `
      insert into safe_lists (name, updated_at)
      values ($1, now())
      on conflict (name_normalized) do update
      set name = excluded.name,
          updated_at = now()
      returning id::text, name, name_normalized, created_at, updated_at
    `,
    [name]
  );

  return mapSafeList(requireRow(result.rows[0], "Safe list was not saved."));
}

export async function removeSafeList(id: string): Promise<boolean> {
  const result = await getDbPool().query(
    "delete from safe_lists where id = $1",
    [id]
  );

  return (result.rowCount ?? 0) > 0;
}

function mapSafeList(row: SafeListRow): SafeListRecord {
  return {
    id: row.id,
    name: row.name,
    nameNormalized: row.name_normalized,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) {
    throw new Error(message);
  }

  return row;
}
