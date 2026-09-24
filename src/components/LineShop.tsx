import { useEffect, useState } from 'react';
import { fetchEspnLines, type BookLine } from '../lib/espn';
import { fmtSpread } from '../lib/scoring';
import { supabase } from '../lib/supabase';
import type { Game, Team } from '../lib/types';

/** Compare our house line with the public books. Spreads shown from the home team's view. */
export function LineShop({ game, home }: { game: Game; home: Team; away: Team }) {
  const [lines, setLines] = useState<BookLine[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      const out: BookLine[] = [];
      try {
        if (game.espn_event_id) out.push(...(await fetchEspnLines(game.league, game.espn_event_id)));
      } catch (e: any) {
        setErr('ESPN lines unavailable');
      }
      // Other books, cached server-side by the odds function (only if an Odds API key is set).
      await fetch(`/.netlify/functions/odds?week=${game.week_id}`, { signal: AbortSignal.timeout(8000) }).catch(() => {});
      const { data } = await supabase.from('odds_cache').select('*').eq('game_id', game.id);
      for (const r of data ?? []) {
        if (r.book === '_refresh') continue;
        if (out.some(o => o.book.toLowerCase().replace(/\s/g, '') === String(r.book).toLowerCase().replace(/\s/g, ''))) continue;
        out.push({ book: r.book, homeSpread: r.home_spread, total: r.total });
      }
      if (!dead) setLines(out);
    })();
    return () => {
      dead = true;
    };
  }, [game.id, game.espn_event_id, game.league, game.week_id]);

  const ours = Number(game.home_spread);
  const spreads = (lines ?? []).map(l => l.homeSpread).filter((x): x is number => x != null);
  const consensus = spreads.length ? Math.round((spreads.reduce((a, b) => a + b, 0) / spreads.length) * 2) / 2 : null;

  return (
    <div className="lineshop">
      <table>
        <thead>
          <tr>
            <th>Book</th>
            <th>{home.abbr} spread</th>
            <th>Total</th>
            <th className="hide-sm">Open</th>
          </tr>
        </thead>
        <tbody>
          <tr className="ours">
            <td>🏠 Our line</td>
            <td>{fmtSpread(ours)}</td>
            <td>{game.market_total ?? '—'}</td>
            <td className="hide-sm" />
          </tr>
          {lines == null && (
            <tr>
              <td colSpan={4} className="muted">Calling our bookie…</td>
            </tr>
          )}
          {lines?.map(l => (
            <tr key={l.book}>
              <td>{l.book}</td>
              <td>
                {l.homeSpread == null ? '—' : fmtSpread(l.homeSpread)}{' '}
                {l.homeSpread != null && l.homeSpread !== ours && <span className="diff">({fmtSpread(ours - l.homeSpread)})</span>}
              </td>
              <td>{l.total ?? '—'}</td>
              <td className="hide-sm muted">{l.open != null ? fmtSpread(l.open) : ''}</td>
            </tr>
          ))}
          {lines && !lines.length && (
            <tr>
              <td colSpan={4} className="muted">{err ?? 'No public lines posted yet.'}</td>
            </tr>
          )}
        </tbody>
      </table>
      {consensus != null && spreads.length > 1 && (
        <div className="muted" style={{ marginTop: 4 }}>
          Consensus {home.abbr} {fmtSpread(consensus)} across {spreads.length} books
        </div>
      )}
    </div>
  );
}
