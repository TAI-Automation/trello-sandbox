import { getDbPool } from "../db/client.js";

export type ProjectFolderRoute = {
  projectName: string;
  folderPath: string;
  labelName: string;
};

type ProjectFolderRouteRow = {
  project_name: string;
  folder_path: string;
  label_name: string;
};

export async function resolveProjectFolderRoutes(
  boardId: string,
  labelIds: string[]
): Promise<ProjectFolderRoute[]> {
  if (labelIds.length === 0) {
    return [];
  }

  const result = await getDbPool().query<ProjectFolderRouteRow>(
    `
      with card_labels as (
        select
          label_id,
          ordinality
        from unnest($2::text[]) with ordinality as input(label_id, ordinality)
        where trim(label_id) <> ''
      )
      select
        projects.name as project_name,
        project_folder_routes.folder_path,
        board_project_labels.synced_label_text as label_name
      from card_labels
      join board_project_labels
        on board_project_labels.trello_board_id = $1
       and board_project_labels.trello_label_id = card_labels.label_id
       and board_project_labels.sync_status = 'synced'
      join projects
        on projects.id = board_project_labels.project_id
      join project_folder_routes
        on project_folder_routes.project_id = projects.id
      where projects.archived_at is null
        and project_folder_routes.enabled = true
      order by card_labels.ordinality asc
    `,
    [boardId, labelIds]
  );

  return result.rows.map((row) => ({
    projectName: row.project_name,
    folderPath: row.folder_path,
    labelName: row.label_name,
  }));
}
