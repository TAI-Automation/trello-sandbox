import type { AppConfig } from "../../config/env.js";
import { getPermissionsPool } from "../../core/permissions/store.js";

export type EnforcedBoard = {
  boardId: string;
  boardName: string;
  enforcementEnabled: boolean;
  webhookId?: string;
  webhookActive?: boolean;
  webhookCallbackUrl?: string;
  lastCheckedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

export type EnforcedBoardInput = {
  boardId: string;
  boardName: string;
  enforcementEnabled: boolean;
  webhookId?: string;
  webhookActive?: boolean;
  webhookCallbackUrl?: string;
  lastError?: string;
};

type EnforcedBoardRow = {
  board_id: string;
  board_name: string;
  enforcement_enabled: boolean;
  webhook_id: string | null;
  webhook_active: boolean | null;
  webhook_callback_url: string | null;
  last_checked_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};

let schemaReady: Promise<void> | null = null;

export async function ensureEnforcedBoardsSchema(
  appConfig: AppConfig
): Promise<void> {
  schemaReady ??= getPermissionsPool(appConfig).query(`
    create table if not exists permission_enforced_boards (
      board_id text primary key,
      board_name text not null,
      enforcement_enabled boolean not null default true,
      webhook_id text,
      webhook_active boolean,
      webhook_callback_url text,
      last_checked_at timestamptz,
      last_error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists permission_enforced_boards_webhook_id_idx
      on permission_enforced_boards (webhook_id);
  `).then(() => undefined);

  return schemaReady;
}

export async function listEnforcedBoards(
  appConfig: AppConfig
): Promise<EnforcedBoard[]> {
  await ensureEnforcedBoardsSchema(appConfig);

  const result = await getPermissionsPool(appConfig).query<EnforcedBoardRow>(`
    select
      board_id,
      board_name,
      enforcement_enabled,
      webhook_id,
      webhook_active,
      webhook_callback_url,
      last_checked_at,
      last_error,
      created_at,
      updated_at
    from permission_enforced_boards
    order by board_name, board_id
  `);

  return result.rows.map(mapBoardRow);
}

export async function getEnforcedBoard(
  appConfig: AppConfig,
  boardId: string
): Promise<EnforcedBoard | null> {
  await ensureEnforcedBoardsSchema(appConfig);

  const result = await getPermissionsPool(appConfig).query<EnforcedBoardRow>(
    `
      select
        board_id,
        board_name,
        enforcement_enabled,
        webhook_id,
        webhook_active,
        webhook_callback_url,
        last_checked_at,
        last_error,
        created_at,
        updated_at
      from permission_enforced_boards
      where board_id = $1
    `,
    [boardId]
  );

  const row = result.rows[0];
  return row ? mapBoardRow(row) : null;
}

export async function upsertEnforcedBoard(
  appConfig: AppConfig,
  board: EnforcedBoardInput
): Promise<EnforcedBoard> {
  await ensureEnforcedBoardsSchema(appConfig);

  const result = await getPermissionsPool(appConfig).query<EnforcedBoardRow>(
    `
      insert into permission_enforced_boards (
        board_id,
        board_name,
        enforcement_enabled,
        webhook_id,
        webhook_active,
        webhook_callback_url,
        last_checked_at,
        last_error,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, now(), $7, now())
      on conflict (board_id)
      do update set
        board_name = excluded.board_name,
        enforcement_enabled = excluded.enforcement_enabled,
        webhook_id = excluded.webhook_id,
        webhook_active = excluded.webhook_active,
        webhook_callback_url = excluded.webhook_callback_url,
        last_checked_at = now(),
        last_error = excluded.last_error,
        updated_at = now()
      returning
        board_id,
        board_name,
        enforcement_enabled,
        webhook_id,
        webhook_active,
        webhook_callback_url,
        last_checked_at,
        last_error,
        created_at,
        updated_at
    `,
    [
      board.boardId,
      board.boardName,
      board.enforcementEnabled,
      board.webhookId || null,
      board.webhookActive ?? null,
      board.webhookCallbackUrl || null,
      board.lastError || null,
    ]
  );

  return mapBoardRow(result.rows[0]);
}

export async function updateEnforcedBoardStatus(
  appConfig: AppConfig,
  boardId: string,
  status: {
    enforcementEnabled?: boolean;
    webhookId?: string | null;
    webhookActive?: boolean | null;
    webhookCallbackUrl?: string | null;
    lastError?: string | null;
  }
): Promise<EnforcedBoard | null> {
  await ensureEnforcedBoardsSchema(appConfig);

  const current = await getEnforcedBoard(appConfig, boardId);

  if (!current) {
    return null;
  }

  const result = await getPermissionsPool(appConfig).query<EnforcedBoardRow>(
    `
      update permission_enforced_boards
      set
        enforcement_enabled = $2,
        webhook_id = $3,
        webhook_active = $4,
        webhook_callback_url = $5,
        last_checked_at = now(),
        last_error = $6,
        updated_at = now()
      where board_id = $1
      returning
        board_id,
        board_name,
        enforcement_enabled,
        webhook_id,
        webhook_active,
        webhook_callback_url,
        last_checked_at,
        last_error,
        created_at,
        updated_at
    `,
    [
      boardId,
      status.enforcementEnabled ?? current.enforcementEnabled,
      status.webhookId !== undefined ? status.webhookId : current.webhookId || null,
      status.webhookActive !== undefined
        ? status.webhookActive
        : current.webhookActive ?? null,
      status.webhookCallbackUrl !== undefined
        ? status.webhookCallbackUrl
        : current.webhookCallbackUrl || null,
      status.lastError !== undefined ? status.lastError : current.lastError || null,
    ]
  );

  return mapBoardRow(result.rows[0]);
}

function mapBoardRow(row: EnforcedBoardRow): EnforcedBoard {
  return {
    boardId: row.board_id,
    boardName: row.board_name,
    enforcementEnabled: row.enforcement_enabled,
    webhookId: row.webhook_id || undefined,
    webhookActive: row.webhook_active ?? undefined,
    webhookCallbackUrl: row.webhook_callback_url || undefined,
    lastCheckedAt: row.last_checked_at?.toISOString(),
    lastError: row.last_error || undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
