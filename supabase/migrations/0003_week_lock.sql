-- Admins can lock a whole week's picks at a set time (or immediately).
alter table weeks add column if not exists locks_at timestamptz;

drop policy if exists "insert own picks before kickoff" on picks;
drop policy if exists "update own picks before kickoff" on picks;
drop policy if exists "delete own picks before kickoff" on picks;

create policy "insert own picks before lock" on picks for insert with check (
  player_id = me() and exists (
    select 1 from games g join weeks w on w.id = g.week_id
    where g.id = game_id and w.status = 'open' and g.kickoff > now()
      and (w.locks_at is null or w.locks_at > now())));

create policy "update own picks before lock" on picks for update using (
  player_id = me() and exists (
    select 1 from games g join weeks w on w.id = g.week_id
    where g.id = game_id and w.status = 'open' and g.kickoff > now()
      and (w.locks_at is null or w.locks_at > now())));

create policy "delete own picks before lock" on picks for delete using (
  player_id = me() and exists (
    select 1 from games g join weeks w on w.id = g.week_id
    where g.id = game_id and w.status = 'open' and g.kickoff > now()
      and (w.locks_at is null or w.locks_at > now())));

-- Lock this week (week 2) right now.
update weeks set locks_at = now() where season = 2026 and number = 2;
