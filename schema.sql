
create table if not exists users (
  tg_id integer primary key,
  username text,
  first_name text,
  last_name text,
  joined_at integer default (strftime('%s','now'))
);

create table if not exists submissions (
  id integer primary key autoincrement,
  tg_id integer not null,
  game_id integer not null,
  photo_id text,
  plate_text text,
  is_valid integer default 1,
  points integer default 0,
  created_at integer default (strftime('%s','now')),
  unique (game_id, tg_id, plate_text)
);

create table if not exists bonuses (
  id integer primary key autoincrement,
  tg_id integer not null,
  game_id integer not null,
  kind text,
  amount integer not null,
  reason text,
  created_at integer default (strftime('%s','now'))
);
