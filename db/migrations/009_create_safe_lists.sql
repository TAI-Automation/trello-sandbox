create table if not exists safe_lists (
  id bigint generated always as identity primary key,
  name text not null,
  name_normalized text generated always as (lower(btrim(name))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name_normalized),
  check (length(btrim(name)) > 0)
);

insert into safe_lists (name)
values ('In Progress'), ('To Be Reviewed')
on conflict (name_normalized) do nothing;
