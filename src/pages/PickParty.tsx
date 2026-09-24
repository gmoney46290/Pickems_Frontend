import { useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { useToast } from '../components/Toast';
import { defaultWeek, weekTitle, WeekTabs } from '../components/WeekTabs';
import { fireDD, fireScore } from '../components/fun';
import { useLeague } from '../lib/league';
import { fmtSpread, isLocked } from '../lib/scoring';
import type { Game, Pick, Player, Team } from '../lib/types';

/**
 * Admin-only bulk entry: one person fills in everybody's picks (e.g. the group huddled in
 * Josh's office). Grid view for the whole week, or one game at a time for going around the room.
 */
export function PickPartyPage() {
  const { me, ready, weeks, games, picks, players, teams, savePick } = useLeague();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [weekId, setWeekId] = useState<number | null>(() => Number(params.get('week')) || null);
  const [view, setView] = useState<'room' | 'grid'>(() => (params.get('view') === 'grid' ? 'grid' : 'room'));
  const [idx, setIdx] = useState(0);
  const [override, setOverride] = useState(false);
  const [scoreEdit, setScoreEdit] = useState<{ gid: number; pid: string; a: string; h: string } | null>(null);

  const partyWeeks = weeks.filter(w => w.status !== 'final');
  useEffect(() => {
    if (weekId == null || !weeks.some(w => w.id === weekId)) setWeekId(defaultWeek(partyWeeks.length ? partyWeeks : weeks, games));
  }, [weeks.length, games.length]); // eslint-disable-line

  const week = weeks.find(w => w.id === weekId);
  const weekGames = useMemo(
    () => games.filter(g => g.week_id === weekId).sort((a, b) => (a.league === b.league ? a.sort - b.sort || a.kickoff.localeCompare(b.kickoff) : a.league === 'cfb' ? -1 : 1)),
    [games, weekId],
  );
  const pickMap = useMemo(() => new Map(picks.map(p => [`${p.game_id}:${p.player_id}`, p])), [picks]);
  const pickOf = (gid: number, pid: string) => pickMap.get(`${gid}:${pid}`);

  const game = weekGames[Math.min(idx, weekGames.length - 1)];

  useEffect(() => {
    if (view !== 'room') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') setIdx(i => Math.min(i + 1, weekGames.length - 1));
      if (e.key === 'ArrowLeft') setIdx(i => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, weekGames.length]);

  if (ready && !me?.is_admin) return <Navigate to="/" replace />;
  if (!week) return <div className="card empty"><div className="big">🎉</div><p>No weeks to party on yet.</p></div>;

  const editable = (g: Game) => override || !isLocked(g);

  const save = async (g: Game, pid: string, patch: Partial<Pick>) => {
    try {
      await savePick(g.id, patch, pid);
      return true;
    } catch (e: any) {
      toast(e.message, true);
      return false;
    }
  };

  const setTeam = (g: Game, p: Player, teamId: string) => {
    if (!editable(g)) return toast('Locked 🔒 (flip on "edit locked games" to fix it)', true);
    const cur = pickOf(g.id, p.id);
    // click the same team again to clear it
    if (cur?.pick_team_id === teamId) return save(g, p.id, { pick_team_id: null, is_dd: false });
    save(g, p.id, { pick_team_id: teamId });
  };

  const toggleDD = async (g: Game, p: Player, el: HTMLElement) => {
    if (!editable(g)) return toast('Locked 🔒', true);
    const cur = pickOf(g.id, p.id);
    if (cur?.is_dd) return save(g, p.id, { is_dd: false });
    if (!cur?.pick_team_id) return toast(`${p.name} needs a side before doubling down`, true);
    // one DD per league: move it off whatever game had it
    const other = weekGames.find(x => x.id !== g.id && x.league === g.league && pickOf(x.id, p.id)?.is_dd);
    if (other) {
      if (!editable(other)) return toast(`${p.name}'s ${g.league === 'nfl' ? 'pro' : 'college'} DD is already locked on another game`, true);
      if (!(await save(other, p.id, { is_dd: false }))) return;
    }
    if (await save(g, p.id, { is_dd: true })) fireDD(el);
  };

  const openScore = (g: Game, p: Player) => {
    if (!editable(g)) return toast('Locked 🔒', true);
    const cur = pickOf(g.id, p.id);
    const used = weekGames.filter(x => x.id !== g.id && pickOf(x.id, p.id)?.score_away != null).length;
    if (cur?.score_away == null && used >= week.score_picks) return toast(`${p.name} is out of score calls (${week.score_picks})`, true);
    setScoreEdit({ gid: g.id, pid: p.id, a: cur?.score_away?.toString() ?? '', h: cur?.score_home?.toString() ?? '' });
  };

  const commitScore = async (g: Game, clear = false) => {
    if (!scoreEdit) return;
    const { pid, a, h } = scoreEdit;
    if (clear) {
      setScoreEdit(null);
      return save(g, pid, { score_away: null, score_home: null });
    }
    const na = parseInt(a), nh = parseInt(h);
    if (isNaN(na) || isNaN(nh)) return toast('Two numbers please', true);
    setScoreEdit(null);
    if (await save(g, pid, { score_away: na, score_home: nh })) fireScore();
  };

  const progress = (p: Player) => {
    const ps = weekGames.map(g => pickOf(g.id, p.id));
    return {
      picked: ps.filter(x => x?.pick_team_id).length,
      cfbDD: weekGames.some(g => g.league === 'cfb' && pickOf(g.id, p.id)?.is_dd),
      nflDD: weekGames.some(g => g.league === 'nfl' && pickOf(g.id, p.id)?.is_dd),
      calls: ps.filter(x => x?.score_away != null).length,
    };
  };
  const hasCfb = weekGames.some(g => g.league === 'cfb'), hasNfl = weekGames.some(g => g.league === 'nfl');

  const scoreEditor = (g: Game, away: Team, home: Team, big = false) =>
    scoreEdit && scoreEdit.gid === g.id ? (
      <span className="row" style={{ gap: 4 }}>
        <input className="input" style={{ width: big ? 56 : 44, padding: 3, textAlign: 'center' }} placeholder={away.abbr} inputMode="numeric" autoFocus value={scoreEdit.a} onChange={e => setScoreEdit({ ...scoreEdit, a: e.target.value.replace(/\D/g, '') })} />
        <input className="input" style={{ width: big ? 56 : 44, padding: 3, textAlign: 'center' }} placeholder={home.abbr} inputMode="numeric" value={scoreEdit.h} onChange={e => setScoreEdit({ ...scoreEdit, h: e.target.value.replace(/\D/g, '') })} onKeyDown={e => { if (e.key === 'Enter') commitScore(g); if (e.key === 'Escape') setScoreEdit(null); }} />
        <button className="btn small primary" onClick={() => commitScore(g)}>✓</button>
        <button className="btn small" onClick={() => commitScore(g, true)} title="remove">✕</button>
      </span>
    ) : null;

  const teamPickBtn = (g: Game, p: Player, t: Team, big: boolean) => {
    const on = pickOf(g.id, p.id)?.pick_team_id === t.id;
    return (
      <button
        className={`party-team ${on ? 'on' : ''} ${big ? 'big' : ''}`}
        style={on ? ({ ['--team' as any]: t.color ?? '#ffd23f' }) : undefined}
        onClick={() => setTeam(g, p, t.id)}
        title={`${p.name}: ${t.name}`}
      >
        {t.logo ? <img src={t.logo} alt="" /> : null}
        <span>{t.abbr}</span>
      </button>
    );
  };

  const extras = (g: Game, p: Player, away: Team, home: Team, big: boolean) => {
    const pk = pickOf(g.id, p.id);
    const editingThis = scoreEdit?.gid === g.id && scoreEdit.pid === p.id;
    return (
      <>
        <button className={`party-icon ${pk?.is_dd ? 'on' : ''}`} onClick={e => toggleDD(g, p, e.currentTarget)} title="double down">🔥</button>
        {editingThis ? (
          scoreEditor(g, away, home, big)
        ) : (
          <button className={`party-icon ${pk?.score_away != null ? 'on-score' : ''}`} onClick={() => openScore(g, p)} title="score call (away-home)">
            🎯{pk?.score_away != null && <small>{pk.score_away}-{pk.score_home}</small>}
          </button>
        )}
      </>
    );
  };

  const header = (
    <>
      <WeekTabs weeks={weeks} games={games} value={weekId} onChange={id => { setWeekId(id); setIdx(0); setParams({ week: String(id) }); }} />
      <div className="card panel row wrap" style={{ marginBottom: 12 }}>
        <div className="sticker" style={{ background: 'var(--pink)', color: 'white', fontSize: 20 }}>🎉 Pick Party · {weekTitle(week)}</div>
        <div className="grow" />
        <button className={`btn small ${view === 'room' ? 'primary' : ''}`} onClick={() => setView('room')}>🎤 One game at a time</button>
        <button className={`btn small ${view === 'grid' ? 'primary' : ''}`} onClick={() => setView('grid')}>🧮 Whole grid</button>
        <label className="row" style={{ fontWeight: 700, fontSize: 13 }}>
          <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} /> 🔓 edit locked games
        </label>
      </div>
      {week.status === 'draft' && <p className="chip yellow">✏️ This week is still a draft. Open it in Admin when you're done.</p>}
      <div className="party-progress">
        {players.map(p => {
          const pr = progress(p);
          const done = pr.picked === weekGames.length && (!hasCfb || pr.cfbDD) && (!hasNfl || pr.nflDD);
          return (
            <div key={p.id} className={`card party-prog ${done ? 'done' : ''}`}>
              <div className="row"><Avatar p={p} size="sm" /> <b>{p.name}</b>{done && ' ✅'}</div>
              <div className="muted" style={{ fontSize: 12, fontWeight: 700 }}>
                {pr.picked}/{weekGames.length} · {hasCfb && `🎓🔥${pr.cfbDD ? '✓' : '–'} `}{hasNfl && `🏟️🔥${pr.nflDD ? '✓' : '–'} `}· 🎯{pr.calls}/{week.score_picks}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );

  if (!weekGames.length) return <>{header}<div className="card empty"><p>No games in this week yet.</p></div></>;

  if (view === 'room' && game) {
    const away = teams.get(game.away_team_id)!, home = teams.get(game.home_team_id)!;
    const nAway = players.filter(p => pickOf(game.id, p.id)?.pick_team_id === away.id).length;
    const nHome = players.filter(p => pickOf(game.id, p.id)?.pick_team_id === home.id).length;
    const locked = isLocked(game);
    return (
      <>
        {header}
        <div className="game-strip">
          {weekGames.map((g, i) => {
            const all = players.every(p => pickOf(g.id, p.id)?.pick_team_id);
            return (
              <button key={g.id} className={`strip-pill ${i === idx ? 'active' : ''} ${all ? 'done' : ''}`} onClick={() => setIdx(i)}>
                {teams.get(g.away_team_id)?.abbr}@{teams.get(g.home_team_id)?.abbr}{all ? ' ✓' : ''}
              </button>
            );
          })}
        </div>
        <div className="card panel room">
          <div className="room-head">
            <button className="btn" disabled={idx === 0} onClick={() => setIdx(i => i - 1)}>← Prev</button>
            <div className="room-matchup">
              <div className="room-team">{away.logo && <img src={away.logo} alt="" />}<b>{away.short_name}</b><span className="team-spread">{fmtSpread(-Number(game.home_spread))}</span></div>
              <div className="display muted">@</div>
              <div className="room-team">{home.logo && <img src={home.logo} alt="" />}<b>{home.short_name}</b><span className="team-spread">{fmtSpread(Number(game.home_spread))}</span></div>
            </div>
            <button className="btn" disabled={idx >= weekGames.length - 1} onClick={() => setIdx(i => i + 1)}>Next →</button>
          </div>
          <div className="center muted" style={{ fontWeight: 700 }}>
            {game.league === 'nfl' ? '🏟️ Pro' : '🎓 College'} · game {idx + 1} of {weekGames.length} · {new Date(game.kickoff).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}{locked ? ' · 🔒 locked' : ''}
          </div>
          <div className="split-bar" style={{ width: '100%', height: 12, margin: '6px 0 4px' }}>
            <div style={{ flex: nAway || 0.0001, background: away.color ?? '#888' }} />
            <div style={{ flex: nHome || 0.0001, background: home.color ?? '#ccc' }} />
          </div>
          <div className="row" style={{ justifyContent: 'space-between', fontWeight: 700, fontSize: 13 }}>
            <span>{away.abbr}: {nAway}</span><span>{home.abbr}: {nHome}</span>
          </div>
          <div className="room-rows">
            {players.map(p => (
              <div key={p.id} className="room-row">
                <div className="row" style={{ minWidth: 120 }}><Avatar p={p} /> <b>{p.name}</b></div>
                <div className="row" style={{ gap: 8 }}>
                  {teamPickBtn(game, p, away, true)}
                  {teamPickBtn(game, p, home, true)}
                </div>
                <div className="row" style={{ gap: 6 }}>{extras(game, p, away, home, true)}</div>
              </div>
            ))}
          </div>
          <p className="muted center" style={{ fontSize: 12, marginBottom: 0 }}>Tip: ← / → keys flip games. Click a team again to clear it.</p>
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="board-wrap">
        <table className="board party-grid">
          <thead>
            <tr>
              <th className="game-col">Game</th>
              {players.map(p => <th key={p.id}><div className="row" style={{ justifyContent: 'center', gap: 4 }}><Avatar p={p} size="sm" /> {p.name}</div></th>)}
            </tr>
          </thead>
          <tbody>
            {weekGames.map(g => {
              const away = teams.get(g.away_team_id)!, home = teams.get(g.home_team_id)!;
              return (
                <tr key={g.id} style={!editable(g) ? { opacity: 0.55 } : undefined}>
                  <td className="game-col">
                    <div style={{ fontWeight: 700 }}>{away.abbr} @ {home.abbr}{isLocked(g) && ' 🔒'}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{home.abbr} {fmtSpread(Number(g.home_spread))} · {g.league === 'nfl' ? 'Pro' : 'College'}</div>
                  </td>
                  {players.map(p => (
                    <td key={p.id}>
                      <div className="party-cell">
                        {teamPickBtn(g, p, away, false)}
                        {teamPickBtn(g, p, home, false)}
                        {extras(g, p, away, home, false)}
                      </div>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
