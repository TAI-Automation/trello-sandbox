create table if not exists project_folder_routes (
  project_id bigint primary key references projects(id) on delete cascade,
  folder_path text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (trim(folder_path) <> '')
);

create index if not exists project_folder_routes_enabled_project_id_idx
  on project_folder_routes (project_id)
  where enabled = true;
