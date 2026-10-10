-- TV network for each game, e.g. "ESPN", "FOX", "ESPN+".
alter table games add column if not exists broadcast text;
