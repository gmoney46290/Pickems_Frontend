import { atsSide, pickedSide, pickPoints } from './scoring';
import type { Scorer } from './standings';
import type { Game, Pick, Player } from './types';

export interface Award {
  title: string;
  players: Player[];
  why: string;
}

/**
 * Silly superlatives over the final games in `weekIds`. With `weekly` the copy talks about
 * "this week"; otherwise it's season-flavored (best/worst single week, streaks).
 */
export function computeAwards(players: Player[], games: Game[], picks: Pick[], weekIds: Set<number>, weekly: boolean, score: Scorer = (g, p, live) => pickPoints(g, p, live)): Award[] {
  const final = games.filter(g => g.status === 'final' && weekIds.has(g.week_id)).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  if (!final.length || !players.length) return [];
  const gameIds = new Set(final.map(g => g.id));
  const byGame = new Map<number, Pick[]>();
  for (const p of picks) if (gameIds.has(p.game_id) && p.pick_team_id) byGame.set(p.game_id, [...(byGame.get(p.game_id) ?? []), p]);

  // per-player tallies
  type T = {
    pts: number; wins: number; losses: number; ddW: number; ddL: number; bulls: number; calls: number;
    nearMiss: number | null; lone: number; sheep: number; chalk: number; dogWins: number; home: number; picks: number;
    cfbW: number; cfbN: number; nflW: number; nflN: number; badBeats: number; streak: number; best: number;
    byWeek: Map<number, number>;
  };
  const t = new Map<string, T>(
    players.map(p => [p.id, {
      pts: 0, wins: 0, losses: 0, ddW: 0, ddL: 0, bulls: 0, calls: 0, nearMiss: null, lone: 0, sheep: 0, chalk: 0,
      dogWins: 0, home: 0, picks: 0, cfbW: 0, cfbN: 0, nflW: 0, nflN: 0, badBeats: 0, streak: 0, best: 0, byWeek: new Map(),
    }]),
  );

  for (const g of final) {
    const ps = byGame.get(g.id) ?? [];
    const awayN = ps.filter(p => p.pick_team_id === g.away_team_id).length;
    const majority = awayN * 2 > ps.length ? g.away_team_id : awayN * 2 < ps.length ? g.home_team_id : null;
    const favSide = Number(g.home_spread) < 0 ? 'home' : Number(g.home_spread) > 0 ? 'away' : null;
    const margin = g.home_score! - g.away_score! + Number(g.home_spread); // >0 home covered
    for (const p of ps) {
      const s = t.get(p.player_id);
      if (!s) continue;
      const r = score(g, p);
      const side = pickedSide(g, p);
      s.pts += r.total;
      s.byWeek.set(g.week_id, (s.byWeek.get(g.week_id) ?? 0) + r.total);
      s.picks++;
      if (side === 'home') s.home++;
      if (side && side === favSide) s.chalk++;
      if (majority && p.pick_team_id === majority) s.sheep++;
      if (g.league === 'cfb') s.cfbN++; else s.nflN++;
      if (r.outcome === 'win') {
        s.wins++;
        if (g.league === 'cfb') s.cfbW++; else s.nflW++;
        if (r.dd) s.ddW++;
        if (favSide && side !== favSide) s.dogWins++;
        if (ps.length > 2 && ps.filter(x => x.pick_team_id === p.pick_team_id).length === 1) s.lone++;
        s.streak++;
        s.best = Math.max(s.best, s.streak);
      } else if (r.outcome === 'loss') {
        s.losses++;
        if (r.dd) s.ddL++;
        if (Math.abs(margin) <= 1.5) s.badBeats++;
        s.streak = 0;
      }
      if (p.score_away != null) {
        s.calls++;
        if (r.bullseye) s.bulls++;
        else {
          const err = Math.abs(p.score_away - g.away_score!) + Math.abs(p.score_home! - g.home_score!);
          s.nearMiss = s.nearMiss == null ? err : Math.min(s.nearMiss, err);
        }
      }
    }
  }

  const rows = players.map(p => ({ p, s: t.get(p.id)! })).filter(r => r.s.picks > 0);
  if (!rows.length) return [];
  const out: Award[] = [];
  /** everyone tied for the top value (null when nobody qualifies) */
  const top = (f: (s: T) => number | null, dir: 1 | -1 = 1, min = -Infinity) => {
    // `min` is the minimum value to qualify for "most" awards (ignored for "least" awards)
    const vals = rows.map(r => ({ r, v: f(r.s) })).filter(x => x.v != null && (dir === -1 || x.v >= min)) as { r: typeof rows[0]; v: number }[];
    if (!vals.length) return null;
    const best = dir === 1 ? Math.max(...vals.map(x => x.v)) : Math.min(...vals.map(x => x.v));
    const winners = vals.filter(x => x.v === best).map(x => x.r.p);
    return winners.length <= 3 ? { players: winners, v: best } : null; // a 5-way tie isn't an award
  };
  const add = (title: string, w: { players: Player[]; v: number } | null, why: (v: number) => string) => {
    if (w) out.push({ title, players: w.players, why: why(w.v) });
  };
  const pct = (w: number, n: number) => (n ? Math.round((w / n) * 100) : 0);
  const s = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  if (weekly) {
    add('👑 Week MVP', top(x => x.pts), v => `${v} points. Buy this person a beer.`);
    add('🧊 Ice Cold', top(x => x.pts, -1), v => `${v} points. Thoughts and prayers.`);
  } else {
    let hi = { v: -Infinity, ids: [] as string[] }, lo = { v: Infinity, ids: [] as string[] };
    for (const r of rows) for (const v of r.s.byWeek.values()) {
      if (v > hi.v) hi = { v, ids: [r.p.id] }; else if (v === hi.v && !hi.ids.includes(r.p.id)) hi.ids.push(r.p.id);
      if (v < lo.v) lo = { v, ids: [r.p.id] }; else if (v === lo.v && !lo.ids.includes(r.p.id)) lo.ids.push(r.p.id);
    }
    const pl = (ids: string[]) => ids.map(id => players.find(p => p.id === id)!).slice(0, 3);
    if (hi.ids.length) out.push({ title: '🚀 Heater', players: pl(hi.ids), why: `${hi.v} points in a single week. Somebody call Vegas.` });
    if (lo.ids.length) out.push({ title: '🧊 Ice Cold', players: pl(lo.ids), why: `${lo.v} points in a single week. We don't talk about it.` });
    add('📈 Heat Check', top(x => x.best, 1, 3), v => `${v} ATS wins in a row`);
  }
  add('🎯 Sniper', top(x => x.bulls, 1, 1), v => s(v, 'bullseye score call'));
  add('😬 So Close', top(x => x.nearMiss, -1), v => `Missed a bullseye by ${v} total points`);
  add('🔥 Double Trouble', top(x => x.ddW * 2 - x.ddL, 1, 1), v => `+${v} net on double downs`);
  add('🧯 Needs a Fire Extinguisher', top(x => x.ddL - x.ddW, 1, 1), v => `${s(v, 'more busted double down')} than hits`);
  add('🐺 Lone Wolf', top(x => x.lone, 1, 1), v => `${s(v, 'winning pick')} nobody else made`);
  add('🐑 Sheep', top(x => x.sheep, 1, 1), v => `Went with the crowd ${s(v, 'time')}. Baa.`);
  add('🖍️ Chalk Muncher', top(x => x.chalk, 1, 1), v => `Took the favorite ${s(v, 'time')}. Brave.`);
  add('🐶 Dog Whisperer', top(x => x.dogWins, 1, 1), v => `${s(v, 'underdog')} covered for them`);
  add('🏠 Homer', top(x => x.home, 1, 1), v => `Picked the home team ${s(v, 'time')}`);
  add('💔 Bad Beats', top(x => x.badBeats, 1, 1), v => `${s(v, 'loss')} by 1.5 points or less against the spread`);
  const minN = weekly ? 4 : 10;
  add('🎓 College Guru', top(x => (x.cfbN >= minN ? pct(x.cfbW, x.cfbN) : null), 1, 1), v => `${v}% ATS on college games`);
  add('🏟️ Pro Pro', top(x => (x.nflN >= minN ? pct(x.nflW, x.nflN) : null), 1, 1), v => `${v}% ATS on NFL games`);

  // 👯 Mind Meld: the pair that agreed most often
  let pair: { a: Player; b: Player; n: number; of: number } | null = null;
  for (let i = 0; i < players.length; i++)
    for (let j = i + 1; j < players.length; j++) {
      let n = 0, of = 0;
      for (const g of final) {
        const ps = byGame.get(g.id) ?? [];
        const a = ps.find(p => p.player_id === players[i].id), b = ps.find(p => p.player_id === players[j].id);
        if (!a || !b) continue;
        of++;
        if (a.pick_team_id === b.pick_team_id) n++;
      }
      if (of && (!pair || n / of > pair.n / pair.of)) pair = { a: players[i], b: players[j], n, of };
    }
  if (pair && pair.of >= 3) out.push({ title: '👯 Mind Meld', players: [pair.a, pair.b], why: `Agreed on ${pair.n} of ${pair.of} games. Get a room.` });

  return out;
}

/** The game that burned the most people, for a "Group L" callout. */
export function groupL(games: Game[], picks: Pick[], weekIds: Set<number>) {
  let worst: { g: Game; wrong: number; total: number } | null = null;
  for (const g of games) {
    if (g.status !== 'final' || !weekIds.has(g.week_id)) continue;
    const side = atsSide(g, g.away_score!, g.home_score!);
    if (side === 'push') continue;
    const ps = picks.filter(p => p.game_id === g.id && p.pick_team_id);
    const wrong = ps.filter(p => pickedSide(g, p) !== side).length;
    if (!worst || wrong > worst.wrong) worst = { g, wrong, total: ps.length };
  }
  return worst && worst.wrong >= 2 ? worst : null;
}
