// One-time: fill games.broadcast for existing weeks from ESPN's scoreboards. Needs migration 0005.
//   node --env-file=.env scripts/backfill-broadcast.mjs
import { createClient } from '@supabase/supabase-js';
import { getJson } from './legacy-codes.mjs';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const broadcastOf = c => {
  const names = [...new Set((c.broadcasts ?? []).flatMap(b => b.names ?? []))];
  if (!names.length) names.push(...new Set((c.geoBroadcasts ?? []).map(g => g.media?.shortName).filter(Boolean)));
  return names.length ? names.slice(0, 2).join('/') : null;
};

const weeks = (await sb.from('weeks').select('*')).data;
const games = (await sb.from('games').select('id,league,espn_event_id,week_id')).data;
const tv = new Map();
for (const w of weeks) {
  const urls = [];
  if (w.nfl_week) urls.push(`${BASE}/nfl/scoreboard?seasontype=2&week=${w.nfl_week}&dates=${w.season}`);
  if (w.cfb_week) for (const g of ['80', '81']) urls.push(`${BASE}/college-football/scoreboard?seasontype=2&week=${w.cfb_week}&dates=${w.season}&groups=${g}&limit=400`);
  for (const u of urls) for (const e of (await getJson(u)).events ?? []) tv.set(e.id, broadcastOf(e.competitions[0]));
}
let n = 0;
for (const g of games) {
  const b = tv.get(g.espn_event_id);
  if (!b) continue;
  const { error } = await sb.from('games').update({ broadcast: b }).eq('id', g.id);
  if (error) throw new Error(error.message);
  n++;
}
console.log(`broadcast set on ${n}/${games.length} games`);
