create table if not exists projects (
  id bigint generated always as identity primary key,
  department_id bigint not null references departments(id),
  name text not null,
  name_normalized text generated always as (lower(trim(name))) stored,
  label_text text not null unique,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, name_normalized)
);
