-- AP rank and record for each team as of that game (frozen at kickoff).
alter table games add column if not exists away_rank int;
alter table games add column if not exists home_rank int;
alter table games add column if not exists away_record text;
alter table games add column if not exists home_record text;
