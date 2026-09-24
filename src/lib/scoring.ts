import type { Game, Pick } from './types';

export type AtsSide = 'home' | 'away' | 'push';

/** Who covers given a score. Works for live games too ("covering right now"). */
export function atsSide(g: { home_spread: number }, away: number, home: number): AtsSide {
  const m = home - away + Number(g.home_spread);
  return m > 0 ? 'home' : m < 0 ? 'away' : 'push';
}

export function hasScore(g: Game) {
  return g.away_score != null && g.home_score != null;
}

/** Final ATS result, or null while not final. */
export function atsResult(g: Game): AtsSide | null {
  if (g.status !== 'final' || !hasScore(g)) return null;
  return atsSide(g, g.away_score!, g.home_score!);
}

export function pickedSide(g: Game, p: Pick | undefined): 'home' | 'away' | null {
  if (!p?.pick_team_id) return null;
  return p.pick_team_id === g.home_team_id ? 'home' : p.pick_team_id === g.away_team_id ? 'away' : null;
}

function atsPointsFor(side: AtsSide | null, picked: 'home' | 'away' | null, dd: boolean) {
  if (!side || !picked || side === 'push') return 0;
  return side === picked ? (dd ? 2 : 1) : dd ? -1 : 0;
}

export function scoreCallHits(g: Game, p: Pick | undefined, away = g.away_score, home = g.home_score) {
  if (!p || p.score_away == null || p.score_home == null || away == null || home == null) return false;
  return Math.abs(p.score_away - away) <= 2 && Math.abs(p.score_home - home) <= 2;
}

export interface PickPoints {
  ats: number;
  score: number;
  total: number;
  /** 'win' | 'loss' | 'push' | 'pending' | 'none' */
  outcome: 'win' | 'loss' | 'push' | 'pending' | 'none';
  bullseye: boolean;
}

/** Points earned by a pick. With live=true, scores in-progress games as if they ended now. */
export function pickPoints(g: Game, p: Pick | undefined, live = false): PickPoints {
  const picked = pickedSide(g, p);
  const counts = g.status === 'final' || (live && g.status === 'in');
  const side = counts && hasScore(g) ? atsSide(g, g.away_score!, g.home_score!) : null;
  const ats = atsPointsFor(side, picked, !!p?.is_dd);
  const bullseye = counts && scoreCallHits(g, p);
  const score = bullseye ? 3 : 0;
  const outcome = !picked ? 'none' : !side ? 'pending' : side === 'push' ? 'push' : side === picked ? 'win' : 'loss';
  return { ats, score, total: ats + score, outcome, bullseye };
}

export function isLocked(g: Game, now = Date.now()) {
  return new Date(g.kickoff).getTime() <= now || g.status !== 'scheduled';
}

export function fmtSpread(n: number) {
  const v = Number(n);
  if (v === 0) return 'PK';
  return (v > 0 ? '+' : '') + v;
}
