create table if not exists project_managers (
  project_id bigint not null references projects(id) on delete cascade,
  trello_member_id text not null references members(trello_member_id) on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (project_id, trello_member_id)
);

create index if not exists project_managers_member_index
  on project_managers (trello_member_id);
