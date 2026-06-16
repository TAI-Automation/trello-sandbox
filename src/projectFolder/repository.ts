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

export async function resolveProjectFolderRoute(
  labels: string[]
): Promise<ProjectFolderRoute | null> {
  if (labels.length === 0) {
    return null;
  }

  const result = await getDbPool().query<ProjectFolderRouteRow>(
    `
      with card_labels as (
        select
          trim(label_name) as label_name,
          lower(trim(label_name)) as label_normalized,
          ordinality
        from unnest($1::text[]) with ordinality as input(label_name, ordinality)
        where trim(label_name) <> ''
      )
      select
        projects.name as project_name,
        project_folder_routes.folder_path,
        card_labels.label_name
      from card_labels
      join projects
        on projects.name_normalized = card_labels.label_normalized
      join project_folder_routes
        on project_folder_routes.project_id = projects.id
      where projects.archived_at is null
        and project_folder_routes.enabled = true
      order by card_labels.ordinality asc
      limit 1
    `,
    [labels]
  );

  const row = result.rows[0];

  return row
    ? {
        projectName: row.project_name,
        folderPath: row.folder_path,
        labelName: row.label_name,
      }
    : null;
}
