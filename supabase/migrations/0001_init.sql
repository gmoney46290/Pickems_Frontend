-- Pickems schema. Run once in the Supabase SQL editor (or `supabase db push`).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables

create table players (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  emoji text not null default '🏈',
  color text not null default '#ff5da2',
  user_id uuid unique references auth.users(id) on delete set null,
  is_admin boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- One row per ESPN team, e.g. id 'nfl-25' or 'cfb-248'.
create table teams (
  id text primary key,
  league text not null check (league in ('nfl', 'cfb')),
  espn_id text not null,
  abbr text not null,
  short_name text not null,
  name text not null,
  logo text,
  color text,
  alt_color text,
  legacy_code text,
  unique (league, espn_id)
);

create table weeks (
  id serial primary key,
  season int not null,
  number int not null,
  label text,
  nfl_week int,
  cfb_week int,
  status text not null default 'draft' check (status in ('draft', 'open', 'final')),
  score_picks int not null default 3,   -- score calls allowed per player
  dd_per_league int not null default 1, -- double downs per league per player
  created_at timestamptz not null default now(),
  unique (season, number)
);

create table phases (
  id serial primary key,
  season int not null,
  name text not null,
  emoji text not null default '🏆',
  sort int not null default 0
);

create table phase_weeks (
  phase_id int not null references phases(id) on delete cascade,
  week_id int not null references weeks(id) on delete cascade,
  primary key (phase_id, week_id)
);

create table games (
  id serial primary key,
  week_id int not null references weeks(id) on delete cascade,
  league text not null check (league in ('nfl', 'cfb')),
  espn_event_id text,
  away_team_id text not null references teams(id),
  home_team_id text not null references teams(id),
  neutral boolean not null default false,
  kickoff timestamptz not null,
  home_spread numeric(5,1) not null,   -- OUR line (the one we pick against). negative = home favored. "BUF -7.5" at home = -7.5
  market_spread numeric(5,1),          -- public line (DraftKings via ESPN), kept fresh by the sync job
  market_total numeric(5,1),
  away_score int,
  home_score int,
  status text not null default 'scheduled' check (status in ('scheduled', 'in', 'final', 'canceled')),
  status_detail text,                  -- "Q3 4:12", "Final/OT"
  possession text,                     -- team id with the ball, when live
  situation text,                      -- "3rd & 7 at KC 32"
  sort int not null default 0,
  updated_at timestamptz not null default now(),
  unique (week_id, espn_event_id)
);
create index on games (week_id);
create index on games (status, kickoff);

create table picks (
  id bigserial primary key,
  game_id int not null references games(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  pick_team_id text references teams(id),
  is_dd boolean not null default false,
  score_away int check (score_away between 0 and 199),
  score_home int check (score_home between 0 and 199),
  updated_at timestamptz not null default now(),
  unique (game_id, player_id),
  check ((score_away is null) = (score_home is null))
);
create index on picks (player_id);

-- Multi-book odds cache filled by the Netlify `odds` function (The Odds API).
create table odds_cache (
  game_id int not null references games(id) on delete cascade,
  book text not null,
  home_spread numeric(5,1),
  home_price int,
  away_price int,
  total numeric(5,1),
  updated_at timestamptz not null default now(),
  primary key (game_id, book)
);

-- Private settings (join code). No policies = nobody but service role reads it.
create table league_secrets (
  id int primary key default 1 check (id = 1),
  join_code text not null
);
insert into league_secrets (join_code) values ('touchdown');

-- ---------------------------------------------------------------- helpers

create or replace function me() returns uuid
language sql stable security definer set search_path = public as $$
  select id from players where user_id = auth.uid()
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from players where user_id = auth.uid()), false)
$$;

-- Claim an unclaimed player with the league join code.
create or replace function claim_player(p_player uuid, p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Log in first'; end if;
  if not exists (select 1 from league_secrets where lower(join_code) = lower(trim(p_code))) then
    raise exception 'Wrong join code, pal';
  end if;
  if exists (select 1 from players where user_id = auth.uid()) then
    raise exception 'You already are somebody';
  end if;
  update players set user_id = auth.uid() where id = p_player and user_id is null;
  if not found then raise exception 'That player is already claimed'; end if;
end $$;

-- Join as a brand-new player with the league join code.
create or replace function join_as_new_player(p_name text, p_emoji text, p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Log in first'; end if;
  if not exists (select 1 from league_secrets where lower(join_code) = lower(trim(p_code))) then
    raise exception 'Wrong join code, pal';
  end if;
  if exists (select 1 from players where user_id = auth.uid()) then
    raise exception 'You already are somebody';
  end if;
  insert into players (name, emoji, user_id, sort)
  values (trim(p_name), coalesce(nullif(p_emoji, ''), '🏈'), auth.uid(), (select coalesce(max(sort), 0) + 1 from players))
  returning id into new_id;
  return new_id;
end $$;

create or replace function set_join_code(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update league_secrets set join_code = trim(p_code) where id = 1;
end $$;

create or replace function get_join_code() returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return (select join_code from league_secrets where id = 1);
end $$;

-- Enforce the per-week double-down and score-call limits.
create or replace function check_pick_limits() returns trigger
language plpgsql security definer set search_path = public as $$
declare wk weeks%rowtype; lg text; n int;
begin
  select w.* into wk from games g join weeks w on w.id = g.week_id where g.id = new.game_id;
  select league into lg from games where id = new.game_id;
  if new.is_dd then
    select count(*) into n from picks p join games g on g.id = p.game_id
      where p.player_id = new.player_id and g.week_id = wk.id and g.league = lg and p.is_dd and p.game_id <> new.game_id;
    if n >= wk.dd_per_league then
      raise exception 'You already used your % double down this week', case lg when 'nfl' then 'pro' else 'college' end;
    end if;
  end if;
  if new.score_away is not null then
    select count(*) into n from picks p join games g on g.id = p.game_id
      where p.player_id = new.player_id and g.week_id = wk.id and p.score_away is not null and p.game_id <> new.game_id;
    if n >= wk.score_picks then
      raise exception 'Only % score calls per week, you greedy goblin', wk.score_picks;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger picks_limits before insert or update on picks
  for each row execute function check_pick_limits();

-- ---------------------------------------------------------------- scoring

-- ATS result per game: 'home' | 'away' | 'push' | null (not final)
create or replace view game_results with (security_invoker = on) as
select g.*,
  case
    when g.status <> 'final' or g.home_score is null or g.away_score is null then null
    when g.home_score - g.away_score + g.home_spread > 0 then 'home'
    when g.home_score - g.away_score + g.home_spread < 0 then 'away'
    else 'push'
  end as ats_result
from games g;

create or replace view pick_scores with (security_invoker = on) as
select p.id, p.game_id, p.player_id, p.pick_team_id, p.is_dd, p.score_away, p.score_home,
  g.week_id, g.league, g.ats_result,
  case
    when g.ats_result is null or p.pick_team_id is null then 0
    when g.ats_result = 'push' then 0
    when (g.ats_result = 'home' and p.pick_team_id = g.home_team_id)
      or (g.ats_result = 'away' and p.pick_team_id = g.away_team_id)
      then case when p.is_dd then 2 else 1 end
    else case when p.is_dd then -1 else 0 end
  end as ats_points,
  case
    when g.ats_result is not null and p.score_away is not null
      and abs(p.score_away - g.away_score) <= 2 and abs(p.score_home - g.home_score) <= 2
      then 3 else 0
  end as score_points
from picks p join game_results g on g.id = p.game_id;

-- ---------------------------------------------------------------- RLS

alter table players enable row level security;
alter table teams enable row level security;
alter table weeks enable row level security;
alter table phases enable row level security;
alter table phase_weeks enable row level security;
alter table games enable row level security;
alter table picks enable row level security;
alter table odds_cache enable row level security;
alter table league_secrets enable row level security;

-- Everything but picks is readable by anyone (the board is fun to share).
create policy "read players" on players for select using (true);
create policy "read teams" on teams for select using (true);
create policy "read weeks" on weeks for select using (status <> 'draft' or is_admin());
create policy "read phases" on phases for select using (true);
create policy "read phase_weeks" on phase_weeks for select using (true);
create policy "read games" on games for select using (
  exists (select 1 from weeks w where w.id = week_id and (w.status <> 'draft' or is_admin())));
create policy "read odds" on odds_cache for select using (true);

-- Picks: always see your own; everyone's become visible at kickoff.
create policy "read picks" on picks for select using (
  player_id = me() or is_admin()
  or exists (select 1 from games g where g.id = game_id and g.kickoff <= now()));

create policy "insert own picks before kickoff" on picks for insert with check (
  player_id = me() and exists (
    select 1 from games g join weeks w on w.id = g.week_id
    where g.id = game_id and w.status = 'open' and g.kickoff > now()));

create policy "update own picks before kickoff" on picks for update using (
  player_id = me() and exists (
    select 1 from games g join weeks w on w.id = g.week_id
    where g.id = game_id and w.status = 'open' and g.kickoff > now()));

create policy "delete own picks before kickoff" on picks for delete using (
  player_id = me() and exists (
    select 1 from games g join weeks w on w.id = g.week_id
    where g.id = game_id and w.status = 'open' and g.kickoff > now()));

-- Players can edit their own emoji/color.
create policy "update self" on players for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and is_admin = (select p.is_admin from players p where p.user_id = auth.uid()));

-- Admins can do everything.
create policy "admin players" on players for all using (is_admin()) with check (is_admin());
create policy "admin teams" on teams for all using (is_admin()) with check (is_admin());
create policy "admin weeks" on weeks for all using (is_admin()) with check (is_admin());
create policy "admin phases" on phases for all using (is_admin()) with check (is_admin());
create policy "admin phase_weeks" on phase_weeks for all using (is_admin()) with check (is_admin());
create policy "admin games" on games for all using (is_admin()) with check (is_admin());
create policy "admin picks" on picks for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------- realtime

alter publication supabase_realtime add table games, picks;
