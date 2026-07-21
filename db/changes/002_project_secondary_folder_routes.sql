with ranked_project_folder_routes as (
  select
    ctid,
    row_number() over (
      partition by project_id
      order by updated_at desc, created_at desc
    ) as row_number
  from project_folder_routes
)
delete from project_folder_routes
using ranked_project_folder_routes
where project_folder_routes.ctid = ranked_project_folder_routes.ctid
  and ranked_project_folder_routes.row_number > 1;

create unique index if not exists project_folder_routes_project_id_unique
  on project_folder_routes (project_id);

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
