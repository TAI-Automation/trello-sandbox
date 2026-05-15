import { Pool } from "pg";
import type { AppConfig } from "../../config/env.js";
import { requireConfigValue } from "../../config/env.js";

export type PermissionEntry = {
  memberId: string;
  memberLabel?: string;
  deniedListIds: string[];
};

export type PermissionsDocument = {
  restrictedMoves: PermissionEntry[];
};

export type LoadedMemberRestriction = {
  memberLabel?: string;
  deniedListIds: Set<string>;
};

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

export function getPermissionsPool(appConfig: AppConfig): Pool {
  if (pool) {
    return pool;
  }

  const connectionString = requireConfigValue(
    appConfig.databaseUrl,
    "DATABASE_URL or POSTGRES_URL"
  );

  pool = new Pool({
    connectionString,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  });

  return pool;
}

export async function readPermissionsDocument(
  appConfig: AppConfig,
  boardId: string
): Promise<PermissionsDocument> {
  await ensurePermissionsSchema(appConfig);

  const result = await getPermissionsPool(appConfig).query<{
    member_id: string;
    member_label: string | null;
    denied_list_ids: string[];
  }>(
    `
      select member_id, member_label, denied_list_ids
      from permission_restrictions
      where board_id = $1
      order by member_label nulls last, member_id
    `,
    [boardId]
  );

  return {
    restrictedMoves: result.rows.map((row) => ({
      memberId: row.member_id,
      memberLabel: row.member_label || undefined,
      deniedListIds: row.denied_list_ids,
    })),
  };
}

export async function upsertPermissionEntry(
  appConfig: AppConfig,
  boardId: string,
  entry: PermissionEntry
): Promise<void> {
  await ensurePermissionsSchema(appConfig);

  await getPermissionsPool(appConfig).query(
    `
      insert into permission_restrictions (
        board_id,
        member_id,
        member_label,
        denied_list_ids,
        updated_at
      )
      values ($1, $2, $3, $4, now())
      on conflict (board_id, member_id)
      do update set
        member_label = excluded.member_label,
        denied_list_ids = excluded.denied_list_ids,
        updated_at = now()
    `,
    [boardId, entry.memberId, entry.memberLabel || null, entry.deniedListIds]
  );
}

export async function loadMemberRestriction(
  appConfig: AppConfig,
  memberId: string,
  candidateListIds: string[],
  boardId: string
): Promise<LoadedMemberRestriction | null> {
  await ensurePermissionsSchema(appConfig);

  const boardResult = await getPermissionsPool(appConfig).query<{
    member_label: string | null;
    denied_list_ids: string[];
  }>(
    `
      select member_label, denied_list_ids
      from permission_restrictions
      where board_id = $1
        and member_id = $2
        and denied_list_ids && $3::text[]
      order by updated_at desc
      limit 1
    `,
    [boardId, memberId, candidateListIds]
  );

  const row = boardResult.rows[0];

  if (!row) {
    return null;
  }

  return {
    memberLabel: row.member_label || undefined,
    deniedListIds: new Set(row.denied_list_ids),
  };
}

async function ensurePermissionsSchema(appConfig: AppConfig): Promise<void> {
  schemaReady ??= getPermissionsPool(appConfig).query(`
    create table if not exists permission_restrictions (
      board_id text not null,
      member_id text not null,
      member_label text,
      denied_list_ids text[] not null default '{}',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (board_id, member_id)
    );

    create index if not exists permission_restrictions_member_id_idx
      on permission_restrictions (member_id);

    create index if not exists permission_restrictions_denied_list_ids_idx
      on permission_restrictions using gin (denied_list_ids);
  `).then(() => undefined);

  return schemaReady;
}

function shouldUseSsl(connectionString: string): boolean {
  return !connectionString.includes("localhost") && !connectionString.includes("127.0.0.1");
}
