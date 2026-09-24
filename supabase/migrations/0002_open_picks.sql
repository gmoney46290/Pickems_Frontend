-- Everyone can see everyone's picks at all times (the group picks together anyway).
drop policy if exists "read picks" on picks;
create policy "read picks" on picks for select using (true);
