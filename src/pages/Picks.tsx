import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { GameCard, type CardLimits } from '../components/GameCard';
import { defaultWeek, weekTitle, WeekTabs } from '../components/WeekTabs';
import { useLeague } from '../lib/league';
import { isLocked, pickPoints } from '../lib/scoring';
import { buildStandings, ordinal, ranks } from '../lib/standings';
import type { Game, League } from '../lib/types';

const LEAGUE_META: Record<League, { title: string; emoji: string }> = {
  cfb: { title: 'College', emoji: '🎓' },
  nfl: { title: 'Pro', emoji: '🏟️' },
};

export function PicksPage() {
  const { weeks, games, picks, players, teams, me, savePick, session } = useLeague();
  const [params, setParams] = useSearchParams();
  const visibleWeeks = weeks.filter(w => w.status !== 'draft' || me?.is_admin);
  const [weekId, setWeekId] = useState<number | null>(() => Number(params.get('week')) || null);

  useEffect(() => {
    if (weekId == null || !visibleWeeks.some(w => w.id === weekId)) setWeekId(defaultWeek(visibleWeeks, games));
  }, [visibleWeeks.length, games.length]); // eslint-disable-line

  // Admins can pick on someone else's behalf (e.g. filling everyone in from Josh's office).
  const actingId = me?.is_admin ? params.get('as') : null;
  const actor = (actingId && players.find(p => p.id === actingId)) || me;
  const setActing = (id: string) => {
    const next = new URLSearchParams(params);
    if (id === me?.id) next.delete('as');
    else next.set('as', id);
    setParams(next);
  };

  const week = visibleWeeks.find(w => w.id === weekId);
  const weekGames = useMemo(
    () => games.filter(g => g.week_id === weekId).sort((a, b) => (a.league === b.league ? a.sort - b.sort || a.kickoff.localeCompare(b.kickoff) : a.league === 'cfb' ? -1 : 1)),
    [games, weekId],
  );
  const myPicks = useMemo(() => new Map(picks.filter(p => p.player_id === actor?.id).map(p => [p.game_id, p])), [picks, actor]);

  if (!week) {
    return (
      <div className="card empty">
        <div className="big">🦗</div>
        <h2 className="display">No weeks yet</h2>
        <p className="muted">{me?.is_admin ? <Link to="/admin">Build the first week →</Link> : 'The commish hasn’t posted any games. Go hydrate.'}</p>
      </div>
    );
  }

  const gameIds = new Set(weekGames.map(g => g.id));
  const weekPicks = picks.filter(p => gameIds.has(p.game_id));
  const mine = weekGames.map(g => myPicks.get(g.id));
  const pickedCount = mine.filter(p => p?.pick_team_id).length;
  const scoreCalls = mine.filter(p => p?.score_away != null).length;
  const ddFor = (lg: League) => weekGames.find(g => g.league === lg && myPicks.get(g.id)?.is_dd);
  const hasLeague = (lg: League) => weekGames.some(g => g.league === lg);
  const myPts = weekGames.reduce((s, g) => s + pickPoints(g, myPicks.get(g.id), true).total, 0);

  const standings = buildStandings(players, games, picks, new Set([week.id]));
  const liveSorted = [...standings].sort((a, b) => b.live - a.live);
  const r = ranks(liveSorted.map(l => ({ ...l, total: l.live })));
  const myRank = actor ? r[liveSorted.findIndex(l => l.player.id === actor.id)] : null;
  const anyStarted = weekGames.some(g => g.status !== 'scheduled');

  const limitsFor = (g: Game): CardLimits => {
    const dd = ddFor(g.league);
    return {
      ddUsed: !!dd && dd.id !== g.id,
      ddLockedElsewhere: !!dd && dd.id !== g.id && isLocked(dd),
      scoreCallsLeft: week.score_picks - scoreCalls,
    };
  };

  const moveDD = (g: Game) => async () => {
    const dd = ddFor(g.league);
    if (dd && dd.id !== g.id) await savePick(dd.id, { is_dd: false }, actor?.id);
  };

  const unpicked = weekGames.filter(g => !myPicks.get(g.id)?.pick_team_id && !isLocked(g));

  return (
    <>
      <WeekTabs
        weeks={visibleWeeks}
        games={games}
        value={weekId}
        onChange={id => {
          setWeekId(id);
          const next = new URLSearchParams(params);
          next.set('week', String(id));
          setParams(next);
        }}
      />

      {me?.is_admin && week.status === 'open' && (
        <div className="card panel row wrap" style={{ marginBottom: 12, padding: '10px 14px', background: actor?.id !== me.id ? 'var(--yellow)' : undefined }}>
          <b className="display" style={{ fontSize: 14 }}>✍️ Picking for:</b>
          {players.map(p => {
            const n = weekGames.filter(g => picks.some(x => x.game_id === g.id && x.player_id === p.id && x.pick_team_id)).length;
            return (
              <button key={p.id} className={`btn small ${actor?.id === p.id ? 'primary' : ''}`} onClick={() => setActing(p.id)}>
                <Avatar p={p} size="sm" /> {p.name} <span style={{ opacity: 0.7 }}>{n}/{weekGames.length}</span>
              </button>
            );
          })}
          <Link className="btn small dark" to={`/party?week=${week.id}`}>🎉 Pick Party grid</Link>
        </div>
      )}

      <div className="card hero">
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <h2>{weekTitle(week)}{actor && actor.id !== me?.id ? ` · ${actor.emoji} ${actor.name}'s picks` : ''}</h2>
            <div className="sub">
              {week.status === 'draft' ? '✏️ Draft — only admins can see this' : week.status === 'final' ? '📦 In the books' : 'Picks lock at each kickoff. No take-backs.'}
            </div>
          </div>
          {me ? (
            <div className="checklist">
              <span className={`check ${pickedCount === weekGames.length ? 'done' : 'todo'}`}>
                {pickedCount === weekGames.length ? '✅' : '📝'} {pickedCount}/{weekGames.length} picked
              </span>
              {(['cfb', 'nfl'] as League[]).filter(hasLeague).map(lg => (
                <span key={lg} className={`check ${ddFor(lg) ? 'done' : 'todo'}`}>
                  🔥 {LEAGUE_META[lg].title} DD {ddFor(lg) ? '✓' : '—'}
                </span>
              ))}
              <span className={`check ${scoreCalls >= week.score_picks ? 'done' : 'todo'}`}>
                🎯 {scoreCalls}/{week.score_picks} score calls
              </span>
            </div>
          ) : (
            <div className="checklist">
              <Link className="btn primary" to="/login">{session ? 'Claim your player' : 'Log in to pick'} →</Link>
            </div>
          )}
          {me && unpicked.length > 0 && unpicked.length < weekGames.length && (
            <div className="muted" style={{ fontSize: 13, fontWeight: 700 }}>
              Still waiting on: {unpicked.map(g => `${teams.get(g.away_team_id)?.abbr}@${teams.get(g.home_team_id)?.abbr}`).join(', ')}
            </div>
          )}
        </div>
        {me && anyStarted && (
          <div className="score-bubble">
            <b>{myPts}</b>
            <span>pts{myRank ? ` · ${ordinal(myRank)}` : ''}</span>
          </div>
        )}
      </div>

      {(['cfb', 'nfl'] as League[]).filter(hasLeague).map(lg => (
        <section key={lg}>
          <div className="section-title">
            {LEAGUE_META[lg].emoji} {LEAGUE_META[lg].title}
          </div>
          <div className="games">
            {weekGames
              .filter(g => g.league === lg)
              .map(g => {
                const away = teams.get(g.away_team_id), home = teams.get(g.home_team_id);
                if (!away || !home) return null;
                return (
                  <GameCard
                    key={g.id}
                    game={g}
                    away={away}
                    home={home}
                    me={week.status === 'open' ? actor : null}
                    myPick={myPicks.get(g.id)}
                    picks={weekPicks.filter(p => p.game_id === g.id)}
                    players={players}
                    limits={limitsFor(g)}
                    onSave={patch => savePick(g.id, patch, actor?.id)}
                    onMoveDD={moveDD(g)}
                  />
                );
              })}
          </div>
        </section>
      ))}
    </>
  );
}
