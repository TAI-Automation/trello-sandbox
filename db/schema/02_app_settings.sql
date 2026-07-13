create table if not exists app_settings (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into app_settings (key, value)
values ('project_manager_cap', '3')
on conflict (key) do nothing;
