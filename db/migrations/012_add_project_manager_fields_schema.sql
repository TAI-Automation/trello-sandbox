create table if not exists app_settings (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into app_settings (key, value)
values ('project_manager_cap', '3')
on conflict (key) do nothing;

create table if not exists members (
  trello_member_id text primary key,
  display_name text not null,
  username text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists members_display_name_index
  on members (lower(display_name));

create table if not exists project_managers (
  project_id bigint not null references projects(id) on delete cascade,
  trello_member_id text not null references members(trello_member_id) on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (project_id, trello_member_id)
);

create index if not exists project_managers_member_index
  on project_managers (trello_member_id);
