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
  away: EspnTeam & { rank?: number; record?: string };
  home: EspnTeam & { rank?: number; record?: string };
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

/** "ESPN", or "FOX/FS1" when it's on more than one network. */
export function broadcastOf(c: any): string | null {
  const names: string[] = [...new Set<string>((c.broadcasts ?? []).flatMap((b: any) => b.names ?? []))];
  if (!names.length) {
    const geo = (c.geoBroadcasts ?? []).map((g: any) => g.media?.shortName).filter(Boolean);
    names.push(...new Set<string>(geo));
  }
  return names.length ? names.slice(0, 2).join('/') : null;
}

function parseEvent(e: any, league: League): EspnGame {
  const c = e.competitions[0];
  const side = (ha: string) => {
    const t = c.competitors.find((x: any) => x.homeAway === ha);
    const rank = t.curatedRank?.current;
    const record = t.records?.find((r: any) => r.type === 'total' || r.name === 'overall')?.summary;
    return { ...t.team, rank: rank && rank < 99 ? rank : undefined, record };
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
    broadcast: broadcastOf(c),
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

export interface RecentGame {
  date: string;
  opp: string;
  oppLogo?: string;
  home: boolean;
  us: number;
  them: number;
  result: 'W' | 'L' | 'T';
}

const recentCache = new Map<string, Promise<RecentGame[]>>();

/** A team's completed games before `before` (most recent first). */
export function fetchRecent(league: League, espnId: string, season: number, before: string): Promise<RecentGame[]> {
  const key = `${league}-${espnId}-${season}-${before}`;
  if (!recentCache.has(key)) {
    recentCache.set(
      key,
      getJson(`${BASE}/${path(league)}/teams/${espnId}/schedule?season=${season}`)
        .then(d =>
          (d.events ?? [])
            .filter((e: any) => e.competitions?.[0]?.status?.type?.completed && e.date < before)
            .map((e: any): RecentGame => {
              const c = e.competitions[0].competitors;
              const us = c.find((t: any) => t.team.id === espnId), them = c.find((t: any) => t.team.id !== espnId);
              const a = Number(us?.score?.value ?? us?.score?.displayValue ?? 0), b = Number(them?.score?.value ?? them?.score?.displayValue ?? 0);
              return {
                date: e.date,
                opp: them?.team?.abbreviation ?? '?',
                oppLogo: them?.team?.logos?.[0]?.href ?? them?.team?.logo,
                home: us?.homeAway === 'home',
                us: a,
                them: b,
                result: a > b ? 'W' : a < b ? 'L' : 'T',
              };
            })
            .reverse(),
        )
        .catch(() => []),
    );
  }
  return recentCache.get(key)!;
}

export interface KeyPlayer {
  category: string; // "Passing", "Rushing", "Receiving"
  name: string;
  position: string;
  jersey: string | null;
  headshot: string | null;
  stat: string; // "63/89, 900 YDS, 6 TD"
}

const leaderCache = new Map<string, Promise<KeyPlayer[]>>();
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues';
const LEADER_CATS: [string, string][] = [['passingLeader', 'Passing'], ['rushingLeader', 'Rushing'], ['receivingLeader', 'Receiving']];
const https = (u: string) => u.replace(/^http:/, 'https:');

/** A team's season leaders (top passer, rusher, receiver) with headshots and season stat lines. */
export function fetchKeyPlayers(league: League, espnTeamId: string, season: number): Promise<KeyPlayer[]> {
  const key = `${league}-${espnTeamId}-${season}`;
  if (!leaderCache.has(key)) {
    leaderCache.set(
      key,
      getJson(`${CORE}/${path(league)}/seasons/${season}/types/2/teams/${espnTeamId}/leaders`)
        .then(async d => {
          const cats = d.categories ?? [];
          const picks = LEADER_CATS.map(([name, label]) => ({ label, l: cats.find((c: any) => c.name === name)?.leaders?.[0] })).filter(x => x.l?.athlete?.$ref);
          return Promise.all(
            picks.map(async ({ label, l }): Promise<KeyPlayer> => {
              const a = await getJson(https(l.athlete.$ref)).catch(() => ({}));
              return {
                category: label,
                name: a.displayName ?? a.shortName ?? '—',
                position: a.position?.abbreviation ?? '',
                jersey: a.jersey ?? null,
                headshot: a.headshot?.href ?? null,
                stat: l.displayValue ?? '',
              };
            }),
          );
        })
        .catch(() => []),
    );
  }
  return leaderCache.get(key)!;
}
