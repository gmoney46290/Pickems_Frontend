import { useEffect, useRef, useState } from 'react';
import { atsSide, fmtSpread, isLocked, pickPoints, pickedSide, scoreCallHits } from '../lib/scoring';
import type { Game, Pick, Player, Team } from '../lib/types';
import { LineShop } from './LineShop';
import { useToast } from './Toast';
import { fireDD, firePick, fireScore, LOSS_WORDS, pickWord, WIN_WORDS } from './fun';

export interface CardLimits {
  ddUsed: boolean; // already have a DD in this league on another game
  ddLockedElsewhere: boolean; // ...and that one is locked, so it can't move
  scoreCallsLeft: number;
}

interface Props {
  game: Game;
  away: Team;
  home: Team;
  me: Player | null;
  myPick?: Pick;
  picks: Pick[];
  players: Player[];
  limits: CardLimits;
  onSave: (patch: Partial<Pick>) => Promise<void>;
  onMoveDD: () => Promise<void>;
}

function inkFor(hex: string | null) {
  if (!hex) return '#16121f';
  const n = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#16121f' : '#ffffff';
}

function kickoffLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

export function GameCard({ game, away, home, me, myPick, picks, players, limits, onSave, onMoveDD }: Props) {
  const toast = useToast();
  const [showLines, setShowLines] = useState(false);
  const [editingScore, setEditingScore] = useState(false);
  const [sa, setSa] = useState<string>('');
  const [sh, setSh] = useState<string>('');
  const cardRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const locked = isLocked(game, now);
  const picked = pickedSide(game, myPick);
  const live = game.status === 'in';
  const final = game.status === 'final';
  const hasScore = game.away_score != null && game.home_score != null && (live || final);
  const covering = hasScore ? atsSide(game, game.away_score!, game.home_score!) : null;
  const pts = pickPoints(game, myPick, true);
  const myCall = myPick?.score_away != null;
  const tweaked = game.market_spread != null && Number(game.market_spread) !== Number(game.home_spread);
  const canEdit = !!me && !locked;

  const run = async (patch: Partial<Pick>, fx?: () => void) => {
    try {
      await onSave(patch);
      fx?.();
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  const choose = (side: 'home' | 'away', el: HTMLElement) => {
    if (!canEdit) return;
    const teamId = side === 'home' ? home.id : away.id;
    if (myPick?.pick_team_id === teamId) return;
    run({ pick_team_id: teamId }, () => firePick(el));
  };

  const toggleDD = async () => {
    if (!canEdit) return;
    if (myPick?.is_dd) return run({ is_dd: false });
    if (!picked) return toast('Pick a side before you double down, champ', true);
    if (limits.ddUsed) {
      if (limits.ddLockedElsewhere) return toast(`Your ${game.league === 'nfl' ? 'pro' : 'college'} double down is already locked in 🔒`, true);
      try {
        await onMoveDD();
      } catch (e: any) {
        return toast(e.message, true);
      }
    }
    run({ is_dd: true }, () => fireDD(cardRef.current));
  };

  const openScore = () => {
    if (!canEdit) return;
    if (!myCall && limits.scoreCallsLeft <= 0) return toast('Out of score calls this week 🎯', true);
    setSa(myPick?.score_away?.toString() ?? '');
    setSh(myPick?.score_home?.toString() ?? '');
    setEditingScore(true);
  };

  const saveScore = () => {
    const a = parseInt(sa), h = parseInt(sh);
    if (isNaN(a) || isNaN(h) || a < 0 || h < 0) return toast('Scores need to be real numbers', true);
    setEditingScore(false);
    run({ score_away: a, score_home: h }, () => fireScore(cardRef.current));
  };

  const clearScore = () => {
    setEditingScore(false);
    run({ score_away: null, score_home: null });
  };

  const teamBtn = (side: 'away' | 'home') => {
    const t = side === 'away' ? away : home;
    const spread = side === 'home' ? Number(game.home_spread) : -Number(game.home_spread);
    const score = side === 'away' ? game.away_score : game.home_score;
    const rank = (t as any).rank;
    const isPicked = picked === side;
    return (
      <button
        className={`team-btn ${isPicked ? 'picked' : ''} ${picked && !isPicked ? 'faded' : ''}`}
        style={isPicked ? ({ ['--team' as any]: t.color ?? undefined, ['--team-ink' as any]: inkFor(t.color) }) : undefined}
        disabled={!canEdit}
        onClick={e => choose(side, e.currentTarget)}
        aria-pressed={isPicked}
        title={t.name}
      >
        <span className="team-logo-wrap">
          {t.logo ? <img className="team-logo" src={t.logo} alt="" loading="lazy" /> : <span className="team-logo" />}
        </span>
        <span className="team-name">
          {rank ? <span className="team-rank">#{rank}</span> : null}
          {t.short_name}
        </span>
        {hasScore ? <span className="team-score">{score}</span> : null}
        <span className="team-spread">{fmtSpread(spread)}</span>
        {(live || final) && covering === side && <span className="covering-tag">{final ? 'covered ✓' : 'covering'}</span>}
      </button>
    );
  };

  // Everyone's picks are public.
  const others = picks.filter(p => p.pick_team_id);
  const whoFor = (teamId: string) =>
    others
      .filter(p => p.pick_team_id === teamId)
      .map(p => ({ p, pl: players.find(x => x.id === p.player_id) }))
      .filter(x => x.pl)
      .sort((a, b) => a.pl!.sort - b.pl!.sort);

  let status: React.ReactNode;
  if (live) status = <span style={{ color: 'var(--loss)' }}><span className="live-dot" />{game.status_detail ?? 'LIVE'}</span>;
  else if (final) status = <span className="chip dark">{game.status_detail ?? 'FINAL'}</span>;
  else if (game.status === 'canceled') status = <span className="chip">Canceled</span>;
  else status = <span>{kickoffLabel(game.kickoff)}{locked ? ' · 🔒' : ''}</span>;

  const seed = game.id + (myPick?.player_id?.charCodeAt(0) ?? 0);

  return (
    <div ref={cardRef} className={`game ${myPick?.is_dd ? 'dd' : ''}`}>
      <div className="game-top">
        {status}
        <span className="row" style={{ gap: 4 }}>
          {tweaked && (
            <span className="chip yellow" title="Our line differs from DraftKings">
              🌶️ Vegas {Number(game.market_spread) <= 0 ? home.abbr : away.abbr} {fmtSpread(-Math.abs(Number(game.market_spread)))}
            </span>
          )}
          {game.neutral && <span className="chip ghost">neutral</span>}
        </span>
      </div>

      <div className="matchup">
        {teamBtn('away')}
        <span className="at">@</span>
        {teamBtn('home')}
      </div>

      {live && game.situation && <div className="muted center" style={{ fontSize: 12, fontWeight: 700 }}>🏈 {game.situation}</div>}

      {(pts.outcome === 'win' || pts.outcome === 'loss' || pts.outcome === 'push') && (live || final) && (
        <div className={`stamp ${pts.outcome}`} style={live ? { opacity: 0.45 } : undefined}>
          {pts.outcome === 'push' ? 'PUSH' : pickWord(pts.outcome === 'win' ? WIN_WORDS : LOSS_WORDS, seed)} {pts.total > 0 ? `+${pts.total}` : pts.total < 0 ? pts.total : ''}
        </div>
      )}

      {editingScore ? (
        <div className="score-call">
          <span className="lbl">🎯</span>
          <span className="lbl">{away.abbr}</span>
          <input className="input" inputMode="numeric" value={sa} onChange={e => setSa(e.target.value.replace(/\D/g, ''))} autoFocus />
          <span className="lbl">{home.abbr}</span>
          <input className="input" inputMode="numeric" value={sh} onChange={e => setSh(e.target.value.replace(/\D/g, ''))} onKeyDown={e => e.key === 'Enter' && saveScore()} />
          <button className="btn small primary" onClick={saveScore}>Lock it</button>
          {myCall && <button className="btn small" onClick={clearScore}>Remove</button>}
          <button className="btn small" onClick={() => setEditingScore(false)}>✕</button>
        </div>
      ) : myCall ? (
        <div className="score-call" style={scoreCallHits(game, myPick) && hasScore ? { background: 'var(--yellow)', borderStyle: 'solid' } : undefined}>
          <span className="lbl">
            🎯 My call: {away.abbr} {myPick!.score_away} – {home.abbr} {myPick!.score_home}
          </span>
          {hasScore && scoreCallHits(game, myPick) && <span className="chip pink">{final ? 'BULLSEYE +3' : 'on pace 👀'}</span>}
          {canEdit && <button className="btn small" style={{ marginLeft: 'auto' }} onClick={openScore}>Edit</button>}
        </div>
      ) : null}

      <div className="game-actions">
        {(canEdit || myPick?.is_dd) && (
          <button className={`btn small ${myPick?.is_dd ? 'on' : ''}`} disabled={!canEdit} onClick={toggleDD} title="+2 if right, -1 if wrong">
            🔥 {myPick?.is_dd ? 'Doubled!' : 'Double down'}
          </button>
        )}
        {canEdit && !myCall && (
          <button className="btn small" disabled={!canEdit || limits.scoreCallsLeft <= 0} onClick={openScore} title="Within 2 points on both teams = +3">
            🎯 Call score
          </button>
        )}
        <button className={`btn small ${showLines ? 'yellow' : ''}`} onClick={() => setShowLines(s => !s)}>
          📊 Lines
        </button>
      </div>

      {showLines && <LineShop game={game} home={home} away={away} />}

      {others.length > 0 && (
        <div className="pickers">
          {[away, home].map(t => (
            <div key={t.id}>
              {whoFor(t.id).map(({ p, pl }) => {
                const hit = hasScore && scoreCallHits(game, p);
                return (
                  <span key={p.id} className={`who ${p.is_dd ? 'dd' : ''} ${hit ? 'hit' : ''}`} title={pl!.name}>
                    {pl!.emoji} {pl!.name}
                    {p.is_dd && ' 🔥'}
                    {p.score_away != null && <span className="sc">🎯{p.score_away}-{p.score_home}</span>}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
