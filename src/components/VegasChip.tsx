import { fmtSpread } from '../lib/scoring';
import type { Game, Team } from '../lib/types';

/** 🌶️ badge showing the public (DraftKings) line when our house line differs from it. */
export function VegasChip({ game, away, home }: { game: Game; away: Team; home: Team }) {
  if (game.market_spread == null || Number(game.market_spread) === Number(game.home_spread)) return null;
  const m = Number(game.market_spread);
  return (
    <span className="chip yellow" title="Our line differs from DraftKings">
      🌶️ Vegas {m <= 0 ? home.abbr : away.abbr} {fmtSpread(-Math.abs(m))}
    </span>
  );
}
