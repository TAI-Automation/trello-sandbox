create table if not exists trello_boards (
  trello_board_id text primary key,
  board_name text not null,
  enforcement_enabled boolean not null default false,
  label_sync_enabled boolean not null default true,
  trello_webhook_id text,
  webhook_active boolean not null default false,
  last_label_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
