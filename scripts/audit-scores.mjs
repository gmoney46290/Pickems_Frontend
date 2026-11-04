// Compare every final game's score with ESPN and report mismatches.
//   node --env-file=.env scripts/audit-scores.mjs          # report only
//   node --env-file=.env scripts/audit-scores.mjs --fix    # also write ESPN's final scores
import { createClient } from '@supabase/supabase-js';
import { getJson } from './legacy-codes.mjs';
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const weeks = (await sb.from('weeks').select('*')).data;
const games = (await sb.from('games').select('id,week_id,league,espn_event_id,away_score,home_score,status')).data;
const ev = new Map();
for (const w of weeks) {
  const urls = [];
  if (w.nfl_week) urls.push(`${BASE}/nfl/scoreboard?seasontype=2&week=${w.nfl_week}&dates=${w.season}`);
  if (w.cfb_week) for (const g of ['80', '81']) urls.push(`${BASE}/college-football/scoreboard?seasontype=2&week=${w.cfb_week}&dates=${w.season}&groups=${g}&limit=400`);
  for (const u of urls) for (const e of (await getJson(u)).events ?? []) ev.set(e.id, e);
}
let checked = 0, bad = [];
for (const g of games.filter(g => g.status === 'final')) {
  const e = ev.get(g.espn_event_id);
  if (!e) { bad.push({ id: g.id, wk: g.week_id, issue: 'not on ESPN scoreboard' }); continue; }
  const c = e.competitions[0], a = c.competitors.find(t => t.homeAway === 'away'), h = c.competitors.find(t => t.homeAway === 'home');
  checked++;
  if (+a.score !== g.away_score || +h.score !== g.home_score || !e.status.type.completed)
    bad.push({ id: g.id, wk: g.week_id, game: e.shortName, ours: `${g.away_score}-${g.home_score}`, espn: `${a.score}-${h.score}`, espnStatus: e.status.type.name });
}
console.log(`checked ${checked} final games against ESPN; mismatches: ${bad.length}`);
for (const b of bad) console.log(b);
if (process.argv.includes('--fix'))
  for (const b of bad.filter(b => b.espn && b.espnStatus === 'STATUS_FINAL')) {
    const [a, h] = b.espn.split('-').map(Number);
    const { error } = await sb.from('games').update({ away_score: a, home_score: h, updated_at: new Date().toISOString() }).eq('id', b.id);
    console.log(error ? `failed ${b.id}: ${error.message}` : `fixed ${b.game}: ${b.ours} -> ${b.espn}`);
  }
