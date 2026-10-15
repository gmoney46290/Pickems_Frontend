import { useEffect, useMemo, useState } from 'react';
import { boxesOpen, ITEMS } from '../lib/boxes';
import { useLeague } from '../lib/league';
import { fmtSpread, isLocked } from '../lib/scoring';
import { supabase } from '../lib/supabase';
import type { Box, Game, Player, Week } from '../lib/types';
import { Avatar } from './Avatar';
import { useToast } from './Toast';
import { fireParty, fireScore } from './fun';

/** The Q2 mystery-box panel: your boxes (open / play them) plus everyone's box log. */
export function MysteryBoxes({ week, actor, weekGames }: { week: Week; actor: Player | null; weekGames: Game[] }) {
  const { boxes, players, teams, reload, reloadBoxes, picks } = useLeague();
  const toast = useToast();
  const [counts, setCounts] = useState<{ player_id: string; total: number; used: number }[]>([]);
  const [using, setUsing] = useState<number | null>(null);
  const [opening, setOpening] = useState<number | null>(null);

  const mine = useMemo(() => boxes.filter(b => b.week_id === week.id && b.player_id === actor?.id).sort((a, b) => a.id - b.id), [boxes, week.id, actor]);
  const log = useMemo(() => boxes.filter(b => b.week_id === week.id && b.used_at).sort((a, b) => (b.used_at ?? '').localeCompare(a.used_at ?? '')), [boxes, week.id]);
  const open = boxesOpen(week);

  useEffect(() => {
    supabase.rpc('box_counts', { p_week: week.id }).then(({ data }) => setCounts((data as any[]) ?? []));
  }, [week.id, boxes]);

  const nameOf = (id: string | null) => players.find(p => p.id === id)?.name ?? '?';
  const gameLabel = (id: number | null) => {
    const g = weekGames.find(x => x.id === id);
    return g ? `${teams.get(g.away_team_id)?.abbr} @ ${teams.get(g.home_team_id)?.abbr}` : '?';
  };

  const describe = (b: Box) => {
    const it = ITEMS[b.item];
    switch (b.item) {
      case 'dice': return `${it.emoji} ${nameOf(b.player_id)} rolled ${b.dice_roll! > 0 ? '+' : ''}${b.dice_roll}`;
      case 'taser': return `${it.emoji} ${nameOf(b.player_id)} tased ${nameOf(b.target_player_id)} on ${gameLabel(b.target_game_id)} (−2)`;
      case 'landmine': return `${it.emoji} ${nameOf(b.player_id)} planted a landmine on ${nameOf(b.target_player_id)}'s ${gameLabel(b.target_game_id)} pick`;
      case 'teaser': return `${it.emoji} ${nameOf(b.player_id)} teased ${gameLabel(b.target_game_id)} 2 points their way`;
      case 'extra_dd': return `${it.emoji} ${nameOf(b.player_id)} doubled down again on ${gameLabel(b.target_game_id)}`;
      case 'lone_wolf': return `${it.emoji} ${nameOf(b.player_id)} went Lone Wolf on ${teams.get(b.target_team_id ?? '')?.abbr} (${gameLabel(b.target_game_id)})`;
    }
  };

  const openBox = async (b: Box) => {
    setOpening(b.id);
    await new Promise(r => setTimeout(r, 650)); // let it shake
    const { error } = await supabase.rpc('open_box', { p_box: b.id });
    setOpening(null);
    if (error) return toast(error.message, true);
    fireParty();
    toast(`${ITEMS[b.item].emoji} You got: ${ITEMS[b.item].name}!`);
    reloadBoxes();
  };

  const play = async (b: Box, args: { game?: number; target?: string; team?: string }) => {
    const { data, error } = await supabase.rpc('use_box', {
      p_box: b.id,
      p_game: args.game ?? null,
      p_target: args.target ?? null,
      p_team: args.team ?? null,
    });
    if (error) return toast(error.message, true);
    setUsing(null);
    const used = data as Box;
    if (used.item === 'dice') toast(`🎲 You rolled ${used.dice_roll! > 0 ? '+' : ''}${used.dice_roll}!`, (used.dice_roll ?? 0) < 0);
    else toast(`${ITEMS[used.item].emoji} ${ITEMS[used.item].name} played!`);
    fireScore();
    await reload(); // Lone Wolf rewrites picks; everything else changes scoring
  };

  const playable = weekGames.filter(g => !isLocked(g, Date.now(), week));
  const myPickOn = (gid: number) => picks.find(p => p.game_id === gid && p.player_id === actor?.id);

  return (
    <div className="card panel boxes-panel">
      <div className="row wrap" style={{ marginBottom: 8 }}>
        <div className="sticker" style={{ background: 'var(--purple)', color: 'white', fontSize: 18 }}>🎁 Mystery Boxes</div>
        <span className="muted" style={{ fontSize: 13, fontWeight: 700 }}>
          {open
            ? week.locks_at
              ? `Use them by ${new Date(week.locks_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })} or they vanish 💨`
              : 'Use them before picks lock. They don’t carry over.'
            : week.status === 'open' ? 'Picks are locked. Unused boxes went poof 💨' : 'Box week is over.'}
        </span>
      </div>

      {actor && (
        <div className="box-grid">
          {mine.length === 0 && <div className="muted">No boxes yet. The commish deals them when the week opens.</div>}
          {mine.map(b => {
            const it = ITEMS[b.item];
            const bonus = b.source === 'score_hit' ? <span className="chip yellow">🎯 bonus</span> : null;
            if (!b.opened_at && !b.used_at) {
              return (
                <button key={b.id} className={`mystery ${opening === b.id ? 'shake' : ''}`} onClick={() => openBox(b)} disabled={opening != null}>
                  <span className="mystery-emoji">🎁</span>
                  <span className="display">Tap to open</span>
                  {bonus}
                </button>
              );
            }
            if (b.used_at) {
              return (
                <div key={b.id} className="box-card used">
                  <div className="box-title">{it.emoji} {it.name} {bonus}</div>
                  <div className="muted" style={{ fontSize: 13 }}>✅ {describe(b)}</div>
                </div>
              );
            }
            return (
              <div key={b.id} className="box-card">
                <div className="box-title">{it.emoji} {it.name} {bonus}</div>
                <div style={{ fontSize: 13 }}>{it.blurb}</div>
                {!open ? (
                  <div className="muted" style={{ fontWeight: 700 }}>💨 Expired</div>
                ) : using === b.id ? (
                  <UseForm box={b} games={playable} players={players.filter(p => p.id !== actor.id)} teams={teams} myPickOn={myPickOn} onPlay={args => play(b, args)} onCancel={() => setUsing(null)} />
                ) : (
                  <button className="btn primary small" onClick={() => setUsing(b.id)}>
                    {b.item === 'dice' ? '🎲 Roll it' : 'Play it →'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="row wrap" style={{ marginTop: 12, gap: 6 }}>
        {players.map(p => {
          const c = counts.find(x => x.player_id === p.id);
          if (!c) return null;
          return (
            <span key={p.id} className="chip" title={`${c.used} of ${c.total} played`}>
              <Avatar p={p} size="sm" /> 🎁×{c.total - c.used}
              {c.used > 0 && <span className="muted"> ({c.used} played)</span>}
            </span>
          );
        })}
      </div>

      {log.length > 0 && (
        <div className="box-log">
          {log.map(b => (
            <div key={b.id}>{describe(b)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function UseForm({
  box,
  games,
  players,
  teams,
  myPickOn,
  onPlay,
  onCancel,
}: {
  box: Box;
  games: Game[];
  players: Player[];
  teams: Map<string, import('../lib/types').Team>;
  myPickOn: (gid: number) => import('../lib/types').Pick | undefined;
  onPlay: (args: { game?: number; target?: string; team?: string }) => void;
  onCancel: () => void;
}) {
  const it = ITEMS[box.item];
  const [game, setGame] = useState<number | ''>('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const g = games.find(x => x.id === game);
  const label = (x: Game) => {
    const a = teams.get(x.away_team_id), h = teams.get(x.home_team_id);
    const mp = myPickOn(x.id);
    const mine = mp?.pick_team_id ? ` · you: ${teams.get(mp.pick_team_id)?.abbr}` : '';
    return `${a?.abbr} @ ${h?.abbr} (${h?.abbr} ${fmtSpread(Number(x.home_spread))})${mine}`;
  };
  const go = async (args: { game?: number; target?: string; team?: string }) => {
    setBusy(true);
    await onPlay(args);
    setBusy(false);
  };

  if (it.needs === 'nothing') {
    return (
      <div className="row">
        <button className="btn primary small" disabled={busy} onClick={() => go({})}>🎲 Roll!</button>
        <button className="btn small" onClick={onCancel}>Not yet</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {it.needs === 'opponent' && (
        <select className="input" value={target} onChange={e => setTarget(e.target.value)}>
          <option value="">Who are you hitting?</option>
          {players.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
        </select>
      )}
      <select className="input" value={game} onChange={e => setGame(e.target.value ? Number(e.target.value) : '')}>
        <option value="">Which game?</option>
        {games.map(x => <option key={x.id} value={x.id}>{label(x)}</option>)}
      </select>
      {it.needs === 'team' && g ? (
        <div className="row">
          {[g.away_team_id, g.home_team_id].map(tid => (
            <button key={tid} className="btn small dark" disabled={busy} onClick={() => go({ game: g.id, team: tid })}>
              🐺 Take {teams.get(tid)?.abbr}
            </button>
          ))}
        </div>
      ) : null}
      <div className="row">
        {it.needs !== 'team' && (
          <button
            className="btn primary small"
            disabled={busy || !game || (it.needs === 'opponent' && !target)}
            onClick={() => go({ game: game || undefined, target: target || undefined })}
          >
            {it.emoji} Play {it.name}
          </button>
        )}
        <button className="btn small" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
