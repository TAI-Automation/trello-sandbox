create table if not exists departments (
  id bigint generated always as identity primary key,
  name text not null,
  name_normalized text generated always as (lower(trim(name))) stored,
  department_color text not null,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    department_color in (
      'green', 'yellow', 'orange', 'red', 'purple', 'blue', 'sky', 'lime',
      'pink', 'black', 'green_light', 'yellow_light', 'orange_light',
      'red_light', 'purple_light', 'blue_light', 'sky_light', 'lime_light',
      'pink_light', 'black_light', 'green_dark', 'yellow_dark', 'orange_dark',
      'red_dark', 'purple_dark', 'blue_dark', 'sky_dark', 'lime_dark',
      'pink_dark', 'black_dark'
    )
  )
);

create unique index if not exists departments_active_name_unique
  on departments (name_normalized)
  where archived_at is null;

create unique index if not exists departments_active_color_unique
  on departments (department_color)
  where archived_at is null;
