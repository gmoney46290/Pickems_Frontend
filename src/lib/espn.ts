import type { League, Team } from './types';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football';
const path = (l: League) => (l === 'nfl' ? 'nfl' : 'college-football');

export interface EspnTeam {
  id: string;
  abbreviation: string;
  shortDisplayName: string;
  displayName: string;
  logo?: string;
  color?: string;
  alternateColor?: string;
}

export interface EspnGame {
  eventId: string;
  league: League;
  name: string;
  kickoff: string;
  neutral: boolean;
  away: EspnTeam & { rank?: number };
  home: EspnTeam & { rank?: number };
  /** DraftKings spread from the home team's view, if posted */
  homeSpread: number | null;
  spreadDetails: string | null;
  overUnder: number | null;
  status: string;
  broadcast: string | null;
}

async function getJson(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`ESPN ${r.status}`);
  return r.json();
}

function parseEvent(e: any, league: League): EspnGame {
  const c = e.competitions[0];
  const side = (ha: string) => {
    const t = c.competitors.find((x: any) => x.homeAway === ha);
    const rank = t.curatedRank?.current;
    return { ...t.team, rank: rank && rank < 99 ? rank : undefined };
  };
  const home = side('home'), away = side('away');
  const o = c.odds?.[0];
  let homeSpread: number | null = null;
  if (o && typeof o.spread === 'number') {
    // ESPN's `spread` is from the favorite's view in `details` like "BUF -7"; homeTeamOdds tells us who
    const homeFav = o.homeTeamOdds?.favorite ?? (o.details ?? '').startsWith(home.abbreviation + ' ');
    homeSpread = homeFav ? -Math.abs(o.spread) : Math.abs(o.spread);
  }
  return {
    eventId: e.id,
    league,
    name: e.shortName,
    kickoff: e.date,
    neutral: !!c.neutralSite,
    home,
    away,
    homeSpread,
    spreadDetails: o?.details ?? null,
    overUnder: o?.overUnder ?? null,
    status: e.status?.type?.name ?? '',
    broadcast: c.broadcasts?.[0]?.names?.[0] ?? null,
  };
}

/** Full slate for a week. College pulls FBS plus FCS so FBS-vs-FCS games show up. */
export async function fetchSlate(league: League, week: number, season: number): Promise<EspnGame[]> {
  const urls =
    league === 'nfl'
      ? [`${BASE}/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`]
      : [80, 81].map(g => `${BASE}/college-football/scoreboard?seasontype=2&week=${week}&dates=${season}&groups=${g}&limit=400`);
  const seen = new Map<string, EspnGame>();
  for (const u of urls) {
    const d = await getJson(u);
    for (const e of d.events ?? []) if (!seen.has(e.id)) seen.set(e.id, parseEvent(e, league));
  }
  return [...seen.values()].sort((a, b) => a.kickoff.localeCompare(b.kickoff));
}

/** What ESPN currently calls the week, e.g. { nfl: 3, cfb: 4 } */
export async function currentWeeks(): Promise<{ nfl: number; cfb: number; season: number }> {
  const [n, c] = await Promise.all([getJson(`${BASE}/nfl/scoreboard`), getJson(`${BASE}/college-football/scoreboard`)]);
  return { nfl: n.week?.number ?? 1, cfb: c.week?.number ?? 1, season: n.season?.year ?? new Date().getFullYear() };
}

export function teamRow(t: EspnTeam, league: League): Team {
  return {
    id: `${league}-${t.id}`,
    league,
    espn_id: t.id,
    abbr: t.abbreviation,
    short_name: t.shortDisplayName,
    name: t.displayName,
    logo: t.logo ?? null,
    color: t.color ? `#${t.color}` : null,
    alt_color: t.alternateColor ? `#${t.alternateColor}` : null,
    legacy_code: null,
  };
}

export interface BookLine {
  book: string;
  homeSpread: number | null;
  total: number | null;
  homeML?: number | null;
  awayML?: number | null;
  open?: number | null;
  logo?: string;
}

/** ESPN's pickcenter: usually DraftKings with the opening line. */
export async function fetchEspnLines(league: League, eventId: string): Promise<BookLine[]> {
  const d = await getJson(`${BASE}/${path(league)}/summary?event=${eventId}`);
  return (d.pickcenter ?? []).map((p: any) => {
    const num = (v: any) => (v == null || isNaN(parseFloat(v)) ? null : parseFloat(v));
    const homeFav = p.homeTeamOdds?.favorite;
    const fallback = typeof p.spread === 'number' ? (homeFav ? -Math.abs(p.spread) : Math.abs(p.spread)) : null;
    return {
      book: p.provider?.name ?? 'ESPN',
      homeSpread: num(p.pointSpread?.home?.close?.line) ?? fallback,
      open: num(p.pointSpread?.home?.open?.line),
      total: p.overUnder ?? null,
      homeML: p.homeTeamOdds?.moneyLine ?? null,
      awayML: p.awayTeamOdds?.moneyLine ?? null,
      logo: p.provider?.logos?.find((l: any) => l.rel?.includes('light'))?.href,
    };
  });
}
