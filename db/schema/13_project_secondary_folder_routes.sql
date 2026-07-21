create table if not exists project_secondary_folder_routes (
  id bigint generated always as identity primary key,
  project_id bigint not null references projects(id) on delete cascade,
  folder_path text not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, folder_path),
  check (trim(folder_path) <> '')
);

create index if not exists project_secondary_folder_routes_project_sort_idx
  on project_secondary_folder_routes (project_id, sort_order);
