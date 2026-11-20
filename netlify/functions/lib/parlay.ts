import { admin, getJson } from './sync';

// Parlay Party: build a weekly slate of goofy NFL props from ESPN and grade them from box scores.

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';

interface Team { id: string; abbr: string; name: string; full: string; logo?: string; games: number }
interface Game { id: string; kickoff: string; name: string; away: Team; home: Team; night: boolean }
interface Athlete { id: string; name: string; pos: string; headshot: string | null; teamAbbr: string; seasonValue: number; starter: boolean }
interface Leaders { qb?: Athlete; rb?: Athlete; wr1?: Athlete; wr2?: Athlete }
interface Option { key: string; label: string; img?: string | null; sub?: string }
interface PropRow {
  kind: string; emoji: string; title: string; detail?: string; event_ids: string[];
  params: Record<string, unknown>; options: Option[]; locks_at: string;
}

const rand = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const shuffle = <T,>(a: T[]) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
};
const half = (n: number) => Math.floor(n) + 0.5; // every line ends in .5, so no pushes
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
/** "Kenneth Walker III" and "Kenneth Walker" compare equal */
export const normName = (s: string) => norm(s.replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/i, ''));
const fmtOdds = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const ou = (line: number, unit = ''): Option[] => [
  { key: 'over', label: `Over ${line}${unit}` },
  { key: 'under', label: `Under ${line}${unit}` },
];
const yesNo: Option[] = [{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }];
const gameLabel = (g: Game) => `${g.away.abbr} @ ${g.home.abbr}`;

function parseTeam(c: any): Team {
  const rec = c.records?.find((r: any) => r.type === 'total')?.summary ?? '0-0';
  const games = rec.split('-').reduce((s: number, x: string) => s + (Number(x) || 0), 0);
  return { id: c.team.id, abbr: c.team.abbreviation, name: c.team.shortDisplayName ?? c.team.displayName, full: c.team.displayName, logo: c.team.logo, games: Math.max(games, 1) };
}

/** The NFL week to build: ESPN's current week, or the next one once every game in it is done. */
export async function upcomingWeek() {
  let d = await getJson(`${SITE}/scoreboard`);
  const allDone = (d.events ?? []).length > 0 && d.events.every((e: any) => e.status?.type?.completed);
  if (allDone) {
    const next = await getJson(`${SITE}/scoreboard?seasontype=${d.season.type}&week=${d.week.number + 1}&dates=${d.season.year}`);
    if ((next.events ?? []).length) d = next;
    else d = await getJson(`${SITE}/scoreboard?seasontype=3&week=1&dates=${d.season.year}`); // regular season → playoffs
  }
  return { season: d.season.year as number, seasonType: d.season.type as number, week: d.week.number as number, events: (d.events ?? []) as any[] };
}

export async function teamLeaders(team: Team, season: number, seasonType: number): Promise<Leaders> {
  const d = await getJson(`${CORE}/seasons/${season}/types/${seasonType === 3 ? 2 : seasonType}/teams/${team.id}/leaders`).catch(() => null);
  if (!d) return {};
  const cat = (name: string, i = 0) => d.categories?.find((c: any) => c.name === name)?.leaders?.[i];
  const load = async (l: any): Promise<Athlete | undefined> => {
    if (!l?.athlete?.$ref) return undefined;
    const a = await getJson(String(l.athlete.$ref).replace(/^http:/, 'https:')).catch(() => null);
    if (!a) return undefined;
    return { id: String(a.id), name: a.displayName, pos: a.position?.abbreviation ?? '', headshot: a.headshot?.href ?? null, teamAbbr: team.abbr, seasonValue: Number(l.value) || 0, starter: true };
  };
  const [qb, rb, wr1, wr2] = await Promise.all([load(cat('passingLeader')), load(cat('rushingLeader')), load(cat('receivingLeader')), load(cat('receivingLeader', 1))]);
  // Season leaders can be benched or hurt now, so check the current offensive depth chart.
  const starters = await depthStarters(team, season);
  const mark = (a?: Athlete) => a && { ...a, starter: !starters || starters.has(a.id) };
  return { qb: mark(qb), rb: mark(rb), wr1: mark(wr1), wr2: mark(wr2) };
}

/** QB1, RB1, TE1 and every listed WR starter on the offensive depth chart (null if unavailable). */
async function depthStarters(team: Team, season: number): Promise<Set<string> | null> {
  const d = await getJson(`${CORE}/seasons/${season}/teams/${team.id}/depthcharts`).catch(() => null);
  const offense = d?.items?.find((it: any) => it.positions?.qb);
  if (!offense) return null;
  const ids = new Set<string>();
  const idOf = (a: any) => String(a.athlete?.$ref ?? '').split('/athletes/')[1]?.split('?')[0];
  for (const [pos, v] of Object.entries<any>(offense.positions)) {
    const athletes = v.athletes ?? [];
    if (pos === 'wr') athletes.filter((a: any) => a.rank <= 7).forEach((a: any) => ids.add(idOf(a))); // WR slots are flattened (ranks 1,4,7 = starters)
    else if (['qb', 'rb', 'te'].includes(pos)) athletes.filter((a: any) => a.rank === 1).forEach((a: any) => ids.add(idOf(a)));
  }
  return ids;
}

// ---------------------------------------------------------------- real lines (The Odds API)

const ODDS = 'https://api.the-odds-api.com/v4/sports/americanfootball_nfl';
const BOOKS = ['draftkings', 'fanduel', 'betmgm', 'caesars', 'espnbet'];
interface OddsOutcome { name: string; description?: string; price: number; point?: number }
type Markets = Map<string, OddsOutcome[]>;
interface RosterAthlete { id: string; name: string; pos: string; headshot: string | null; teamAbbr: string }

/** What the Odds API calls did this run (for the debug endpoint and logs). */
export const oddsLog: { calls: number; remaining: string | null; sample?: unknown; error?: string } = { calls: 0, remaining: null };
const who = (o: OddsOutcome) => o.description ?? o.name;

async function oddsJson(url: string) {
  const r = await fetch(url);
  oddsLog.calls++;
  oddsLog.remaining = r.headers.get('x-requests-remaining');
  if (!r.ok) throw new Error(`Odds API ${r.status}: ${(await r.text()).slice(0, 150)}`);
  return r.json();
}

/** Finds the Odds API event for an ESPN game by team names + kickoff. Listing events is free. */
async function oddsEventIndex(key: string): Promise<(g: Game) => string | null> {
  const evs: any[] = await oddsJson(`${ODDS}/events?apiKey=${key}`);
  return g =>
    evs.find(e => norm(e.home_team) === norm(g.home.full) && norm(e.away_team) === norm(g.away.full) && Math.abs(Date.parse(e.commence_time) - Date.parse(g.kickoff)) < 864e5)?.id ?? null;
}

/** Player prop markets for one game, taking each market from the first book that has it. 1 credit per market. */
async function eventMarkets(key: string, eventId: string, markets: string[]): Promise<Markets> {
  const d = await oddsJson(`${ODDS}/events/${eventId}/odds?apiKey=${key}&oddsFormat=american&markets=${markets.join(',')}&bookmakers=${BOOKS.join(',')}`);
  oddsLog.sample ??= (d.bookmakers ?? []).slice(0, 1).map((b: any) => ({ book: b.key, markets: (b.markets ?? []).map((m: any) => ({ key: m.key, outcomes: m.outcomes.slice(0, 3) })) }));
  const out: Markets = new Map();
  const books = [...BOOKS.map(k => d.bookmakers?.find((b: any) => b.key === k)).filter(Boolean), ...(d.bookmakers ?? [])];
  for (const b of books) for (const m of b.markets ?? []) if (!out.has(m.key) && m.outcomes?.length) out.set(m.key, m.outcomes);
  return out;
}

/** ESPN roster keyed by normalized name, for headshots and grading ids. */
async function rosterIndex(team: Team): Promise<Map<string, RosterAthlete>> {
  const d = await getJson(`${SITE}/teams/${team.id}/roster`).catch(() => null);
  const map = new Map<string, RosterAthlete>();
  for (const grp of d?.athletes ?? [])
    for (const a of grp.items ?? [])
      map.set(normName(a.displayName ?? a.fullName ?? ''), { id: String(a.id), name: a.displayName, pos: a.position?.abbreviation ?? '', headshot: a.headshot?.href ?? null, teamAbbr: team.abbr });
  return map;
}

// ---------------------------------------------------------------- generation

const GAME_FUN = ['odd_even', 'margin', 'penalties', 'turnovers', 'sacks', 'punts', 'kicker_miss', 'long_fg'] as const;
const SLATE_FUN = ['any_ot', 'safety', 'return_td', 'pick_six', 'forty', 'shutout'] as const;

function gameFunProp(kind: (typeof GAME_FUN)[number], g: Game): PropRow {
  const base = { event_ids: [g.id], locks_at: g.kickoff, params: {} as Record<string, unknown> };
  const where = gameLabel(g);
  switch (kind) {
    case 'odd_even':
      return { ...base, kind, emoji: '🎲', title: `Total points in ${where}: odd or even?`, detail: 'Pure coin flip. Embrace the chaos.', options: [{ key: 'odd', label: 'Odd' }, { key: 'even', label: 'Even' }] };
    case 'margin':
      return { ...base, kind, emoji: '📏', title: `Winning margin in ${where}`, detail: 'A tie voids it.', options: [{ key: '1-3', label: '1–3' }, { key: '4-7', label: '4–7' }, { key: '8-14', label: '8–14' }, { key: '15+', label: '15+' }] };
    case 'penalties':
      return { ...base, kind, emoji: '🚩', title: `Who gets flagged for more penalty yards in ${where}?`, detail: 'Dirtiest team wins. A tie voids it.', options: [{ key: g.away.id, label: g.away.abbr, img: g.away.logo }, { key: g.home.id, label: g.home.abbr, img: g.home.logo }] };
    case 'turnovers':
      return { ...base, kind, emoji: '🧈', title: `Total turnovers in ${where}`, detail: 'Butterfingers watch (both teams).', params: { line: 2.5 }, options: ou(2.5) };
    case 'sacks':
      return { ...base, kind, emoji: '💥', title: `Total sacks in ${where}`, detail: 'QBs taking a nap (both teams).', params: { line: 4.5 }, options: ou(4.5) };
    case 'punts':
      return { ...base, kind, emoji: '🦶', title: `Total punts in ${where}`, detail: 'Celebrate the punters (both teams).', params: { line: 7.5 }, options: ou(7.5) };
    case 'kicker_miss':
      return { ...base, kind, emoji: '😬', title: `Does any kicker miss a FG or extra point in ${where}?`, detail: 'Blocked ones count as misses.', options: yesNo };
    case 'long_fg':
      return { ...base, kind, emoji: '🦵', title: `Longest made field goal in ${where}`, detail: 'No field goals at all = under.', params: { line: 47.5 }, options: ou(47.5, ' yds') };
  }
}

function slateFunProp(kind: (typeof SLATE_FUN)[number], games: Game[], locks: string): PropRow {
  const base = { kind, event_ids: games.map(g => g.id), locks_at: locks, params: {}, options: yesNo };
  const n = `${games.length} games`;
  switch (kind) {
    case 'any_ot': return { ...base, emoji: '⏰', title: 'Will any game go to overtime?', detail: `Across this week's ${n}.` };
    case 'safety': return { ...base, emoji: '🛡️', title: 'Will anyone score a safety?', detail: `Across this week's ${n}. Rare but glorious.` };
    case 'return_td': return { ...base, emoji: '🏃', title: 'Will there be a kickoff or punt return TD?', detail: `Across this week's ${n}.` };
    case 'pick_six': return { ...base, emoji: '🔁', title: 'Will anyone throw a pick-six?', detail: `Across this week's ${n}.` };
    case 'forty': return { ...base, emoji: '🍔', title: 'Will any team hang 40+ points?', detail: `Across this week's ${n}.` };
    case 'shutout': return { ...base, emoji: '🥚', title: 'Will any team get shut out?', detail: `Across this week's ${n}. Goose egg alert.` };
  }
}

/** Pick this week's props from ESPN (no database writes). */
export async function buildSlate(wk?: Awaited<ReturnType<typeof upcomingWeek>>) {
  wk ??= await upcomingWeek();

  const soon = Date.now() + 30 * 60e3;
  const games: Game[] = wk.events
    .filter(e => e.status?.type?.state === 'pre' && new Date(e.date).getTime() > soon)
    .map(e => {
      const c = e.competitions[0];
      const hourPT = (new Date(e.date).getUTCHours() + 16) % 24;
      return { id: e.id, kickoff: e.date, name: e.shortName, away: parseTeam(c.competitors.find((t: any) => t.homeAway === 'away')), home: parseTeam(c.competitors.find((t: any) => t.homeAway === 'home')), night: hourPT >= 17 || hourPT < 4 };
    })
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  if (games.length < 3) return { wk, props: [] as PropRow[], reason: `only ${games.length} games left to build from` };

  // How many of each bet a week gets (20 total).
  const COUNT = { firstTd: 2, yards: 5, anytime: 3, gameFun: 5, slateFun: 4 } as const;

  // First-TD games: the 49ers if they play, then night games, then anything.
  const byPriority = [
    ...games.filter(g => g.away.abbr === 'SF' || g.home.abbr === 'SF'),
    ...shuffle(games.filter(g => g.night)),
    ...shuffle(games),
  ];
  const featured = [...new Map(byPriority.map(g => [g.id, g])).values()].slice(0, COUNT.firstTd);
  const others = shuffle(games.filter(g => !featured.some(f => f.id === g.id)));
  const leaderCache = new Map<string, Promise<Leaders>>();
  const leadersOf = (t: Team) => {
    if (!leaderCache.has(t.id)) leaderCache.set(t.id, teamLeaders(t, wk.season, wk.seasonType));
    return leaderCache.get(t.id)!;
  };

  const props: PropRow[] = [];
  const used = new Set<string>();

  // Real sportsbook lines when we have an Odds API key; ESPN season averages otherwise.
  const key = process.env.ODDS_API_KEY;
  let oddsId: ((g: Game) => string | null) | null = null;
  if (key) {
    try {
      oddsId = await oddsEventIndex(key);
    } catch (e) {
      oddsLog.error = String(e);
    }
  }
  const rosters = new Map<string, Promise<Map<string, RosterAthlete>>>();
  const rosterOf = (t: Team) => {
    if (!rosters.has(t.id)) rosters.set(t.id, rosterIndex(t));
    return rosters.get(t.id)!;
  };
  const lookup = async (g: Game, name: string) => (await rosterOf(g.away)).get(normName(name)) ?? (await rosterOf(g.home)).get(normName(name));
  const optKey = (a: RosterAthlete | undefined, name: string) => a?.id ?? `n:${normName(name)}`;
  const markets = async (g: Game, list: string[]) => {
    const id = oddsId?.(g);
    if (!id || !key) return null;
    try {
      return await eventMarkets(key, id, list);
    } catch (e) {
      oddsLog.error = String(e);
      return null;
    }
  };

  // 🏈 First TD scorer (one per featured game)
  for (const fg of featured) {
    let done = false;
    const m = await markets(fg, ['player_1st_td']);
    const outs = (m?.get('player_1st_td') ?? []).filter(o => o.name !== 'No' && !/no\s*(td|touchdown)/i.test(who(o))).sort((a, b) => a.price - b.price);
    const opts: (Option & { name: string })[] = [];
    for (const o of outs.slice(0, 6)) {
      const n = who(o);
      const a = await lookup(fg, n);
      opts.push({ key: optKey(a, n), label: a?.name ?? n, name: n, sub: `${a ? `${a.teamAbbr} ${a.pos} · ` : ''}${fmtOdds(o.price)}`, img: a?.headshot ?? null });
    }
    if (opts.length >= 3) {
      opts.forEach(o => used.add(o.key));
      props.push({ kind: 'first_td', emoji: '🏈', title: `First TD scorer in ${gameLabel(fg)}`, detail: 'Real sportsbook odds. Whoever crosses the goal line first (a QB throwing it doesn\'t count).', event_ids: [fg.id], locks_at: fg.kickoff, params: { source: 'odds', names: Object.fromEntries(opts.map(o => [o.key, o.name])) }, options: [...opts.map(({ name, ...o }) => o), { key: 'other', label: 'Someone else (or no TD)', sub: 'the field' }] });
      done = true;
    }
    if (!done) {
      const [la, lh] = await Promise.all([leadersOf(fg.away), leadersOf(fg.home)]);
      const cands = [la.rb, la.wr1, la.wr2, lh.rb, lh.wr1, lh.wr2].filter((a): a is Athlete => !!a?.starter);
      const seen = new Set<string>();
      const fopts: Option[] = cands.filter(a => !seen.has(a.id) && seen.add(a.id)).map(a => ({ key: a.id, label: a.name, sub: `${a.teamAbbr} ${a.pos}`, img: a.headshot }));
      if (fopts.length >= 3) {
        fopts.push({ key: 'other', label: 'Someone else (or no TD)', sub: 'the field' });
        props.push({ kind: 'first_td', emoji: '🏈', title: `First TD scorer in ${gameLabel(fg)}`, detail: 'Whoever crosses the goal line first (a QB throwing it doesn\'t count).', event_ids: [fg.id], locks_at: fg.kickoff, params: { names: Object.fromEntries(cands.map(a => [a.id, a.name])) }, options: fopts });
        cands.forEach(a => used.add(a.id));
      }
    }
  }

  // 📈 Yardage over/unders + 🔥 anytime TDs, at most one of each per game for variety
  const statKinds = shuffle(['passing', 'rushing', 'receiving'] as const);
  const STAT_MARKET = { passing: 'player_pass_yds', rushing: 'player_rush_yds', receiving: 'player_reception_yds' } as const;
  // Skip backups with tiny lines (a 15.5-yard rushing line is no fun).
  const MIN_LINE = { passing: 150, rushing: 35, receiving: 30 } as const;
  let made = 0;
  let anytimes = 0;
  if (oddsId) {
    for (const g of others) {
      if (made >= COUNT.yards && anytimes >= COUNT.anytime) break;
      const m = await markets(g, ['player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_anytime_td']);
      if (!m) continue;
      if (made < COUNT.yards) {
        const first = statKinds[made % 3];
        for (const stat of [first, ...statKinds.filter(k => k !== first)]) {
          const outs = m.get(STAT_MARKET[stat]) ?? [];
          const overs = outs
            .filter(o => o.name === 'Over' && o.point != null && o.point >= MIN_LINE[stat] && !used.has(`n:${normName(who(o))}`))
            .sort((a, b) => b.point! - a.point!); // biggest lines = the main guys
          const over = rand(overs.slice(0, 2));
          if (!over) continue;
          const n = who(over);
          const under = outs.find(o => who(o) === n && o.name === 'Under');
          const a = await lookup(g, n);
          if (a && used.has(a.id)) continue;
          used.add(optKey(a, n));
          const line = over.point!;
          props.push({ kind: 'yards_ou', emoji: '📈', title: `${a?.name ?? n} ${stat} yards`, detail: `${gameLabel(g)} · real sportsbook line`, event_ids: [g.id], locks_at: g.kickoff, params: { source: 'odds', athlete: a?.id ?? null, name: n, stat, line }, options: [{ key: 'over', label: `Over ${line}`, sub: fmtOdds(over.price), img: a?.headshot ?? null }, { key: 'under', label: `Under ${line}`, sub: under ? fmtOdds(under.price) : undefined, img: a?.headshot ?? null }] });
          made++;
          break;
        }
      }
      if (anytimes < COUNT.anytime) {
        const yes = (m.get('player_anytime_td') ?? []).filter(o => o.name !== 'No' && !used.has(`n:${normName(who(o))}`));
        const fun = yes.filter(o => o.price >= 110 && o.price <= 400); // live underdogs are more fun
        const o = rand(fun.length ? fun : yes);
        if (o) {
          const n = who(o);
          const a = await lookup(g, n);
          if (!a || !used.has(a.id)) {
            used.add(optKey(a, n));
            props.push({ kind: 'anytime_td', emoji: '🔥', title: `Will ${a?.name ?? n} score a TD?`, detail: `${gameLabel(g)}${a ? ` · ${a.teamAbbr} ${a.pos}` : ''}. Rushing, receiving or returns all count.`, event_ids: [g.id], locks_at: g.kickoff, params: { source: 'odds', athlete: a?.id ?? null, name: n }, options: [{ key: 'yes', label: 'Yes', sub: fmtOdds(o.price), img: a?.headshot ?? null }, { key: 'no', label: 'No', img: a?.headshot ?? null }] });
            anytimes++;
          }
        }
      }
    }
  }
  // ESPN season-average fallback for whatever the odds didn't cover
  for (const g of others) {
    if (made >= COUNT.yards) break;
    const stat = statKinds[made % 3];
    const side = rand([g.away, g.home]);
    const l = await leadersOf(side);
    const a = stat === 'passing' ? l.qb : stat === 'rushing' ? l.rb : l.wr1;
    if (!a || !a.starter || used.has(a.id) || a.seasonValue <= 0) continue;
    used.add(a.id);
    const line = half(a.seasonValue / side.games);
    made++;
    props.push({ kind: 'yards_ou', emoji: '📈', title: `${a.name} ${stat} yards`, detail: `${gameLabel(g)} · season avg ${(a.seasonValue / side.games).toFixed(1)}/game`, event_ids: [g.id], locks_at: g.kickoff, params: { athlete: a.id, name: a.name, stat, line }, options: ou(line).map(o => ({ ...o, img: a.headshot })) });
  }
  for (const g of shuffle(others)) {
    if (anytimes >= COUNT.anytime) break;
    const l = await leadersOf(rand([g.away, g.home]));
    const a = rand([l.rb, l.wr1].filter((x): x is Athlete => !!x?.starter && !used.has(x.id)));
    if (!a) continue;
    used.add(a.id);
    anytimes++;
    props.push({ kind: 'anytime_td', emoji: '🔥', title: `Will ${a.name} score a TD?`, detail: `${gameLabel(g)} · ${a.teamAbbr} ${a.pos}. Rushing, receiving or returns all count.`, event_ids: [g.id], locks_at: g.kickoff, params: { athlete: a.id, name: a.name }, options: yesNo.map(o => ({ ...o, img: a.headshot })) });
  }

  // 🎲 Game oddities, each on a different game
  const funGames = shuffle(games);
  shuffle([...GAME_FUN]).slice(0, COUNT.gameFun).forEach((k, i) => props.push(gameFunProp(k, funGames[i % funGames.length])));

  // ⏰ Slate-wide yes/nos
  const firstKick = games[0].kickoff;
  shuffle([...SLATE_FUN]).slice(0, COUNT.slateFun).forEach(k => props.push(slateFunProp(k, games, firstKick)));

  // 🎆 Highest-scoring game among four
  const four = shuffle(games).slice(0, 4).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  props.push({ kind: 'highest_scoring', emoji: '🎆', title: 'Which game scores the most total points?', detail: 'Ties: everyone on a tied game wins.', event_ids: four.map(g => g.id), locks_at: four[0].kickoff, params: {}, options: four.map(g => ({ key: g.id, label: gameLabel(g), img: g.home.logo })) });

  return { wk, props, reason: null as string | null };
}

/** Build this week's slate if it doesn't exist yet. Returns what happened. */
export async function generateParlayWeek({ force = false } = {}) {
  const sb = admin();
  const wk = await upcomingWeek();
  const { data: existing } = await sb.from('parlay_weeks').select('id').match({ season: wk.season, season_type: wk.seasonType, week: wk.week }).maybeSingle();
  if (existing && !force) return { created: false, week: wk.week, reason: 'already built' };
  if (existing) {
    // Rebuilding deletes the old props (and their picks), so only allow it before anyone has picked.
    const { data: ids } = await sb.from('parlay_props').select('id').eq('week_id', existing.id);
    const { count } = await sb.from('parlay_entries').select('prop_id', { count: 'exact', head: true }).in('prop_id', (ids ?? []).map(r => r.id));
    if (count) return { created: false, week: wk.week, reason: `can't rebuild: ${count} picks already made` };
  }
  const { props, reason } = await buildSlate(wk);
  if (reason) return { created: false, week: wk.week, reason };

  // Write it (replace on force)
  let weekId = existing?.id as number | undefined;
  if (!weekId) {
    const ins = await sb.from('parlay_weeks').insert({ season: wk.season, season_type: wk.seasonType, week: wk.week }).select('id').single();
    if (ins.error) throw ins.error;
    weekId = ins.data.id;
  } else {
    await sb.from('parlay_props').delete().eq('week_id', weekId);
  }
  const rows = props.map((p, i) => ({ ...p, week_id: weekId, sort: i }));
  const { error } = await sb.from('parlay_props').insert(rows);
  if (error) throw error;
  return { created: true, week: wk.week, props: rows.length };
}

// ---------------------------------------------------------------- grading

interface Box {
  final: boolean; canceled: boolean; ot: boolean; away: number; home: number; awayId: string; homeId: string;
  scoring: { type: string; text: string; team: string }[];
  teamStat: (teamId: string, name: string) => string | undefined;
  /** by ESPN id, else by name; undefined = not in the box score at all (didn't play) */
  playerStat: (athleteId: string | null, name: string, group: string, label: string) => number | undefined;
  groupRows: (group: string) => { stats: string[]; labels: string[] }[];
}

export async function boxScore(eventId: string): Promise<Box> {
  const d = await getJson(`${SITE}/summary?event=${eventId}`);
  const c = d.header.competitions[0];
  const st = c.status.type;
  const away = c.competitors.find((t: any) => t.homeAway === 'away'), home = c.competitors.find((t: any) => t.homeAway === 'home');
  const teams = d.boxscore?.teams ?? [];
  const players = d.boxscore?.players ?? [];
  return {
    final: st.completed && st.state === 'post',
    canceled: st.name === 'STATUS_CANCELED' || st.name === 'STATUS_POSTPONED',
    ot: /OT/.test(st.detail ?? '') || /OT/.test(st.shortDetail ?? ''),
    away: Number(away.score), home: Number(home.score), awayId: away.team.id, homeId: home.team.id,
    scoring: (d.scoringPlays ?? []).map((p: any) => ({ type: p.type?.abbreviation ?? '', text: p.text ?? '', team: p.team?.id ?? '' })),
    teamStat: (teamId, name) => teams.find((t: any) => t.team.id === teamId)?.statistics?.find((s: any) => s.name === name)?.displayValue,
    playerStat: (athleteId, name, group, label) => {
      let seen = false;
      const nn = normName(name);
      for (const t of players)
        for (const g of t.statistics ?? []) {
          const row = g.athletes?.find((a: any) => (athleteId && String(a.athlete.id) === athleteId) || normName(a.athlete.displayName ?? '') === nn);
          if (!row) continue;
          seen = true;
          if (g.name === group) return Number(String(row.stats[g.labels.indexOf(label)]).replace(/,/g, '')) || 0;
        }
      return seen ? 0 : undefined;
    },
    groupRows: group => players.flatMap((t: any) => (t.statistics ?? []).filter((g: any) => g.name === group).flatMap((g: any) => (g.athletes ?? []).map((a: any) => ({ stats: a.stats, labels: g.labels })))),
  };
}

const tdPlays = (b: Box) => b.scoring.filter(s => s.type === 'TD');
const scoredBy = (text: string, name: string) => !!name && norm(text).startsWith(normName(name));
const sumTeams = (b: Box, name: string, pick = (v: string) => Number(v) || 0) =>
  [b.awayId, b.homeId].reduce((s, id) => s + pick(b.teamStat(id, name) ?? '0'), 0);
const madeAtt = (v: string) => { const [m, a] = v.split('/').map(Number); return { m: m || 0, a: a || 0 }; };

/** Decide a prop. Returns winning keys, or void with a reason. */
export function grade(kind: string, params: any, boxes: Box[], options: { key: string }[]): { results?: string[]; void?: string; note?: string } {
  const b = boxes[0];
  switch (kind) {
    case 'first_td': {
      const first = tdPlays(b)[0];
      if (!first) return { results: ['other'], note: 'No touchdowns at all' };
      const hit = options.find(o => o.key !== 'other' && scoredBy(first.text, params.names?.[o.key] ?? ''));
      return { results: [hit ? hit.key : 'other'], note: first.text };
    }
    case 'anytime_td': {
      if (b.playerStat(params.athlete, params.name, 'none', '') === undefined) return { void: `${params.name} didn't play` };
      const td = tdPlays(b).find(p => scoredBy(p.text, params.name));
      return { results: [td ? 'yes' : 'no'], note: td?.text ?? `${params.name} didn't score` };
    }
    case 'yards_ou': {
      const y = b.playerStat(params.athlete, params.name, params.stat, 'YDS');
      if (y === undefined) return { void: `${params.name} didn't play` };
      return { results: [y > params.line ? "over" : "under"], note: `${params.name}: ${y} ${params.stat} yds` };
    }
    case 'odd_even': {
      const t = b.away + b.home;
      return { results: [t % 2 ? 'odd' : 'even'], note: `${b.away}-${b.home} (${t} points)` };
    }
    case 'margin': {
      const m = Math.abs(b.away - b.home);
      if (!m) return { void: 'Tie game' };
      return { results: [m <= 3 ? '1-3' : m <= 7 ? '4-7' : m <= 14 ? '8-14' : '15+'], note: `Won by ${m}` };
    }
    case 'penalties': {
      const yds = (id: string) => Number((b.teamStat(id, 'totalPenaltiesYards') ?? '0-0').split('-')[1]) || 0;
      const [a, h] = [yds(b.awayId), yds(b.homeId)];
      if (a === h) return { void: `Both teams had ${a} penalty yards` };
      return { results: [a > h ? b.awayId : b.homeId], note: `${a} vs ${h} penalty yards` };
    }
    case 'turnovers': { const t = sumTeams(b, 'turnovers'); return { results: [t > params.line ? 'over' : 'under'], note: `${t} turnovers` }; }
    case 'sacks': { const t = sumTeams(b, 'sacksYardsLost', v => Number(v.split('-')[0]) || 0); return { results: [t > params.line ? 'over' : 'under'], note: `${t} sacks` }; }
    case 'punts': {
      const t = b.groupRows('punting').reduce((s, r) => s + (Number(r.stats[r.labels.indexOf('NO')]) || 0), 0);
      return { results: [t > params.line ? 'over' : 'under'], note: `${t} punts` };
    }
    case 'kicker_miss': {
      const miss = b.groupRows('kicking').some(r => {
        const fg = madeAtt(r.stats[r.labels.indexOf('FG')] ?? '0/0'), xp = madeAtt(r.stats[r.labels.indexOf('XP')] ?? '0/0');
        return fg.m < fg.a || xp.m < xp.a;
      });
      return { results: [miss ? 'yes' : 'no'], note: miss ? 'Somebody shanked one' : 'Kickers were perfect' };
    }
    case 'long_fg': {
      const longest = Math.max(0, ...b.scoring.filter(s => s.type === 'FG').map(s => Number(s.text.match(/(\d+)\s*Yd/i)?.[1]) || 0));
      return { results: [longest > params.line ? 'over' : 'under'], note: longest ? `Longest: ${longest} yds` : 'No field goals' };
    }
    case 'any_ot': { const n = boxes.filter(x => x.ot).length; return { results: [n ? 'yes' : 'no'], note: `${n} OT game${n === 1 ? '' : 's'}` }; }
    case 'safety': { const n = boxes.flatMap(x => x.scoring).filter(s => s.type === 'SF' || /safety/i.test(s.text)).length; return { results: [n ? 'yes' : 'no'], note: `${n} safet${n === 1 ? 'y' : 'ies'}` }; }
    case 'return_td': { const p = boxes.flatMap(tdPlays).find(s => /kickoff return|punt return/i.test(s.text)); return { results: [p ? 'yes' : 'no'], note: p?.text ?? 'None' }; }
    case 'pick_six': { const p = boxes.flatMap(tdPlays).find(s => /interception return/i.test(s.text)); return { results: [p ? 'yes' : 'no'], note: p?.text ?? 'None' }; }
    case 'forty': { const hi = Math.max(...boxes.flatMap(x => [x.away, x.home])); return { results: [hi >= 40 ? 'yes' : 'no'], note: `High score: ${hi}` }; }
    case 'shutout': { const lo = Math.min(...boxes.flatMap(x => [x.away, x.home])); return { results: [lo === 0 ? 'yes' : 'no'], note: `Low score: ${lo}` }; }
  }
  return { void: `Unknown prop type ${kind}` };
}

/** Grade every open prop whose games are all final. */
export async function gradeParlay() {
  const sb = admin();
  const { data: props, error } = await sb.from('parlay_props').select('*').eq('status', 'open').lte('locks_at', new Date().toISOString());
  if (error) throw error;
  const cache = new Map<string, Promise<Box>>();
  const box = (id: string) => {
    if (!cache.has(id)) cache.set(id, boxScore(id));
    return cache.get(id)!;
  };
  let graded = 0;
  for (const p of props ?? []) {
    try {
      const boxes = await Promise.all((p.event_ids as string[]).map(box));
      const live = boxes.filter(b => !b.canceled);
      if (!live.length) {
        await sb.from('parlay_props').update({ status: 'void', result_note: 'Game canceled', graded_at: new Date().toISOString() }).eq('id', p.id);
        continue;
      }
      if (live.some(b => !b.final)) continue;
      let r;
      if (p.kind === 'highest_scoring') {
        const totals = (p.event_ids as string[]).map((id, i) => ({ id, t: boxes[i].canceled ? -1 : boxes[i].away + boxes[i].home }));
        const max = Math.max(...totals.map(x => x.t));
        r = { results: totals.filter(x => x.t === max).map(x => x.id), note: `Top total: ${max} points` };
      } else r = grade(p.kind, p.params, live, p.options);
      const patch = r.void
        ? { status: 'void', result_note: r.void, graded_at: new Date().toISOString() }
        : { status: 'graded', results: r.results, result_note: r.note ?? null, graded_at: new Date().toISOString() };
      const { error: ue } = await sb.from('parlay_props').update(patch).eq('id', p.id);
      if (ue) console.warn(ue.message);
      else graded++;
    } catch (e) {
      console.warn('parlay grade', p.id, String(e));
    }
  }
  return { checked: props?.length ?? 0, graded };
}
