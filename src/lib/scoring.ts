import { CLASSIC, NO_MODS, type Mods, type Rules } from './boxes';
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

export function scoreCallHits(g: Game, p: Pick | undefined, away = g.away_score, home = g.home_score, tolerance = 2) {
  if (!p || p.score_away == null || p.score_home == null || away == null || home == null) return false;
  return Math.abs(p.score_away - away) <= tolerance && Math.abs(p.score_home - home) <= tolerance;
}

/** Rules for the week plus box effects on this pick. Omit for classic scoring. */
export interface ScoreCtx {
  rules?: Rules;
  mods?: Mods;
}

export interface PickPoints {
  ats: number;
  score: number;
  total: number;
  /** 'win' | 'loss' | 'push' | 'pending' | 'none' */
  outcome: 'win' | 'loss' | 'push' | 'pending' | 'none';
  bullseye: boolean;
  /** double down in effect (regular or Extra Double Down box) */
  dd: boolean;
}

/**
 * Points earned by a pick. With live=true, scores in-progress games as if they ended now.
 * Box effects: teasers/tasers move the picker's line, Extra Double Down makes it a DD,
 * each landmine costs one more point on a loss.
 */
export function pickPoints(g: Game, p: Pick | undefined, live = false, ctx: ScoreCtx = {}): PickPoints {
  const rules = ctx.rules ?? CLASSIC;
  const mods = ctx.mods ?? NO_MODS;
  const picked = pickedSide(g, p);
  const dd = !!p?.is_dd || mods.extraDD;
  const counts = g.status === 'final' || (live && g.status === 'in');
  let outcome: PickPoints['outcome'] = 'none';
  if (picked) {
    if (!counts || !hasScore(g)) outcome = 'pending';
    else {
      // margin from the picked team's side of the line, after teasers/tasers
      const homeMargin = g.home_score! - g.away_score! + Number(g.home_spread);
      const m = (picked === 'home' ? homeMargin : -homeMargin) + mods.lineAdj;
      outcome = m > 0 ? 'win' : m < 0 ? 'loss' : 'push';
    }
  }
  const ats = outcome === 'win' ? (dd ? 2 : 1) : outcome === 'loss' ? (dd ? -1 : 0) - mods.landmines : 0;
  const bullseye = counts && scoreCallHits(g, p, g.away_score, g.home_score, rules.scoreTolerance);
  const score = bullseye ? rules.scorePoints : 0;
  return { ats, score, total: ats + score, outcome, bullseye, dd };
}

export function weekLocked(w: { locks_at: string | null } | undefined | null, now = Date.now()) {
  return !!w?.locks_at && new Date(w.locks_at).getTime() <= now;
}

/** A game is locked at its kickoff, or when the commish locks the whole week. */
export function isLocked(g: Game, now = Date.now(), week?: { locks_at: string | null } | null) {
  return new Date(g.kickoff).getTime() <= now || g.status !== 'scheduled' || weekLocked(week, now);
}

export function fmtSpread(n: number) {
  const v = Number(n);
  if (v === 0) return 'PK';
  return (v > 0 ? '+' : '') + v;
}
