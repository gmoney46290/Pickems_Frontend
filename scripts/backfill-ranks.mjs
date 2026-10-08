// One-time: fill games.away_rank/home_rank/away_record/home_record for existing weeks.
// Rank = the team's rank on ESPN's scoreboard for that week; record = W-L going into the game,
// counted from the team's schedule. Needs migration 0004 first.
//
//   node --env-file=.env scripts/backfill-ranks.mjs
import { createClient } from '@supabase/supabase-js';
import { getJson } from './legacy-codes.mjs';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football';
const path = l => (l === 'nfl' ? 'nfl' : 'college-football');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const weeks = (await sb.from('weeks').select('*')).data;
const games = (await sb.from('games').select('id,week_id,league,espn_event_id,away_team_id,home_team_id,kickoff')).data;
const teams = new Map((await sb.from('teams').select('id,espn_id,league')).data.map(t => [t.id, t]));

// ranks from each week's scoreboard
const rankOf = new Map(); // `${eventId}:${espnTeamId}` -> rank
for (const w of weeks) {
  for (const [league, wk] of [['nfl', w.nfl_week], ['cfb', w.cfb_week]]) {
    if (!wk || league === 'nfl') continue; // NFL has no AP rankings
    for (const g of ['80', '81']) {
      const d = await getJson(`${BASE}/${path(league)}/scoreboard?seasontype=2&week=${wk}&dates=${w.season}&groups=${g}&limit=400`);
      for (const e of d.events ?? [])
        for (const c of e.competitions[0].competitors) {
          const r = c.curatedRank?.current;
          if (r && r < 99) rankOf.set(`${e.id}:${c.team.id}`, r);
        }
    }
  }
}

// records going into each game, from team schedules
const sched = new Map();
async function recordBefore(team, season, kickoff) {
  const key = `${team.league}-${team.espn_id}-${season}`;
  if (!sched.has(key)) sched.set(key, (await getJson(`${BASE}/${path(team.league)}/teams/${team.espn_id}/schedule?season=${season}`)).events ?? []);
  let w = 0, l = 0, t = 0;
  for (const e of sched.get(key)) {
    const c = e.competitions?.[0];
    if (!c?.status?.type?.completed || e.date >= kickoff) continue;
    if (e.seasonType?.type !== undefined && e.seasonType.type !== 2) continue; // regular season only
    const us = c.competitors.find(x => x.team.id === team.espn_id), them = c.competitors.find(x => x.team.id !== team.espn_id);
    const a = Number(us?.score?.value ?? 0), b = Number(them?.score?.value ?? 0);
    if (a > b) w++; else if (a < b) l++; else t++;
  }
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}

let n = 0;
for (const g of games) {
  const season = weeks.find(w => w.id === g.week_id).season;
  const away = teams.get(g.away_team_id), home = teams.get(g.home_team_id);
  const patch = {
    away_rank: rankOf.get(`${g.espn_event_id}:${away.espn_id}`) ?? null,
    home_rank: rankOf.get(`${g.espn_event_id}:${home.espn_id}`) ?? null,
    away_record: await recordBefore(away, season, g.kickoff),
    home_record: await recordBefore(home, season, g.kickoff),
  };
  const { error } = await sb.from('games').update(patch).eq('id', g.id);
  if (error) throw new Error(error.message);
  n++;
}
console.log(`backfilled ${n} games (${[...rankOf.values()].length} ranked team-games seen)`);
