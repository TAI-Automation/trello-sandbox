create table if not exists project_manager_field_apply_jobs (
  board_id text primary key,
  phase text not null default 'starting'
    check (phase in ('starting', 'scanning', 'applying', 'done')),
  total_cards integer not null default 0,
  matched_cards integer not null default 0,
  updated integer not null default 0,
  unchanged integer not null default 0,
  skipped integer not null default 0,
  failed integer not null default 0,
  done boolean not null default false,
  error text,
  custom_field_id text,
  updates jsonb not null default '[]'::jsonb,
  next_update_index integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
