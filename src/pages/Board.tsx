import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { defaultWeek, weekTitle, WeekTabs } from '../components/WeekTabs';
import { useLeague } from '../lib/league';
import { atsResult, fmtSpread, pickPoints, scoreCallHits } from '../lib/scoring';
import type { Game, League } from '../lib/types';

export function BoardPage() {
  const { weeks, games, picks, players, teams, me } = useLeague();
  const visibleWeeks = weeks.filter(w => w.status !== 'draft' || me?.is_admin);
  const [weekId, setWeekId] = useState<number | null>(null);
  useEffect(() => {
    if (weekId == null) setWeekId(defaultWeek(visibleWeeks, games));
  }, [visibleWeeks.length, games.length]); // eslint-disable-line

  const week = visibleWeeks.find(w => w.id === weekId);
  const weekGames = useMemo(
    () => games.filter(g => g.week_id === weekId).sort((a, b) => (a.league === b.league ? a.sort - b.sort || a.kickoff.localeCompare(b.kickoff) : a.league === 'cfb' ? -1 : 1)),
    [games, weekId],
  );
  const pickMap = useMemo(() => new Map(picks.map(p => [`${p.game_id}:${p.player_id}`, p])), [picks]);

  if (!week) return <div className="card empty"><div className="big">📋</div><p>Nothing on the board yet.</p></div>;

  const totals = players.map(pl => {
    let ats = 0, bonus = 0, live = 0;
    for (const g of weekGames) {
      const r = pickPoints(g, pickMap.get(`${g.id}:${pl.id}`));
      ats += r.ats;
      bonus += r.score;
      live += pickPoints(g, pickMap.get(`${g.id}:${pl.id}`), true).total;
    }
    return { ats, bonus, total: ats + bonus, live };
  });
  const best = Math.max(...totals.map(t => t.total));
  const anyLive = weekGames.some(g => g.status === 'in');

  const row = (g: Game) => {
    const away = teams.get(g.away_team_id)!, home = teams.get(g.home_team_id)!;
    const fav = Number(g.home_spread) <= 0 ? home : away;
    const res = atsResult(g);
    const coveredBy = res === 'home' ? home : res === 'away' ? away : null;
    const gp = players.map(pl => pickMap.get(`${g.id}:${pl.id}`));
    const nAway = gp.filter(p => p?.pick_team_id === away.id).length, nHome = gp.filter(p => p?.pick_team_id === home.id).length;
    return (
      <tr key={g.id}>
        <td className="game-col">
          <div style={{ fontWeight: 700 }}>
            {away.abbr} @ {home.abbr}
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            {fav.abbr} {fmtSpread(-Math.abs(Number(g.home_spread)))}
            {g.away_score != null && g.status !== 'scheduled' && ` · ${g.away_score}-${g.home_score}`}
            {g.status === 'in' && ' 🔴'}
            {coveredBy && ` · ✅ ${coveredBy.abbr}`}
            {res === 'push' && ' · push'}
          </div>
          {nAway + nHome > 0 && (
            <div className="split-bar" title={`${away.abbr} ${nAway} · ${home.abbr} ${nHome}`}>
              <div style={{ flex: nAway, background: away.color ?? '#888' }} />
              <div style={{ flex: nHome, background: home.color ?? '#ccc' }} />
            </div>
          )}
        </td>
        {players.map((pl, i) => {
          const p = gp[i];
          if (!p?.pick_team_id) return <td key={pl.id} className="muted">—</td>;
          const t = teams.get(p.pick_team_id);
          const r = pickPoints(g, p, true);
          const cls = g.status === 'final' ? r.outcome : g.status === 'in' ? (r.outcome === 'win' ? 'live-win' : r.outcome === 'loss' ? 'live-loss' : '') : '';
          const hit = g.status === 'final' && scoreCallHits(g, p);
          return (
            <td key={pl.id}>
              <span className={`cell ${cls} ${p.is_dd ? 'dd' : ''} ${hit ? 'hit' : ''}`}>
                {t?.logo && <img src={t.logo} alt="" />}
                {t?.abbr}
                {p.is_dd && '🔥'}
                {p.score_away != null && <span className="sc">{p.score_away}-{p.score_home}</span>}
              </span>
            </td>
          );
        })}
      </tr>
    );
  };

  const section = (lg: League, title: string) => {
    const gs = weekGames.filter(g => g.league === lg);
    if (!gs.length) return null;
    return (
      <>
        <tr className="league-row">
          <td className="game-col" colSpan={1}>{title}</td>
          <td colSpan={players.length} style={{ background: 'var(--yellow)' }} />
        </tr>
        {gs.map(row)}
      </>
    );
  };

  return (
    <>
      <WeekTabs weeks={visibleWeeks} games={games} value={weekId} onChange={setWeekId} />
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div className="sticker" style={{ background: 'var(--paper)', fontSize: 20 }}>📋 {weekTitle(week)} board</div>
        <span className="chip">🔥 = double down</span>
        <span className="chip">🎯 12-10 = score call (away-home)</span>
      </div>
      <div className="board-wrap">
        <table className="board">
          <thead>
            <tr>
              <th className="game-col">Game</th>
              {players.map(pl => (
                <th key={pl.id}>
                  <div className="row" style={{ justifyContent: 'center', gap: 4 }}>
                    <Avatar p={pl} size="sm" /> {pl.name}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section('cfb', '🎓 College')}
            {section('nfl', '🏟️ Pro')}
          </tbody>
          <tfoot>
            <tr>
              <td className="game-col">Picks</td>
              {totals.map((t, i) => <td key={i}>{t.ats}</td>)}
            </tr>
            <tr>
              <td className="game-col">🎯 Bonus</td>
              {totals.map((t, i) => <td key={i}>{t.bonus}</td>)}
            </tr>
            <tr>
              <td className="game-col">Total</td>
              {totals.map((t, i) => (
                <td key={i} className={t.total === best && best > 0 ? 'best' : ''}>
                  {t.total === best && best > 0 && '👑 '}
                  {t.total}
                </td>
              ))}
            </tr>
            {anyLive && (
              <tr>
                <td className="game-col">If it ended now</td>
                {totals.map((t, i) => <td key={i} className="muted">{t.live}</td>)}
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </>
  );
}
