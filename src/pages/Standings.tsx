import { useMemo, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { weekTitle } from '../components/WeekTabs';
import { useLeague } from '../lib/league';
import { computeAwards, groupL } from '../lib/awards';
import { fmtSpread } from '../lib/scoring';
import { buildStandings, ordinal, ranks } from '../lib/standings';

function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const w = 90, h = 28, max = Math.max(...values, 1), min = Math.min(...values, 0);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * h}`).join(' ');
  return (
    <svg className="spark" width={w} height={h} viewBox={`-2 -2 ${w + 4} ${h + 4}`} aria-hidden>
      <polyline points={pts} fill="none" stroke="#16121f" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const MEDALS = ['🥇', '🥈', '🥉'];

export function StandingsPage() {
  const { players, games, picks, weeks, phases, phaseWeeks, teams, score, boxIndex } = useLeague();
  const [scope, setScope] = useState<'season' | number>('season');

  const scopedWeeks = useMemo(() => {
    const visible = weeks.filter(w => w.status !== 'draft');
    if (scope === 'season') return visible;
    const ids = new Set(phaseWeeks.filter(pw => pw.phase_id === scope).map(pw => pw.week_id));
    return visible.filter(w => ids.has(w.id));
  }, [scope, weeks, phaseWeeks]);
  const weekIds = useMemo(() => new Set(scopedWeeks.map(w => w.id)), [scopedWeeks]);
  const lines = useMemo(() => buildStandings(players, games, picks, weekIds, score, boxIndex.bonus), [players, games, picks, weekIds, score, boxIndex]);
  const r = ranks(lines);
  const playedWeeks = scopedWeeks.filter(w => games.some(g => g.week_id === w.id && g.status === 'final'));

  // Awards: one week at a time (defaults to the latest week with results) or the whole scope.
  const [awardWeek, setAwardWeek] = useState<number | 'all' | null>(null);
  const awardScope = awardWeek === 'all' ? 'all' : playedWeeks.some(w => w.id === awardWeek) ? awardWeek : playedWeeks.at(-1)?.id ?? 'all';
  const awardIds = useMemo(() => (awardScope === 'all' ? weekIds : new Set([awardScope as number])), [awardScope, weekIds]);
  const awards = useMemo(() => computeAwards(players, games, picks, awardIds, awardScope !== 'all', score), [players, games, picks, awardIds, awardScope, score]);
  const burned = useMemo(() => groupL(games, picks, awardIds), [games, picks, awardIds]);

  if (!players.length) return <div className="card empty"><div className="big">🏆</div><p>No players yet.</p></div>;

  return (
    <>
      <div className="phase-tabs">
        <button className={`btn ${scope === 'season' ? 'primary' : ''}`} onClick={() => setScope('season')}>🗓️ Full season</button>
        {phases.map(p => (
          <button key={p.id} className={`btn ${scope === p.id ? 'primary' : ''}`} onClick={() => setScope(p.id)}>
            {p.emoji} {p.name}
          </button>
        ))}
      </div>

      <div className="podium">
        {lines.map((l, i) => {
          const last = i === lines.length - 1 && lines.length > 2 && l.total < lines[0].total;
          const record = `${l.wins}-${l.losses}${l.pushes ? `-${l.pushes}` : ''}`;
          const pct = l.wins + l.losses ? Math.round((l.wins / (l.wins + l.losses)) * 100) : 0;
          return (
            <div key={l.player.id} className={`card leader ${r[i] === 1 && l.total > 0 ? 'first' : ''} ${last ? 'last' : ''}`}>
              <div className="rank">{last ? '🤡' : MEDALS[r[i] - 1] ?? ordinal(r[i])}</div>
              <Avatar p={l.player} />
              <div style={{ minWidth: 0 }}>
                <div className="name">
                  {l.player.name} {l.weeksWon > 0 && <span title="weekly wins">{'👑'.repeat(Math.min(l.weeksWon, 5))}{l.weeksWon > 5 ? `×${l.weeksWon}` : ''}</span>}
                </div>
                <div className="stats">
                  <span className="chip">ATS {record} ({pct}%)</span>
                  <span className="chip">🔥 {l.ddWins}-{l.ddLosses}</span>
                  <span className="chip">🎯 {l.bullseyes}/{l.scoreCalls}</span>
                  {l.boxBonus !== 0 && <span className="chip">🎁 {l.boxBonus > 0 ? '+' : ''}{l.boxBonus}</span>}
                  {last && <span className="chip pink">toilet bowl 🚽</span>}
                </div>
              </div>
              <div className="row" style={{ gap: 12 }}>
                <span className="hide-sm">
                  <Spark values={playedWeeks.map(w => l.byWeek.get(w.id) ?? 0)} color={l.player.color} />
                </span>
                <div className="pts">
                  {l.total}
                  <small>{l.bonus ? `${l.ats} + ${l.bonus}🎯` : 'pts'}</small>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {playedWeeks.length > 0 && (
        <>
          <div className="section-title">🏅 Awards</div>
          <div className="phase-tabs">
            {playedWeeks.map(w => (
              <button key={w.id} className={`btn small ${awardScope === w.id ? 'primary' : ''}`} onClick={() => setAwardWeek(w.id)}>
                {weekTitle(w)}
              </button>
            ))}
            <button className={`btn small ${awardScope === 'all' ? 'primary' : ''}`} onClick={() => setAwardWeek('all')}>
              🏆 {scope === 'season' ? 'Season' : phases.find(p => p.id === scope)?.name ?? 'Phase'}
            </button>
          </div>
          {burned && (() => {
            const a = teams.get(burned.g.away_team_id), h = teams.get(burned.g.home_team_id);
            return (
              <div className="card panel" style={{ marginBottom: 12, background: 'var(--loss-bg)' }}>
                <b className="display">🫠 Group L:</b> {a?.abbr} {burned.g.away_score} @ {h?.abbr} {burned.g.home_score} ({h?.abbr} {fmtSpread(Number(burned.g.home_spread))}) burned {burned.wrong} of {burned.total} of us.
              </div>
            );
          })()}
          <div className="supers">
            {awards.map(s => (
              <div key={s.title} className="card super">
                <div className="t">{s.title}</div>
                <div className="who-big wrap">
                  {s.players.map(p => (
                    <span key={p.id} className="row" style={{ gap: 6 }}>
                      <Avatar p={p} size="sm" /> {p.name}
                    </span>
                  ))}
                </div>
                <div className="why">{s.why}</div>
              </div>
            ))}
            {!awards.length && <div className="muted">No awards yet. Go lose some money.</div>}
          </div>
        </>
      )}

      {playedWeeks.length > 0 && (
        <>
          <div className="section-title">📈 Week by week</div>
          <div className="card panel" style={{ overflowX: 'auto' }}>
            <table className="grid">
              <thead>
                <tr>
                  <th>Player</th>
                  {playedWeeks.map(w => <th key={w.id}>{weekTitle(w).replace('Week ', 'Wk ')}</th>)}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(l => (
                  <tr key={l.player.id}>
                    <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {l.player.emoji} {l.player.name}
                    </td>
                    {playedWeeks.map(w => {
                      const v = l.byWeek.get(w.id) ?? 0;
                      const top = Math.max(...lines.map(x => x.byWeek.get(w.id) ?? 0));
                      return <td key={w.id} className={v === top && top > 0 ? 'crown' : ''}>{v}</td>;
                    })}
                    <td style={{ fontFamily: 'var(--display)' }}>{l.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
