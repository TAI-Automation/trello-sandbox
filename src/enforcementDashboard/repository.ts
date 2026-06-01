import type pg from "pg";

import { getDbPool } from "../db/client.js";
import type {
  AppSettings,
  TrelloBoardRecord,
} from "../db/repositories/trelloBoards.js";

type TrelloBoardRow = {
  trello_board_id: string;
  board_name: string;
  enforcement_enabled: boolean;
  label_sync_enabled: boolean;
  trello_webhook_id: string | null;
  webhook_active: boolean;
  last_label_sync_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};

type AppSettingRow = {
  key: string;
  value: string;
};

function db(client?: pg.PoolClient): pg.Pool | pg.PoolClient {
  return client ?? getDbPool();
}

export async function listDashboardBoards(): Promise<TrelloBoardRecord[]> {
  const result = await getDbPool().query<TrelloBoardRow>(`
    select
      trello_board_id,
      board_name,
      enforcement_enabled,
      label_sync_enabled,
      trello_webhook_id,
      webhook_active,
      last_label_sync_at,
      last_error,
      created_at,
      updated_at
    from trello_boards
    order by board_name asc
  `);

  return result.rows.map(mapTrelloBoard);
}

export async function getAppSettings(): Promise<AppSettings> {
  const result = await getDbPool().query<AppSettingRow>(
    "select key, value from app_settings where key = 'project_manager_cap'"
  );
  const value = result.rows[0]?.value;
  const parsed = value ? Number(value) : 3;

  return {
    projectManagerCap: Number.isInteger(parsed) && parsed > 0 ? parsed : 3,
  };
}

export async function updateProjectManagerCap(
  projectManagerCap: number
): Promise<AppSettings> {
  const result = await getDbPool().query<AppSettingRow>(
    `
      insert into app_settings (key, value, updated_at)
      values ('project_manager_cap', $1, now())
      on conflict (key) do update
      set value = excluded.value,
          updated_at = now()
      returning key, value
    `,
    [String(projectManagerCap)]
  );
  const parsed = Number(requireRow(result.rows[0], "Setting was not saved.").value);

  return {
    projectManagerCap: parsed,
  };
}

export async function getDashboardBoard(
  trelloBoardId: string,
  client?: pg.PoolClient
): Promise<TrelloBoardRecord | null> {
  const result = await db(client).query<TrelloBoardRow>(
    `
      select
        trello_board_id,
        board_name,
        enforcement_enabled,
        label_sync_enabled,
        trello_webhook_id,
        webhook_active,
        last_label_sync_at,
        last_error,
        created_at,
        updated_at
      from trello_boards
      where trello_board_id = $1
    `,
    [trelloBoardId]
  );

  const row = result.rows[0];

  return row ? mapTrelloBoard(row) : null;
}

export async function upsertDashboardBoard(input: {
  trelloBoardId: string;
  boardName: string;
}): Promise<TrelloBoardRecord> {
  const result = await getDbPool().query<TrelloBoardRow>(
    `
      insert into trello_boards (
        trello_board_id,
        board_name,
        label_sync_enabled,
        updated_at
      )
      values ($1, $2, true, now())
      on conflict (trello_board_id) do update
      set board_name = excluded.board_name,
          label_sync_enabled = true,
          updated_at = now()
      returning
        trello_board_id,
        board_name,
        enforcement_enabled,
        label_sync_enabled,
        trello_webhook_id,
        webhook_active,
        last_label_sync_at,
        last_error,
        created_at,
        updated_at
    `,
    [input.trelloBoardId, input.boardName]
  );

  return mapTrelloBoard(requireRow(result.rows[0], "Board was not saved."));
}

export async function markBoardLabelSyncComplete(input: {
  trelloBoardId: string;
  error: string | null;
}): Promise<void> {
  await getDbPool().query(
    `
      update trello_boards
      set last_label_sync_at = now(),
          last_error = $2,
          updated_at = now()
      where trello_board_id = $1
    `,
    [input.trelloBoardId, input.error]
  );
}

export async function saveBoardWebhookState(input: {
  trelloBoardId: string;
  enforcementEnabled: boolean;
  webhookActive: boolean;
  trelloWebhookId: string | null;
  lastError?: string | null;
}): Promise<TrelloBoardRecord | null> {
  const result = await getDbPool().query<TrelloBoardRow>(
    `
      update trello_boards
      set enforcement_enabled = $2,
          webhook_active = $3,
          trello_webhook_id = $4,
          last_error = $5,
          updated_at = now()
      where trello_board_id = $1
      returning
        trello_board_id,
        board_name,
        enforcement_enabled,
        label_sync_enabled,
        trello_webhook_id,
        webhook_active,
        last_label_sync_at,
        last_error,
        created_at,
        updated_at
    `,
    [
      input.trelloBoardId,
      input.enforcementEnabled,
      input.webhookActive,
      input.trelloWebhookId,
      input.lastError ?? null,
    ]
  );

  const row = result.rows[0];

  return row ? mapTrelloBoard(row) : null;
}

export async function saveBoardError(input: {
  trelloBoardId: string;
  error: string;
}): Promise<void> {
  await getDbPool().query(
    `
      update trello_boards
      set last_error = $2,
          updated_at = now()
      where trello_board_id = $1
    `,
    [input.trelloBoardId, input.error]
  );
}

export async function removeDashboardBoard(
  trelloBoardId: string
): Promise<boolean> {
  const client = await getDbPool().connect();

  try {
    await client.query("begin");
    await client.query(
      "delete from board_project_labels where trello_board_id = $1",
      [trelloBoardId]
    );
    await client.query(
      "delete from label_priorities where trello_board_id = $1",
      [trelloBoardId]
    );
    const result = await client.query(
      "delete from trello_boards where trello_board_id = $1",
      [trelloBoardId]
    );
    await client.query("commit");

    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function mapTrelloBoard(row: TrelloBoardRow): TrelloBoardRecord {
  return {
    trelloBoardId: row.trello_board_id,
    boardName: row.board_name,
    enforcementEnabled: row.enforcement_enabled,
    labelSyncEnabled: row.label_sync_enabled,
    trelloWebhookId: row.trello_webhook_id,
    webhookActive: row.webhook_active,
    lastLabelSyncAt: row.last_label_sync_at,
    lastError: row.last_error,
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
