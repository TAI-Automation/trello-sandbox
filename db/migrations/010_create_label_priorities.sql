create table if not exists label_priorities (
  trello_card_id text primary key,
  trello_board_id text not null,
  priority smallint not null,
  updated_by_member_id text not null,
  archived_since timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (priority between 1 and 10)
);

create index if not exists label_priorities_board_id_idx
  on label_priorities (trello_board_id);

create index if not exists label_priorities_archived_since_idx
  on label_priorities (archived_since)
  where archived_since is not null;
