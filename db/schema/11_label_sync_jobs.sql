create table if not exists label_sync_jobs (
  job_key text primary key,
  current_board_id text,
  phase text not null default 'starting'
    check (phase in ('starting', 'syncing', 'done')),
  total_boards integer not null default 0,
  total_labels integer not null default 0,
  synced integer not null default 0,
  failed integer not null default 0,
  done boolean not null default false,
  error text,
  tasks jsonb not null default '[]'::jsonb,
  next_task_index integer not null default 0,
  board_failures jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
