create table if not exists members (
  trello_member_id text primary key,
  display_name text not null,
  username text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
