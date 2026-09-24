import { useMemo, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { weekTitle } from '../components/WeekTabs';
import { useLeague } from '../lib/league';
import { pickedSide, pickPoints } from '../lib/scoring';
import { buildStandings, ordinal, ranks, type Line } from '../lib/standings';
import type { Player } from '../lib/types';

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
  const { players, games, picks, weeks, phases, phaseWeeks } = useLeague();
  const [scope, setScope] = useState<'season' | number>('season');

  const scopedWeeks = useMemo(() => {
    const visible = weeks.filter(w => w.status !== 'draft');
    if (scope === 'season') return visible;
    const ids = new Set(phaseWeeks.filter(pw => pw.phase_id === scope).map(pw => pw.week_id));
    return visible.filter(w => ids.has(w.id));
  }, [scope, weeks, phaseWeeks]);
  const weekIds = useMemo(() => new Set(scopedWeeks.map(w => w.id)), [scopedWeeks]);
  const lines = useMemo(() => buildStandings(players, games, picks, weekIds), [players, games, picks, weekIds]);
  const r = ranks(lines);
  const playedWeeks = scopedWeeks.filter(w => games.some(g => g.week_id === w.id && g.status === 'final'));

  const supers = useMemo(() => superlatives(lines, players, games, picks, weekIds), [lines, players, games, picks, weekIds]);

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

      {supers.length > 0 && (
        <>
          <div className="section-title">🏅 Superlatives</div>
          <div className="supers">
            {supers.map(s => (
              <div key={s.title} className="card super">
                <div className="t">{s.title}</div>
                <div className="who-big">
                  <Avatar p={s.player} size="sm" /> {s.player.name}
                </div>
                <div className="why">{s.why}</div>
              </div>
            ))}
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

interface Super { title: string; player: Player; why: string }

function superlatives(lines: Line[], players: Player[], games: ReturnType<typeof useLeague>['games'], picks: ReturnType<typeof useLeague>['picks'], weekIds: Set<number>): Super[] {
  const out: Super[] = [];
  const final = games.filter(g => g.status === 'final' && weekIds.has(g.week_id));
  if (!final.length) return out;
  const top = <T,>(arr: T[], f: (x: T) => number) => arr.reduce((a, b) => (f(b) > f(a) ? b : a));

  // Best single week
  let bestWeek = { pl: lines[0].player, pts: -99, week: 0 };
  for (const l of lines) for (const [w, v] of l.byWeek) if (v > bestWeek.pts) bestWeek = { pl: l.player, pts: v, week: w };
  out.push({ title: '🚀 Heater', player: bestWeek.pl, why: `${bestWeek.pts} points in one week. Somebody call Vegas.` });

  const sniper = top(lines, l => l.bullseyes);
  if (sniper.bullseyes > 0) out.push({ title: '🎯 Sniper', player: sniper.player, why: `${sniper.bullseyes} bullseye score calls` });

  const dd = top(lines, l => l.ddWins * 2 - l.ddLosses);
  out.push({ title: '🔥 Double Trouble', player: dd.player, why: `${dd.ddWins}-${dd.ddLosses} on double downs (${dd.ddWins * 2 - dd.ddLosses >= 0 ? '+' : ''}${dd.ddWins * 2 - dd.ddLosses} net)` });

  const worstDD = top(lines, l => l.ddLosses - l.ddWins);
  if (worstDD.ddLosses > worstDD.ddWins) out.push({ title: '🧯 Needs a Fire Extinguisher', player: worstDD.player, why: `${worstDD.ddLosses} busted double downs` });

  // Contrarian: most correct lone-wolf picks
  const byGame = new Map<number, typeof picks>();
  for (const p of picks) if (p.pick_team_id) byGame.set(p.game_id, [...(byGame.get(p.game_id) ?? []), p]);
  const lone = new Map<string, number>(), chalk = new Map<string, number>();
  for (const g of final) {
    const ps = byGame.get(g.id) ?? [];
    for (const p of ps) {
      const same = ps.filter(x => x.pick_team_id === p.pick_team_id).length;
      if (same === 1 && ps.length > 2 && pickPoints(g, p).outcome === 'win') lone.set(p.player_id, (lone.get(p.player_id) ?? 0) + 1);
      const favSide = Number(g.home_spread) < 0 ? 'home' : 'away';
      if (pickedSide(g, p) === favSide) chalk.set(p.player_id, (chalk.get(p.player_id) ?? 0) + 1);
    }
  }
  const pl = (id: string) => players.find(p => p.id === id)!;
  if (lone.size) {
    const [id, n] = [...lone].reduce((a, b) => (b[1] > a[1] ? b : a));
    out.push({ title: '🐺 Lone Wolf', player: pl(id), why: `${n} winning picks nobody else made` });
  }
  if (chalk.size) {
    const [id, n] = [...chalk].reduce((a, b) => (b[1] > a[1] ? b : a));
    out.push({ title: '🖍️ Chalk Muncher', player: pl(id), why: `Took the favorite ${n} times. Brave.` });
  }
  return out;
}
