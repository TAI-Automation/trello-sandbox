import type pg from "pg";

import { getDbPool } from "../db/client.js";

export type DepartmentSummary = {
  id: string;
  name: string;
  labelText: string;
  departmentColor: string;
  sortOrder: number;
};

export type ProjectSummary = {
  id: string;
  name: string;
  labelText: string;
  projectColor: string;
  departmentId: string;
};

export type ManagedBoardSummary = {
  trelloBoardId: string;
  boardName: string;
};

export type LabelSyncStatus = "pending" | "synced" | "error";

export type BoardProjectLabelSummary = {
  trelloBoardId: string;
  projectId: string;
  trelloLabelId: string;
  syncedLabelText: string;
  syncedColor: string;
  syncStatus: LabelSyncStatus;
};

export type BoardDepartmentLabelSummary = {
  trelloBoardId: string;
  departmentId: string;
  trelloLabelId: string;
  syncedLabelText: string;
  syncedColor: string;
  syncStatus: LabelSyncStatus;
};

type DepartmentRow = {
  id: string;
  name: string;
  department_color: string;
  sort_order: number;
};

type ProjectRow = {
  id: string;
  name: string;
  project_color: string;
};

type ManagedBoardRow = {
  trello_board_id: string;
  board_name: string;
};

type BoardProjectLabelRow = {
  trello_board_id: string;
  project_id: string;
  trello_label_id: string;
  synced_label_text: string;
  synced_color: string;
  sync_status: LabelSyncStatus;
};

type BoardDepartmentLabelRow = {
  trello_board_id: string;
  department_id: string;
  trello_label_id: string;
  synced_label_text: string;
  synced_color: string;
  sync_status: LabelSyncStatus;
};

function db(client?: pg.PoolClient): pg.Pool | pg.PoolClient {
  return client ?? getDbPool();
}

export async function listActiveDepartments(
  client?: pg.PoolClient
): Promise<DepartmentSummary[]> {
  const result = await db(client).query<DepartmentRow>(`
    select id::text, name, department_color, sort_order
    from departments
    where archived_at is null
    order by sort_order asc, name asc
  `);

  return result.rows.map(mapDepartment);
}

export async function listActiveProjects(
  client?: pg.PoolClient
): Promise<ProjectSummary[]> {
  const result = await db(client).query<ProjectRow>(`
    select id::text, name, project_color
    from projects
    where archived_at is null
    order by name asc
  `);

  return result.rows.map(mapProject);
}

export async function listLabelSyncBoards(
  currentBoardId?: string,
  client?: pg.PoolClient
): Promise<ManagedBoardSummary[]> {
  const result = await db(client).query<ManagedBoardRow>(
    `
      select trello_board_id, board_name
      from trello_boards
      where label_sync_enabled = true
      order by
        case when trello_board_id = $1 then 0 else 1 end,
        board_name asc
    `,
    [currentBoardId ?? ""]
  );

  return result.rows.map((row) => ({
    trelloBoardId: row.trello_board_id,
    boardName: row.board_name,
  }));
}

export async function activeDepartmentExists(
  departmentId: string,
  client?: pg.PoolClient
): Promise<boolean> {
  const result = await db(client).query<{ exists: boolean }>(
    `
      select exists (
        select 1 from departments where id = $1 and archived_at is null
      )
    `,
    [departmentId]
  );

  return result.rows[0]?.exists === true;
}

export async function activeProjectExists(
  projectId: string,
  client?: pg.PoolClient
): Promise<boolean> {
  const result = await db(client).query<{ exists: boolean }>(
    `
      select exists (
        select 1 from projects where id = $1 and archived_at is null
      )
    `,
    [projectId]
  );

  return result.rows[0]?.exists === true;
}

export async function createDepartment(input: {
  name: string;
  departmentColor: string;
  sortOrder?: number;
}): Promise<DepartmentSummary> {
  const result = await getDbPool().query<DepartmentRow>(
    `
      insert into departments (name, department_color, sort_order)
      values ($1, $2, $3)
      returning id::text, name, department_color, sort_order
    `,
    [input.name, input.departmentColor, input.sortOrder ?? 0]
  );

  return mapDepartment(requireRow(result.rows[0], "Department was not created."));
}

export async function updateDepartmentColor(input: {
  departmentId: string;
  departmentColor: string;
}): Promise<DepartmentSummary | null> {
  const result = await getDbPool().query<DepartmentRow>(
    `
      update departments
      set department_color = $2,
          updated_at = now()
      where id = $1
        and archived_at is null
      returning id::text, name, department_color, sort_order
    `,
    [input.departmentId, input.departmentColor]
  );

  const row = result.rows[0];
  return row ? mapDepartment(row) : null;
}

export async function updateDepartmentName(input: {
  departmentId: string;
  name: string;
}): Promise<DepartmentSummary | null> {
  const result = await getDbPool().query<DepartmentRow>(
    `
      update departments
      set name = $2,
          updated_at = now()
      where id = $1
        and archived_at is null
      returning id::text, name, department_color, sort_order
    `,
    [input.departmentId, input.name]
  );

  const row = result.rows[0];
  return row ? mapDepartment(row) : null;
}

export async function deleteDepartment(departmentId: string): Promise<boolean> {
  const client = await getDbPool().connect();

  try {
    await client.query("begin");
    await client.query(
      "delete from board_department_labels where department_id = $1",
      [departmentId]
    );
    const result = await client.query(
      `
        delete from departments
        where id = $1
          and archived_at is null
      `,
      [departmentId]
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

export async function createProject(input: {
  name: string;
  projectColor: string;
}): Promise<ProjectSummary> {
  const result = await getDbPool().query<ProjectRow>(
    `
      insert into projects (name, project_color)
      values ($1, $2)
      returning id::text, name, project_color
    `,
    [input.name, input.projectColor]
  );

  return mapProject(requireRow(result.rows[0], "Project was not created."));
}

export async function updateProjectName(input: {
  projectId: string;
  name: string;
}): Promise<ProjectSummary | null> {
  const result = await getDbPool().query<ProjectRow>(
    `
      update projects
      set name = $2,
          updated_at = now()
      where id = $1
        and archived_at is null
      returning id::text, name, project_color
    `,
    [input.projectId, input.name]
  );

  const row = result.rows[0];
  return row ? mapProject(row) : null;
}

export async function updateProjectColor(input: {
  projectId: string;
  projectColor: string;
}): Promise<ProjectSummary | null> {
  const result = await getDbPool().query<ProjectRow>(
    `
      update projects
      set project_color = $2,
          updated_at = now()
      where id = $1
        and archived_at is null
      returning id::text, name, project_color
    `,
    [input.projectId, input.projectColor]
  );

  const row = result.rows[0];
  return row ? mapProject(row) : null;
}

export async function deleteProject(projectId: string): Promise<boolean> {
  const client = await getDbPool().connect();

  try {
    await client.query("begin");
    await client.query(
      "delete from board_project_labels where project_id = $1",
      [projectId]
    );
    const result = await client.query(
      `
        delete from projects
        where id = $1
          and archived_at is null
      `,
      [projectId]
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

export async function listBoardProjectLabels(
  trelloBoardId: string,
  client?: pg.PoolClient
): Promise<BoardProjectLabelSummary[]> {
  const result = await db(client).query<BoardProjectLabelRow>(
    `
      select
        trello_board_id,
        project_id::text,
        trello_label_id,
        synced_label_text,
        synced_color,
        sync_status
      from board_project_labels
      where trello_board_id = $1
      order by project_id asc
    `,
    [trelloBoardId]
  );

  return result.rows.map(mapBoardProjectLabel);
}

export async function listBoardDepartmentLabels(
  trelloBoardId: string,
  client?: pg.PoolClient
): Promise<BoardDepartmentLabelSummary[]> {
  const result = await db(client).query<BoardDepartmentLabelRow>(
    `
      select
        trello_board_id,
        department_id::text,
        trello_label_id,
        synced_label_text,
        synced_color,
        sync_status
      from board_department_labels
      where trello_board_id = $1
      order by department_id asc
    `,
    [trelloBoardId]
  );

  return result.rows.map(mapBoardDepartmentLabel);
}

export async function getBoardProjectLabelByTrelloLabelId(input: {
  trelloBoardId: string;
  trelloLabelId: string;
}): Promise<BoardProjectLabelSummary | null> {
  const result = await getDbPool().query<BoardProjectLabelRow>(
    `
      select
        trello_board_id,
        project_id::text,
        trello_label_id,
        synced_label_text,
        synced_color,
        sync_status
      from board_project_labels
      where trello_board_id = $1
        and trello_label_id = $2
    `,
    [input.trelloBoardId, input.trelloLabelId]
  );

  const row = result.rows[0];
  return row ? mapBoardProjectLabel(row) : null;
}

export async function getBoardDepartmentLabelByTrelloLabelId(input: {
  trelloBoardId: string;
  trelloLabelId: string;
}): Promise<BoardDepartmentLabelSummary | null> {
  const result = await getDbPool().query<BoardDepartmentLabelRow>(
    `
      select
        trello_board_id,
        department_id::text,
        trello_label_id,
        synced_label_text,
        synced_color,
        sync_status
      from board_department_labels
      where trello_board_id = $1
        and trello_label_id = $2
    `,
    [input.trelloBoardId, input.trelloLabelId]
  );

  const row = result.rows[0];
  return row ? mapBoardDepartmentLabel(row) : null;
}

export async function markBoardProjectLabelSynced(input: {
  trelloBoardId: string;
  projectId: string;
  trelloLabelId: string;
  syncedLabelText: string;
  syncedColor: string;
}): Promise<void> {
  await getDbPool().query(
    `
      insert into board_project_labels (
        trello_board_id,
        project_id,
        trello_label_id,
        synced_label_text,
        synced_color,
        sync_status,
        last_synced_at,
        last_error,
        updated_at
      )
      values ($1, $2, $3, $4, $5, 'synced', now(), null, now())
      on conflict (trello_board_id, project_id) do update
      set trello_label_id = excluded.trello_label_id,
          synced_label_text = excluded.synced_label_text,
          synced_color = excluded.synced_color,
          sync_status = 'synced',
          last_synced_at = now(),
          last_error = null,
          updated_at = now()
    `,
    [
      input.trelloBoardId,
      input.projectId,
      input.trelloLabelId,
      input.syncedLabelText,
      input.syncedColor,
    ]
  );
}

export async function markBoardProjectLabelError(input: {
  trelloBoardId: string;
  projectId: string;
  syncedLabelText: string;
  syncedColor: string;
  error: string;
}): Promise<void> {
  await getDbPool().query(
    `
      insert into board_project_labels (
        trello_board_id,
        project_id,
        trello_label_id,
        synced_label_text,
        synced_color,
        sync_status,
        last_error,
        updated_at
      )
      values ($1, $2, 'sync-error-project-' || $2::text, $3, $4, 'error', $5, now())
      on conflict (trello_board_id, project_id) do update
      set synced_label_text = excluded.synced_label_text,
          synced_color = excluded.synced_color,
          sync_status = 'error',
          last_error = excluded.last_error,
          updated_at = now()
    `,
    [
      input.trelloBoardId,
      input.projectId,
      input.syncedLabelText,
      input.syncedColor,
      input.error,
    ]
  );
}

export async function markBoardDepartmentLabelSynced(input: {
  trelloBoardId: string;
  departmentId: string;
  trelloLabelId: string;
  syncedLabelText: string;
  syncedColor: string;
}): Promise<void> {
  await getDbPool().query(
    `
      insert into board_department_labels (
        trello_board_id,
        department_id,
        trello_label_id,
        synced_label_text,
        synced_color,
        sync_status,
        last_synced_at,
        last_error,
        updated_at
      )
      values ($1, $2, $3, $4, $5, 'synced', now(), null, now())
      on conflict (trello_board_id, department_id) do update
      set trello_label_id = excluded.trello_label_id,
          synced_label_text = excluded.synced_label_text,
          synced_color = excluded.synced_color,
          sync_status = 'synced',
          last_synced_at = now(),
          last_error = null,
          updated_at = now()
    `,
    [
      input.trelloBoardId,
      input.departmentId,
      input.trelloLabelId,
      input.syncedLabelText,
      input.syncedColor,
    ]
  );
}

export async function markBoardDepartmentLabelError(input: {
  trelloBoardId: string;
  departmentId: string;
  syncedLabelText: string;
  syncedColor: string;
  error: string;
}): Promise<void> {
  await getDbPool().query(
    `
      insert into board_department_labels (
        trello_board_id,
        department_id,
        trello_label_id,
        synced_label_text,
        synced_color,
        sync_status,
        last_error,
        updated_at
      )
      values ($1, $2, 'sync-error-department-' || $2::text, $3, $4, 'error', $5, now())
      on conflict (trello_board_id, department_id) do update
      set synced_label_text = excluded.synced_label_text,
          synced_color = excluded.synced_color,
          sync_status = 'error',
          last_error = excluded.last_error,
          updated_at = now()
    `,
    [
      input.trelloBoardId,
      input.departmentId,
      input.syncedLabelText,
      input.syncedColor,
      input.error,
    ]
  );
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

function mapDepartment(row: DepartmentRow): DepartmentSummary {
  return {
    id: row.id,
    name: row.name,
    labelText: row.name,
    departmentColor: row.department_color,
    sortOrder: row.sort_order,
  };
}

function mapProject(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    labelText: row.name,
    projectColor: row.project_color,
    departmentId: "",
  };
}

function mapBoardProjectLabel(
  row: BoardProjectLabelRow
): BoardProjectLabelSummary {
  return {
    trelloBoardId: row.trello_board_id,
    projectId: row.project_id,
    trelloLabelId: row.trello_label_id,
    syncedLabelText: row.synced_label_text,
    syncedColor: row.synced_color,
    syncStatus: row.sync_status,
  };
}

function mapBoardDepartmentLabel(
  row: BoardDepartmentLabelRow
): BoardDepartmentLabelSummary {
  return {
    trelloBoardId: row.trello_board_id,
    departmentId: row.department_id,
    trelloLabelId: row.trello_label_id,
    syncedLabelText: row.synced_label_text,
    syncedColor: row.synced_color,
    syncStatus: row.sync_status,
  };
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) {
    throw new Error(message);
  }

  return row;
}
