import type pg from "pg";

import { getDbPool } from "../db/client.js";

export type DepartmentSummary = {
  id: string;
  name: string;
  departmentColor: string;
  sortOrder: number;
};

export type ProjectSummary = {
  id: string;
  departmentId: string;
  name: string;
  labelText: string;
  departmentColor: string;
};

export type ManagerAssignmentSummary = {
  ownerId: string;
  trelloMemberId: string;
  displayName: string;
  username: string | null;
};

export type MemberSummary = {
  trelloMemberId: string;
  displayName: string;
  username: string | null;
};

export type MissingMemberInput = {
  trelloMemberId: string;
  displayName: string;
  username: string | null;
};

export type ManagedBoardSummary = {
  trelloBoardId: string;
  boardName: string;
};

export type BoardProjectLabelSummary = {
  trelloBoardId: string;
  projectId: string;
  trelloLabelId: string;
  syncedLabelText: string;
  syncedColor: string;
};

type DepartmentRow = {
  id: string;
  name: string;
  department_color: string;
  sort_order: number;
};

type ProjectRow = {
  id: string;
  department_id: string;
  name: string;
  department_name: string;
  department_color: string;
};

type ManagerAssignmentRow = {
  owner_id: string;
  trello_member_id: string;
  display_name: string;
  username: string | null;
};

type MemberRow = {
  trello_member_id: string;
  display_name: string;
  username: string | null;
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
};

type IdRow = {
  id: string;
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
    select
      projects.id::text,
      projects.department_id::text,
      projects.name,
      departments.name as department_name,
      departments.department_color
    from projects
    inner join departments on departments.id = projects.department_id
    where projects.archived_at is null
      and departments.archived_at is null
    order by departments.sort_order asc, departments.name asc, projects.name asc
  `);

  return result.rows.map(mapProject);
}

export async function listDepartmentManagerAssignments(
  client?: pg.PoolClient
): Promise<ManagerAssignmentSummary[]> {
  const result = await db(client).query<ManagerAssignmentRow>(`
    select
      department_managers.department_id::text as owner_id,
      department_managers.trello_member_id,
      members.display_name,
      members.username
    from department_managers
    inner join departments on departments.id = department_managers.department_id
    inner join members on members.trello_member_id = department_managers.trello_member_id
    where departments.archived_at is null
    order by members.display_name asc
  `);

  return result.rows.map(mapManagerAssignment);
}

export async function listProjectManagerAssignments(
  client?: pg.PoolClient
): Promise<ManagerAssignmentSummary[]> {
  const result = await db(client).query<ManagerAssignmentRow>(`
    select
      project_managers.project_id::text as owner_id,
      project_managers.trello_member_id,
      members.display_name,
      members.username
    from project_managers
    inner join projects on projects.id = project_managers.project_id
    inner join departments on departments.id = projects.department_id
    inner join members on members.trello_member_id = project_managers.trello_member_id
    where projects.archived_at is null
      and departments.archived_at is null
    order by members.display_name asc
  `);

  return result.rows.map(mapManagerAssignment);
}

export async function listMembers(
  client?: pg.PoolClient
): Promise<MemberSummary[]> {
  const result = await db(client).query<MemberRow>(`
    select trello_member_id, display_name, username
    from members
    order by display_name asc, username asc
  `);

  return result.rows.map((row) => ({
    trelloMemberId: row.trello_member_id,
    displayName: row.display_name,
    username: row.username,
  }));
}

export async function addMissingMembers(
  members: MissingMemberInput[],
  client?: pg.PoolClient
): Promise<number> {
  if (members.length === 0) {
    return 0;
  }

  const trelloMemberIds = members.map((member) => member.trelloMemberId);
  const displayNames = members.map((member) => member.displayName);
  const usernames = members.map((member) => member.username);

  const result = await db(client).query<{ trello_member_id: string }>(
    `
      insert into members (trello_member_id, display_name, username, last_seen_at)
      select trello_member_id, display_name, username, now()
      from unnest($1::text[], $2::text[], $3::text[]) as input(
        trello_member_id,
        display_name,
        username
      )
      on conflict (trello_member_id) do nothing
      returning trello_member_id
    `,
    [trelloMemberIds, displayNames, usernames]
  );

  return result.rowCount ?? 0;
}

export async function listLabelSyncBoards(
  client?: pg.PoolClient
): Promise<ManagedBoardSummary[]> {
  const result = await db(client).query<ManagedBoardRow>(`
    select trello_board_id, board_name
    from trello_boards
    where label_sync_enabled = true
    order by board_name asc
  `);

  return result.rows.map((row) => ({
    trelloBoardId: row.trello_board_id,
    boardName: row.board_name,
  }));
}

export async function listManagedDepartmentIds(
  trelloMemberId: string,
  client?: pg.PoolClient
): Promise<string[]> {
  const result = await db(client).query<IdRow>(
    `
      select department_managers.department_id::text as id
      from department_managers
      inner join departments on departments.id = department_managers.department_id
      where department_managers.trello_member_id = $1
        and departments.archived_at is null
      order by department_managers.department_id asc
    `,
    [trelloMemberId]
  );

  return result.rows.map((row) => row.id);
}

export async function listManagedProjectIds(
  trelloMemberId: string,
  client?: pg.PoolClient
): Promise<string[]> {
  const result = await db(client).query<IdRow>(
    `
      select project_managers.project_id::text as id
      from project_managers
      inner join projects on projects.id = project_managers.project_id
      inner join departments on departments.id = projects.department_id
      where project_managers.trello_member_id = $1
        and projects.archived_at is null
        and departments.archived_at is null
      order by project_managers.project_id asc
    `,
    [trelloMemberId]
  );

  return result.rows.map((row) => row.id);
}

export async function getProjectDepartmentId(
  projectId: string,
  client?: pg.PoolClient
): Promise<string | null> {
  const result = await db(client).query<{ department_id: string }>(
    `
      select projects.department_id::text
      from projects
      inner join departments on departments.id = projects.department_id
      where projects.id = $1
        and projects.archived_at is null
        and departments.archived_at is null
    `,
    [projectId]
  );

  return result.rows[0]?.department_id ?? null;
}

export async function activeDepartmentExists(
  departmentId: string,
  client?: pg.PoolClient
): Promise<boolean> {
  const result = await db(client).query<{ exists: boolean }>(
    `
      select exists (
        select 1
        from departments
        where id = $1
          and archived_at is null
      )
    `,
    [departmentId]
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

export async function createProject(input: {
  departmentId: string;
  name: string;
}): Promise<ProjectSummary> {
  const result = await getDbPool().query<ProjectRow>(
    `
      insert into projects (department_id, name)
      select departments.id, $2
      from departments
      where departments.id = $1
        and departments.archived_at is null
      returning
        projects.id::text,
        projects.department_id::text,
        projects.name,
        (
          select departments.name
          from departments
          where departments.id = projects.department_id
        ) as department_name,
        (
          select departments.department_color
          from departments
          where departments.id = projects.department_id
        ) as department_color
    `,
    [input.departmentId, input.name]
  );

  return mapProject(requireRow(result.rows[0], "Project was not created."));
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

export async function addDepartmentManager(input: {
  departmentId: string;
  managerTrelloMemberId: string;
  grantedByMemberId: string;
}): Promise<void> {
  await getDbPool().query(
    `
      insert into department_managers (
        department_id,
        trello_member_id,
        granted_by_member_id
      )
      select departments.id, $2, $3
      from departments
      where departments.id = $1
        and departments.archived_at is null
      on conflict (department_id, trello_member_id) do nothing
    `,
    [input.departmentId, input.managerTrelloMemberId, input.grantedByMemberId]
  );
}

export async function removeDepartmentManager(input: {
  departmentId: string;
  managerTrelloMemberId: string;
}): Promise<void> {
  await getDbPool().query(
    `
      delete from department_managers
      where department_id = $1
        and trello_member_id = $2
    `,
    [input.departmentId, input.managerTrelloMemberId]
  );
}

export async function addProjectManager(input: {
  projectId: string;
  managerTrelloMemberId: string;
  grantedByMemberId: string;
}): Promise<void> {
  await getDbPool().query(
    `
      insert into project_managers (
        project_id,
        trello_member_id,
        granted_by_member_id
      )
      select projects.id, $2, $3
      from projects
      inner join departments on departments.id = projects.department_id
      where projects.id = $1
        and projects.archived_at is null
        and departments.archived_at is null
      on conflict (project_id, trello_member_id) do nothing
    `,
    [input.projectId, input.managerTrelloMemberId, input.grantedByMemberId]
  );
}

export async function removeProjectManager(input: {
  projectId: string;
  managerTrelloMemberId: string;
}): Promise<void> {
  await getDbPool().query(
    `
      delete from project_managers
      where project_id = $1
        and trello_member_id = $2
    `,
    [input.projectId, input.managerTrelloMemberId]
  );
}

export async function getBoardProjectLabel(input: {
  trelloBoardId: string;
  projectId: string;
}): Promise<BoardProjectLabelSummary | null> {
  const result = await getDbPool().query<BoardProjectLabelRow>(
    `
      select
        trello_board_id,
        project_id::text,
        trello_label_id,
        synced_label_text,
        synced_color
      from board_project_labels
      where trello_board_id = $1
        and project_id = $2
    `,
    [input.trelloBoardId, input.projectId]
  );

  const row = result.rows[0];

  return row ? mapBoardProjectLabel(row) : null;
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
      values ($1, $2, 'sync-error-' || $2::text, $3, $4, 'error', $5, now())
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

function mapManagerAssignment(
  row: ManagerAssignmentRow
): ManagerAssignmentSummary {
  return {
    ownerId: row.owner_id,
    trelloMemberId: row.trello_member_id,
    displayName: row.display_name,
    username: row.username,
  };
}

function mapDepartment(row: DepartmentRow): DepartmentSummary {
  return {
    id: row.id,
    name: row.name,
    departmentColor: row.department_color,
    sortOrder: row.sort_order,
  };
}

function mapProject(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    departmentId: row.department_id,
    name: row.name,
    labelText: `${row.department_name}: ${row.name}`,
    departmentColor: row.department_color,
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
  };
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) {
    throw new Error(message);
  }

  return row;
}
