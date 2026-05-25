create table if not exists department_managers (
  department_id bigint not null references departments(id),
  trello_member_id text not null references members(trello_member_id),
  granted_by_member_id text not null,
  created_at timestamptz not null default now(),
  primary key (department_id, trello_member_id)
);
