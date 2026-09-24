// Import the old Google Sheet into Supabase.
//
//   python3 scripts/extract_sheet.py "Pickems 2026.xlsx"   # -> scripts/sheet-data.json
//   npm run import-sheet                                   # needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env
//
// Safe to re-run: everything upserts on natural keys.
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { LEGACY_TO_ESPN, LEGACY_WEEKS, fetchSlate, matchEvent } from './legacy-codes.mjs';

const SEASON = 2026;
const PLAYERS = [
  // sheet tab -> display
  { tab: 'CASE', name: 'Case', emoji: '💼', color: '#3a86ff' },
  { tab: 'Knos', name: 'Knos', emoji: '👃', color: '#ff7a1a' },
  { tab: 'G$', name: 'G$', emoji: '💸', color: '#22c55e' },
  { tab: 'Joe', name: 'Joe', emoji: '☕', color: '#8b5cf6' },
  { tab: 'Jessica', name: 'Jessica', emoji: '🦄', color: '#ff5da2' },
  { tab: 'Ethan', name: 'Ethan', emoji: '🦖', color: '#14b8a6' },
  { tab: 'Josh', name: 'Josh', emoji: '🐐', color: '#ffd23f' },
];

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
const sb = createClient(url, key, { auth: { persistSession: false } });
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

const data = JSON.parse(fs.readFileSync(new URL('./sheet-data.json', import.meta.url)));

// ---- players
const players = must(await sb.from('players').upsert(
  PLAYERS.map((p, i) => ({ name: p.name, emoji: p.emoji, color: p.color, sort: i + 1 })),
  { onConflict: 'name', ignoreDuplicates: false },
).select());
const playerByTab = Object.fromEntries(PLAYERS.map(p => [p.tab, players.find(x => x.name === p.name)]));
console.log(`players: ${players.length}`);

const teamRow = (t, league, legacy) => ({
  id: `${league}-${t.id}`, league, espn_id: t.id, abbr: t.abbreviation, short_name: t.shortDisplayName,
  name: t.displayName, logo: t.logo ?? null, color: t.color ? `#${t.color}` : null,
  alt_color: t.alternateColor ? `#${t.alternateColor}` : null, legacy_code: legacy,
});

const check = [];
for (const w of LEGACY_WEEKS) {
  const nfl = await fetchSlate('nfl', w.nflWeek, SEASON), cfb = await fetchSlate('cfb', w.cfbWeek, SEASON);
  const sheetGames = data.games.filter(g => g.row >= w.firstRow && g.row <= w.lastRow);
  const matched = sheetGames.map(g => {
    let league = 'nfl', e = matchEvent(nfl, g.away, g.home);
    if (!e) { league = 'cfb'; e = matchEvent(cfb, g.away, g.home); }
    if (!e) throw new Error(`No ESPN match for row ${g.row} ${g.away} @ ${g.home}`);
    const c = e.competitions[0];
    const home = c.competitors.find(t => t.homeAway === 'home'), away = c.competitors.find(t => t.homeAway === 'away');
    // the sheet's away/home may be flipped for neutral-site games; map codes by ESPN abbreviation
    const codeFor = abbr => [g.away, g.home].find(cd => (LEGACY_TO_ESPN[cd] ?? cd) === abbr);
    return { g, e, c, league, home, away, homeCode: codeFor(home.team.abbreviation), awayCode: codeFor(away.team.abbreviation) };
  });

  // ---- teams
  const teams = new Map();
  for (const m of matched) {
    teams.set(`${m.league}-${m.home.team.id}`, teamRow(m.home.team, m.league, m.homeCode));
    teams.set(`${m.league}-${m.away.team.id}`, teamRow(m.away.team, m.league, m.awayCode));
  }
  must(await sb.from('teams').upsert([...teams.values()]));

  // ---- week
  const allFinal = matched.every(m => m.e.status.type.completed);
  const week = must(await sb.from('weeks').upsert(
    { season: SEASON, number: w.number, nfl_week: w.nflWeek, cfb_week: w.cfbWeek, status: allFinal ? 'final' : 'open' },
    { onConflict: 'season,number' },
  ).select().single());

  // ---- games
  const gameRows = matched.map((m, i) => {
    const st = m.e.status.type;
    const status = st.completed ? 'final' : st.state === 'in' ? 'in' : 'scheduled';
    const lineTeamIsHome = (LEGACY_TO_ESPN[m.g.line_team] ?? m.g.line_team) === m.home.team.abbreviation;
    const o = m.c.odds?.[0];
    const market = o && typeof o.spread === 'number' ? (o.homeTeamOdds?.favorite ? -Math.abs(o.spread) : Math.abs(o.spread)) : null;
    return {
      week_id: week.id, league: m.league, espn_event_id: m.e.id,
      away_team_id: `${m.league}-${m.away.team.id}`, home_team_id: `${m.league}-${m.home.team.id}`,
      neutral: !!m.c.neutralSite, kickoff: m.e.date,
      home_spread: lineTeamIsHome ? m.g.line : -m.g.line,
      market_spread: market, market_total: o?.overUnder ?? null,
      away_score: status === 'scheduled' ? null : +m.away.score, home_score: status === 'scheduled' ? null : +m.home.score,
      status, status_detail: st.shortDetail ?? null, sort: i,
    };
  });
  const games = must(await sb.from('games').upsert(gameRows, { onConflict: 'week_id,espn_event_id' }).select());
  const gameByRow = Object.fromEntries(matched.map(m => [m.g.row, { m, game: games.find(x => x.espn_event_id === m.e.id) }]));

  // ---- picks. Score calls in the sheet were written "picked team's score first".
  const pickRows = [];
  for (const [tab, picks] of Object.entries(data.players)) {
    const pl = playerByTab[tab];
    for (const p of picks.filter(p => gameByRow[p.row])) {
      const { m, game } = gameByRow[p.row];
      const abbr = LEGACY_TO_ESPN[p.pick] ?? p.pick;
      const side = abbr === m.home.team.abbreviation ? 'home' : abbr === m.away.team.abbreviation ? 'away' : null;
      if (!side) throw new Error(`${tab} row ${p.row}: pick ${p.pick} not in ${m.e.shortName}`);
      let score_away = null, score_home = null;
      if (p.score) {
        const [mine, theirs] = p.score;
        [score_away, score_home] = side === 'away' ? [mine, theirs] : [theirs, mine];
      }
      pickRows.push({ game_id: game.id, player_id: pl.id, pick_team_id: side === 'home' ? game.home_team_id : game.away_team_id, is_dd: p.dd, score_away, score_home });
      check.push({ tab, row: p.row, game, side, dd: p.dd, sheetBonus: p.bonus, sheetResult: m.g.result, score_away, score_home, homeCode: m.homeCode });
    }
  }
  // clear DDs/score calls first so the per-week limit trigger never trips mid-upsert on re-runs
  await sb.from('picks').update({ is_dd: false, score_away: null, score_home: null }).in('game_id', games.map(g => g.id));
  must(await sb.from('picks').upsert(pickRows, { onConflict: 'game_id,player_id' }));
  console.log(`week ${w.number}: ${games.length} games, ${pickRows.length} picks, status ${week.status}`);
}

// ---- verify against the sheet's own formulas
const totals = {};
let mismatches = 0;
for (const c of check) {
  const g = c.game;
  const t = (totals[c.tab] ??= { ours: 0, sheet: 0 });
  // sheet: result column (ATS winner code) vs pick
  if (c.sheetResult) {
    const sheetWinnerSide = (c.sheetResult === c.homeCode) ? 'home' : 'away';
    t.sheet += c.side === sheetWinnerSide ? (c.dd ? 2 : 1) : (c.dd ? -1 : 0);
  }
  if (c.sheetBonus) t.sheet += 3;
  if (g.status === 'final') {
    const margin = g.home_score - g.away_score + Number(g.home_spread);
    const res = margin > 0 ? 'home' : margin < 0 ? 'away' : 'push';
    t.ours += res === 'push' ? 0 : res === c.side ? (c.dd ? 2 : 1) : (c.dd ? -1 : 0);
    const hit = c.score_away != null && Math.abs(c.score_away - g.away_score) <= 2 && Math.abs(c.score_home - g.home_score) <= 2;
    if (hit) t.ours += 3;
    if (hit !== c.sheetBonus) { mismatches++; console.log(`  bonus mismatch ${c.tab} row ${c.row}`); }
  }
}
console.log('\nplayer     ours  sheet');
for (const [tab, t] of Object.entries(totals)) console.log(tab.padEnd(10), String(t.ours).padStart(4), String(t.sheet).padStart(6), t.ours === t.sheet ? '' : '  <-- differs');
console.log(mismatches ? `${mismatches} bonus mismatches` : 'all bonuses match ✅');
