create table if not exists board_project_labels (
  trello_board_id text not null references trello_boards(trello_board_id) on delete cascade,
  project_id bigint not null references projects(id),
  trello_label_id text not null,
  synced_label_text text not null,
  synced_color text not null,
  sync_status text not null default 'pending',
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (trello_board_id, project_id),
  unique (trello_board_id, trello_label_id),
  check (sync_status in ('pending', 'synced', 'error'))
);
