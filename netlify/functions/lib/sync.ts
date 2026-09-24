import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type League = 'nfl' | 'cfb';
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football';
const path = (l: League) => (l === 'nfl' ? 'nfl' : 'college-football');

export function admin(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ESPN's CDN sometimes hands non-browser clients an HTML error page; retry a few times.
export async function getJson(url: string, tries = 3): Promise<any> {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'curl/8.7.1', Accept: 'application/json' } });
    const t = await r.text();
    try {
      return JSON.parse(t);
    } catch {
      if (i >= tries) throw new Error(`ESPN non-JSON (${r.status}) for ${url}`);
      await new Promise(res => setTimeout(res, 600 * (i + 1)));
    }
  }
}

interface Row {
  id: number;
  league: League;
  espn_event_id: string | null;
  kickoff: string;
  status: string;
  away_score: number | null;
  home_score: number | null;
  status_detail: string | null;
  possession: string | null;
  situation: string | null;
  market_spread: number | null;
  market_total: number | null;
  weeks: { season: number; nfl_week: number | null; cfb_week: number | null; status: string };
}

function parse(e: any, league: League) {
  const c = e.competitions?.[0] ?? e.header?.competitions?.[0];
  const st = (c?.status ?? e.status)?.type ?? {};
  const away = c.competitors.find((t: any) => t.homeAway === 'away');
  const home = c.competitors.find((t: any) => t.homeAway === 'home');
  const status =
    st.name === 'STATUS_CANCELED' ? 'canceled' : st.state === 'post' && st.completed ? 'final' : st.state === 'in' ? 'in' : 'scheduled';
  const o = c.odds?.[0];
  let market: number | null = null;
  if (o && typeof o.spread === 'number') {
    const homeFav = o.homeTeamOdds?.favorite ?? String(o.details ?? '').startsWith(home.team.abbreviation + ' ');
    market = homeFav ? -Math.abs(o.spread) : Math.abs(o.spread);
  }
  const sit = c.situation;
  return {
    kickoff: c.date ?? e.date,
    status,
    away_score: status === 'scheduled' ? null : Number(away.score ?? 0),
    home_score: status === 'scheduled' ? null : Number(home.score ?? 0),
    status_detail: st.shortDetail ?? st.detail ?? null,
    possession: status === 'in' && sit?.possession ? `${league}-${sit.possession}` : null,
    situation: status === 'in' ? sit?.downDistanceText ?? sit?.shortDownDistanceText ?? null : null,
    market_spread: status === 'scheduled' ? market : undefined,
    market_total: status === 'scheduled' ? (o?.overUnder ?? null) : undefined,
  };
}

/**
 * Pull scores from ESPN into the games table.
 * `full` also refreshes upcoming games (kickoff moves + public lines); otherwise only games that
 * have kicked off (or are about to) are checked, which keeps the per-minute job cheap.
 */
export async function syncScores({ full = false } = {}) {
  const sb = admin();
  const now = Date.now();
  const hi = new Date(now + (full ? 9 * 864e5 : 15 * 6e4)).toISOString();
  const lo = new Date(now - 4 * 864e5).toISOString();
  const { data, error } = await sb
    .from('games')
    .select('id,league,espn_event_id,kickoff,status,away_score,home_score,status_detail,possession,situation,market_spread,market_total,weeks!inner(season,nfl_week,cfb_week,status)')
    .in('status', ['scheduled', 'in'])
    .gte('kickoff', lo)
    .lte('kickoff', hi)
    .neq('weeks.status', 'draft');
  if (error) throw error;
  const rows = (data ?? []) as unknown as Row[];
  if (!rows.length) return { checked: 0, updated: 0 };

  // One scoreboard call per (league, week); college pulls FBS and FCS.
  const events = new Map<string, any>();
  const keys = new Set(rows.map(r => `${r.league}|${r.league === 'nfl' ? r.weeks.nfl_week : r.weeks.cfb_week}|${r.weeks.season}`));
  for (const k of keys) {
    const [league, week, season] = k.split('|');
    if (week === 'null') continue;
    const groups = league === 'nfl' ? [''] : ['&groups=80', '&groups=81'];
    for (const g of groups) {
      try {
        const d = await getJson(`${BASE}/${path(league as League)}/scoreboard?seasontype=2&week=${week}&dates=${season}${g}&limit=400`);
        for (const e of d.events ?? []) events.set(e.id, e);
      } catch (e) {
        console.warn(String(e));
      }
    }
  }

  let updated = 0;
  for (const r of rows) {
    if (!r.espn_event_id) continue;
    let e = events.get(r.espn_event_id);
    if (!e) {
      try {
        const s = await getJson(`${BASE}/${path(r.league)}/summary?event=${r.espn_event_id}`);
        e = { id: r.espn_event_id, ...s.header };
      } catch {
        continue;
      }
    }
    const p = parse(e, r.league);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined) continue;
      const cur = (r as any)[k];
      if (k === 'kickoff' ? new Date(cur).getTime() !== new Date(v as string).getTime() : cur == null ? v != null : Number.isFinite(Number(cur)) && typeof v === 'number' ? Number(cur) !== v : cur !== v)
        patch[k] = v;
    }
    if (Object.keys(patch).length) {
      patch.updated_at = new Date().toISOString();
      const { error: ue } = await sb.from('games').update(patch).eq('id', r.id);
      if (ue) console.warn(ue.message);
      else updated++;
    }
  }
  return { checked: rows.length, updated };
}
