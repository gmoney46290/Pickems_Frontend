import { pickPoints } from './scoring';
import type { Game, Pick, Player } from './types';

export interface Line {
  player: Player;
  total: number;
  ats: number;
  bonus: number;
  wins: number;
  losses: number;
  pushes: number;
  ddWins: number;
  ddLosses: number;
  bullseyes: number;
  scoreCalls: number;
  /** points per week id */
  byWeek: Map<number, number>;
  weeksWon: number;
  live: number; // points including in-progress games
}

export function buildStandings(players: Player[], games: Game[], picks: Pick[], weekIds: Set<number> | null): Line[] {
  const gameById = new Map(games.map(g => [g.id, g]));
  const lines = new Map<string, Line>(
    players.map(p => [
      p.id,
      { player: p, total: 0, ats: 0, bonus: 0, wins: 0, losses: 0, pushes: 0, ddWins: 0, ddLosses: 0, bullseyes: 0, scoreCalls: 0, byWeek: new Map(), weeksWon: 0, live: 0 },
    ]),
  );
  for (const pk of picks) {
    const g = gameById.get(pk.game_id);
    const l = lines.get(pk.player_id);
    if (!g || !l || (weekIds && !weekIds.has(g.week_id))) continue;
    const r = pickPoints(g, pk);
    l.live += pickPoints(g, pk, true).total;
    if (pk.score_away != null) l.scoreCalls++;
    if (r.outcome === 'pending' || r.outcome === 'none') continue;
    l.total += r.total;
    l.ats += r.ats;
    l.bonus += r.score;
    if (r.bullseye) l.bullseyes++;
    if (r.outcome === 'win') { l.wins++; if (pk.is_dd) l.ddWins++; }
    if (r.outcome === 'loss') { l.losses++; if (pk.is_dd) l.ddLosses++; }
    if (r.outcome === 'push') l.pushes++;
    l.byWeek.set(g.week_id, (l.byWeek.get(g.week_id) ?? 0) + r.total);
  }
  // Weekly winners (ties share the crown) — only for weeks with at least one final game.
  const weeks = new Set(games.filter(g => g.status === 'final' && (!weekIds || weekIds.has(g.week_id))).map(g => g.week_id));
  for (const w of weeks) {
    const best = Math.max(...[...lines.values()].map(l => l.byWeek.get(w) ?? 0));
    const weekDone = games.filter(g => g.week_id === w).every(g => g.status === 'final' || g.status === 'canceled');
    if (weekDone) for (const l of lines.values()) if ((l.byWeek.get(w) ?? 0) === best) l.weeksWon++;
  }
  return [...lines.values()].sort((a, b) => b.total - a.total || b.bullseyes - a.bullseyes || a.player.sort - b.player.sort);
}

/** Standard competition ranking: 1, 2, 2, 4 */
export function ranks(lines: Line[]) {
  return lines.map((l, i) => (i > 0 && lines[i - 1].total === l.total ? null : i + 1)).map((r, i, arr) => {
    if (r != null) return r;
    let j = i;
    while (arr[j] == null) j--;
    return arr[j]!;
  });
}

export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
