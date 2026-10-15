import type { Box, BoxItem, Game, Pick, Week } from './types';

export interface ItemMeta {
  key: BoxItem;
  name: string;
  emoji: string;
  blurb: string;
  /** what you have to choose when playing it */
  needs: 'game' | 'opponent' | 'team' | 'nothing';
  attack?: boolean;
  /** no longer dealt; kept so old boxes still display */
  retired?: boolean;
}

export const ITEMS: Record<BoxItem, ItemMeta> = {
  extra_dd: { key: 'extra_dd', name: 'Extra Double Down', emoji: '🔥', blurb: 'Double down on one more game (+2 / −1).', needs: 'game' },
  landmine: { key: 'landmine', name: 'Landmine', emoji: '🧨', blurb: "Plant it on someone else's pick: if it loses they lose an extra point.", needs: 'opponent', attack: true },
  teaser: { key: 'teaser', name: 'Teaser', emoji: '🎟️', blurb: 'Move the line 2 points your way on one of your picks.', needs: 'game' },
  lone_wolf: { key: 'lone_wolf', name: 'Lone Wolf', emoji: '🐺', blurb: 'Claim a side on one game. Everyone else is forced onto the other team.', needs: 'team' },
  taser: { key: 'taser', name: 'Taser', emoji: '⚡', blurb: "Make someone else's pick 2 points harder.", needs: 'opponent', attack: true },
  super_dawg: { key: 'super_dawg', name: 'Super Dawg', emoji: '🐶', blurb: 'Pick a game. If the underdog wins outright (not just covers), you get +1.', needs: 'game' },
  dice: { key: 'dice', name: 'Dice', emoji: '🎲', blurb: 'Roll for +2, +1, 0, −1 or −2 on your week.', needs: 'nothing', retired: true },
};

export interface Rules {
  boxes: boolean;
  /** each team's score must be within this many points */
  scoreTolerance: number;
  /** points for a score hit (0 under box rules: hits earn a box instead) */
  scorePoints: number;
}

export const CLASSIC: Rules = { boxes: false, scoreTolerance: 2, scorePoints: 3 };
export const BOX_RULES: Rules = { boxes: true, scoreTolerance: 5, scorePoints: 0 };
export const rulesFor = (w: { ruleset?: string } | undefined | null): Rules => (w?.ruleset === 'boxes' ? BOX_RULES : CLASSIC);

/** Box effects on one player's pick for one game. */
export interface Mods {
  /** points added to the picker's side of the line (teaser +2, each taser −2) */
  lineAdj: number;
  extraDD: boolean;
  landmines: number;
  teasers: Box[];
  tasers: Box[];
  mines: Box[];
  wolf: Box | null;
  dawgs: Box[];
}

export const NO_MODS: Mods = { lineAdj: 0, extraDD: false, landmines: 0, teasers: [], tasers: [], mines: [], wolf: null, dawgs: [] };

/** Underdog by our house line; null for a pick'em. */
export function underdogOf(g: Game): string | null {
  const s = Number(g.home_spread);
  return s > 0 ? g.home_team_id : s < 0 ? g.away_team_id : null;
}

/** Is the underdog winning outright? (final, or right now when live) */
export function dogWinning(g: Game, live = false): boolean {
  if (!(g.status === 'final' || (live && g.status === 'in')) || g.away_score == null || g.home_score == null) return false;
  const dog = underdogOf(g);
  if (!dog) return false;
  return dog === g.home_team_id ? g.home_score > g.away_score : g.away_score > g.home_score;
}

export interface BoxIndex {
  mods: (gameId: number, playerId: string) => Mods;
  wolfOn: (gameId: number) => Box | null;
  /** Points from boxes that aren't tied to a pick: old dice rolls + Super Dawg wins. */
  bonus: (weekId: number, playerId: string, live?: boolean) => number;
}

export function indexBoxes(boxes: Box[], games: Game[] = []): BoxIndex {
  const gameById = new Map(games.map(g => [g.id, g]));
  const used = boxes.filter(b => b.used_at);
  const byGame = new Map<number, Box[]>();
  for (const b of used) if (b.target_game_id) byGame.set(b.target_game_id, [...(byGame.get(b.target_game_id) ?? []), b]);
  const cache = new Map<string, Mods>();
  return {
    mods(gameId, playerId) {
      const key = `${gameId}:${playerId}`;
      if (cache.has(key)) return cache.get(key)!;
      const bs = byGame.get(gameId) ?? [];
      const teasers = bs.filter(b => b.item === 'teaser' && b.player_id === playerId);
      const tasers = bs.filter(b => b.item === 'taser' && b.target_player_id === playerId);
      const mines = bs.filter(b => b.item === 'landmine' && b.target_player_id === playerId);
      const m: Mods = {
        lineAdj: teasers.length * 2 - tasers.length * 2,
        extraDD: bs.some(b => b.item === 'extra_dd' && b.player_id === playerId),
        landmines: mines.length,
        teasers,
        tasers,
        mines,
        wolf: bs.find(b => b.item === 'lone_wolf') ?? null,
        dawgs: bs.filter(b => b.item === 'super_dawg' && b.player_id === playerId),
      };
      cache.set(key, m);
      return m;
    },
    wolfOn: gameId => (byGame.get(gameId) ?? []).find(b => b.item === 'lone_wolf') ?? null,
    bonus: (weekId, playerId, live = false) =>
      used
        .filter(b => b.week_id === weekId && b.player_id === playerId)
        .reduce((s, b) => {
          if (b.item === 'dice') return s + (b.dice_roll ?? 0);
          if (b.item === 'super_dawg') {
            const g = b.target_game_id ? gameById.get(b.target_game_id) : undefined;
            return s + (g && dogWinning(g, live) ? 1 : 0);
          }
          return s;
        }, 0),
  };
}

/** Effective line for a pick after teasers/tasers, from the picked team's point of view. */
export function effectiveTeamSpread(g: Game, p: Pick | undefined, lineAdj: number) {
  if (!p?.pick_team_id) return null;
  const base = p.pick_team_id === g.home_team_id ? Number(g.home_spread) : -Number(g.home_spread);
  return base + lineAdj;
}

/** Can boxes still be played this week? */
export function boxesOpen(w: Week | undefined, now = Date.now()) {
  if (!w || w.ruleset !== 'boxes' || w.status !== 'open') return false;
  return !w.locks_at || new Date(w.locks_at).getTime() > now;
}
