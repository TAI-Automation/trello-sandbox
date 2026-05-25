create table if not exists project_managers (
  project_id bigint not null references projects(id),
  trello_member_id text not null references members(trello_member_id),
  granted_by_member_id text not null,
  created_at timestamptz not null default now(),
  primary key (project_id, trello_member_id)
);
