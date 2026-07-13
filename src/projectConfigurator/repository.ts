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
  folderPath: string | null;
  projectManagers: ProjectManagerSummary[];
};

export type ProjectManagerSummary = {
  trelloMemberId: string;
  displayName: string;
  username: string | null;
  sortOrder: number;
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

export type BoardProjectLabelWithBoardSummary = BoardProjectLabelSummary & {
  boardName: string;
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
  folder_path: string | null;
};

type ProjectManagerRow = {
  project_id: string;
  trello_member_id: string;
  display_name: string;
  username: string | null;
  sort_order: number;
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

type BoardProjectLabelWithBoardRow = BoardProjectLabelRow & {
  board_name: string;
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
  const projectResult = await db(client).query<ProjectRow>(`
      select
        projects.id::text,
        projects.name,
        projects.project_color,
        project_folder_routes.folder_path
      from projects
      left join project_folder_routes
        on project_folder_routes.project_id = projects.id
      where projects.archived_at is null
      order by projects.name asc
    `);
  const managerResult = await db(client).query<ProjectManagerRow>(`
      select
        pm.project_id::text,
        pm.trello_member_id,
        m.display_name,
        m.username,
        pm.sort_order
      from project_managers pm
      join members m on m.trello_member_id = pm.trello_member_id
      join projects p on p.id = pm.project_id
      where p.archived_at is null
      order by pm.project_id asc, pm.sort_order asc, m.display_name asc
    `);
  const managersByProjectId = groupProjectManagers(managerResult.rows);

  return projectResult.rows.map((row) =>
    mapProject(row, managersByProjectId.get(row.id) ?? [])
  );
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
  projectManagerMemberIds?: string[];
}): Promise<ProjectSummary> {
  const client = await getDbPool().connect();

  try {
    await client.query("begin");
    const result = await client.query<ProjectRow>(
      `
        insert into projects (name, project_color)
        values ($1, $2)
        returning id::text, name, project_color, null::text as folder_path
      `,
      [input.name, input.projectColor]
    );
    const project = mapProject(
      requireRow(result.rows[0], "Project was not created.")
    );

    if (input.projectManagerMemberIds?.length) {
      await replaceProjectManagers(
        {
          projectId: project.id,
          trelloMemberIds: input.projectManagerMemberIds,
        },
        client
      );
    }

    await client.query("commit");

    return (await getProject(project.id)) ?? project;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function getProject(
  projectId: string,
  client?: pg.PoolClient
): Promise<ProjectSummary | null> {
  const result = await db(client).query<ProjectRow>(
    `
      select
        projects.id::text,
        projects.name,
        projects.project_color,
        project_folder_routes.folder_path
      from projects
      left join project_folder_routes
        on project_folder_routes.project_id = projects.id
      where projects.id = $1
        and projects.archived_at is null
    `,
    [projectId]
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return mapProject(row, await listProjectManagers(projectId, client));
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
      returning id::text, name, project_color, null::text as folder_path
    `,
    [input.projectId, input.name]
  );

  const row = result.rows[0];
  return row ? getProject(row.id) : null;
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
      returning id::text, name, project_color, null::text as folder_path
    `,
    [input.projectId, input.projectColor]
  );

  const row = result.rows[0];
  return row ? getProject(row.id) : null;
}

export async function deleteProject(projectId: string): Promise<boolean> {
  const client = await getDbPool().connect();

  try {
    await client.query("begin");
    await client.query("delete from project_managers where project_id = $1", [
      projectId,
    ]);
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

export async function listProjectManagers(
  projectId: string,
  client?: pg.PoolClient
): Promise<ProjectManagerSummary[]> {
  const result = await db(client).query<ProjectManagerRow>(
    `
      select
        pm.project_id::text,
        pm.trello_member_id,
        m.display_name,
        m.username,
        pm.sort_order
      from project_managers pm
      join members m on m.trello_member_id = pm.trello_member_id
      where pm.project_id = $1
      order by pm.sort_order asc, m.display_name asc
    `,
    [projectId]
  );

  return result.rows.map(mapProjectManager);
}

export async function isProjectManagerForBoardProjectLabel(input: {
  trelloBoardId: string;
  trelloMemberId: string;
  trelloLabelIds: string[];
}): Promise<boolean> {
  if (input.trelloLabelIds.length === 0) {
    return false;
  }

  const result = await getDbPool().query<{ exists: boolean }>(
    `
      select exists (
        select 1
        from board_project_labels bpl
        join project_managers pm on pm.project_id = bpl.project_id
        join projects p on p.id = bpl.project_id
        where bpl.trello_board_id = $1
          and bpl.trello_label_id = any($2::text[])
          and bpl.sync_status = 'synced'
          and pm.trello_member_id = $3
          and p.archived_at is null
      )
    `,
    [input.trelloBoardId, input.trelloLabelIds, input.trelloMemberId]
  );

  return result.rows[0]?.exists === true;
}

export async function addProjectManager(input: {
  projectId: string;
  trelloMemberId: string;
}): Promise<ProjectSummary | null> {
  await getDbPool().query(
    `
      insert into project_managers (project_id, trello_member_id, sort_order)
      values (
        $1,
        $2,
        coalesce(
          (select max(sort_order) + 1 from project_managers where project_id = $1),
          0
        )
      )
      on conflict (project_id, trello_member_id) do nothing
    `,
    [input.projectId, input.trelloMemberId]
  );

  return getProject(input.projectId);
}

export async function removeProjectManager(input: {
  projectId: string;
  trelloMemberId: string;
}): Promise<ProjectSummary | null> {
  await getDbPool().query(
    `
      delete from project_managers
      where project_id = $1
        and trello_member_id = $2
    `,
    [input.projectId, input.trelloMemberId]
  );

  return getProject(input.projectId);
}

export async function upsertProjectFolderRoute(input: {
  projectId: string;
  folderPath: string;
}): Promise<ProjectSummary | null> {
  await getDbPool().query(
    `
      insert into project_folder_routes (
        project_id,
        folder_path,
        enabled,
        updated_at
      )
      values ($1, $2, true, now())
      on conflict (project_id) do update
      set folder_path = excluded.folder_path,
          enabled = true,
          updated_at = now()
    `,
    [input.projectId, input.folderPath]
  );

  return getProject(input.projectId);
}

export async function replaceProjectManagers(
  input: {
    projectId: string;
    trelloMemberIds: string[];
  },
  client?: pg.PoolClient
): Promise<void> {
  const target = db(client);

  await target.query("delete from project_managers where project_id = $1", [
    input.projectId,
  ]);

  if (input.trelloMemberIds.length === 0) {
    return;
  }

  await target.query(
    `
      insert into project_managers (project_id, trello_member_id, sort_order)
      select $1, item.trello_member_id, item.sort_order
      from jsonb_to_recordset($2::jsonb) as item(
        trello_member_id text,
        sort_order integer
      )
    `,
    [
      input.projectId,
      JSON.stringify(
        input.trelloMemberIds.map((trelloMemberId, index) => ({
          trello_member_id: trelloMemberId,
          sort_order: index,
        }))
      ),
    ]
  );
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

export async function listBoardProjectLabelsForProject(
  projectId: string,
  currentBoardId?: string,
  client?: pg.PoolClient
): Promise<BoardProjectLabelWithBoardSummary[]> {
  const result = await db(client).query<BoardProjectLabelWithBoardRow>(
    `
      select
        bpl.trello_board_id,
        tb.board_name,
        bpl.project_id::text,
        bpl.trello_label_id,
        bpl.synced_label_text,
        bpl.synced_color,
        bpl.sync_status
      from board_project_labels bpl
      join trello_boards tb on tb.trello_board_id = bpl.trello_board_id
      where bpl.project_id = $1
      order by
        case when bpl.trello_board_id = $2 then 0 else 1 end,
        tb.board_name asc
    `,
    [projectId, currentBoardId ?? ""]
  );

  return result.rows.map((row) => ({
    ...mapBoardProjectLabel(row),
    boardName: row.board_name,
  }));
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

function mapProject(
  row: ProjectRow,
  projectManagers: ProjectManagerSummary[] = []
): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    labelText: row.name,
    projectColor: row.project_color,
    departmentId: "",
    folderPath: row.folder_path,
    projectManagers,
  };
}

function groupProjectManagers(
  rows: ProjectManagerRow[]
): Map<string, ProjectManagerSummary[]> {
  const managersByProjectId = new Map<string, ProjectManagerSummary[]>();

  for (const row of rows) {
    const managers = managersByProjectId.get(row.project_id) ?? [];

    managers.push(mapProjectManager(row));
    managersByProjectId.set(row.project_id, managers);
  }

  return managersByProjectId;
}

function mapProjectManager(row: ProjectManagerRow): ProjectManagerSummary {
  return {
    trelloMemberId: row.trello_member_id,
    displayName: row.display_name,
    username: row.username,
    sortOrder: row.sort_order,
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
