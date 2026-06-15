import type pg from "pg";

import { getDbPool } from "../db/client.js";

export type LabelPriorityRecord = {
  trelloCardId: string;
  trelloBoardId: string;
  priority: number;
  updatedByMemberId: string;
  archivedSince: Date | null;
  lastVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LabelPriorityCleanupCandidate = Pick<
  LabelPriorityRecord,
  "trelloCardId" | "trelloBoardId" | "archivedSince"
>;

type LabelPriorityRow = {
  trello_card_id: string;
  trello_board_id: string;
  priority: number;
  updated_by_member_id: string;
  archived_since: Date | null;
  last_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function db(client?: pg.PoolClient): pg.Pool | pg.PoolClient {
  return client ?? getDbPool();
}

export async function getLabelPriority(
  trelloCardId: string,
  client?: pg.PoolClient
): Promise<LabelPriorityRecord | null> {
  const result = await db(client).query<LabelPriorityRow>(
    `
      select
        trello_card_id,
        trello_board_id,
        priority,
        updated_by_member_id,
        archived_since,
        last_verified_at,
        created_at,
        updated_at
      from label_priorities
      where trello_card_id = $1
    `,
    [trelloCardId]
  );

  const row = result.rows[0];

  return row ? mapLabelPriority(row) : null;
}

export async function listLabelPrioritiesByCardIds(
  trelloCardIds: string[],
  client?: pg.PoolClient
): Promise<LabelPriorityRecord[]> {
  if (trelloCardIds.length === 0) {
    return [];
  }

  const result = await db(client).query<LabelPriorityRow>(
    `
      select
        trello_card_id,
        trello_board_id,
        priority,
        updated_by_member_id,
        archived_since,
        last_verified_at,
        created_at,
        updated_at
      from label_priorities
      where trello_card_id = any($1::text[])
    `,
    [trelloCardIds]
  );

  return result.rows.map(mapLabelPriority);
}

export async function listLabelPriorityCleanupCandidates(
  client?: pg.PoolClient
): Promise<LabelPriorityCleanupCandidate[]> {
  const result = await db(client).query<{
    trello_card_id: string;
    trello_board_id: string;
    archived_since: Date | null;
  }>(`
    select trello_card_id, trello_board_id, archived_since
    from label_priorities
    order by updated_at asc
  `);

  return result.rows.map((row) => ({
    trelloCardId: row.trello_card_id,
    trelloBoardId: row.trello_board_id,
    archivedSince: row.archived_since,
  }));
}

export async function upsertLabelPriority(input: {
  trelloCardId: string;
  trelloBoardId: string;
  priority: number;
  updatedByMemberId: string;
}): Promise<LabelPriorityRecord> {
  const result = await getDbPool().query<LabelPriorityRow>(
    `
      insert into label_priorities (
        trello_card_id,
        trello_board_id,
        priority,
        updated_by_member_id,
        archived_since,
        last_verified_at,
        updated_at
      )
      values ($1, $2, $3, $4, null, now(), now())
      on conflict (trello_card_id) do update
      set trello_board_id = excluded.trello_board_id,
          priority = excluded.priority,
          updated_by_member_id = excluded.updated_by_member_id,
          archived_since = null,
          last_verified_at = now(),
          updated_at = now()
      returning
        trello_card_id,
        trello_board_id,
        priority,
        updated_by_member_id,
        archived_since,
        last_verified_at,
        created_at,
        updated_at
    `,
    [
      input.trelloCardId,
      input.trelloBoardId,
      input.priority,
      input.updatedByMemberId,
    ]
  );

  return mapLabelPriority(requireRow(result.rows[0], "Priority was not saved."));
}

export async function deleteLabelPriority(
  trelloCardId: string
): Promise<boolean> {
  const result = await getDbPool().query(
    "delete from label_priorities where trello_card_id = $1",
    [trelloCardId]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function markLabelPriorityCardOpen(
  trelloCardId: string
): Promise<void> {
  await getDbPool().query(
    `
      update label_priorities
      set archived_since = null,
          last_verified_at = now()
      where trello_card_id = $1
    `,
    [trelloCardId]
  );
}

export async function markLabelPriorityCardArchived(
  trelloCardId: string
): Promise<void> {
  await getDbPool().query(
    `
      update label_priorities
      set archived_since = coalesce(archived_since, now()),
          last_verified_at = now()
      where trello_card_id = $1
    `,
    [trelloCardId]
  );
}

function mapLabelPriority(row: LabelPriorityRow): LabelPriorityRecord {
  return {
    trelloCardId: row.trello_card_id,
    trelloBoardId: row.trello_board_id,
    priority: row.priority,
    updatedByMemberId: row.updated_by_member_id,
    archivedSince: row.archived_since,
    lastVerifiedAt: row.last_verified_at,
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
