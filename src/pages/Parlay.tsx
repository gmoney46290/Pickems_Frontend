import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { useToast } from '../components/Toast';
import { fireParty, firePick } from '../components/fun';
import { useLeague } from '../lib/league';
import { supabase } from '../lib/supabase';

/** Parlay Party: a weekly goofy-prop side game. No tie-in to the main standings. */

interface PWeek { id: number; season: number; season_type: number; week: number }
interface POption { key: string; label: string; img?: string | null; sub?: string }
interface PProp {
  id: number; week_id: number; sort: number; kind: string; emoji: string; title: string; detail: string | null;
  options: POption[]; locks_at: string; status: 'open' | 'graded' | 'void'; results: string[] | null; result_note: string | null;
}
interface PEntry { prop_id: number; player_id: string; choice: string }

const weekName = (w: PWeek) => (w.season_type === 3 ? `Playoffs wk ${w.week}` : `Week ${w.week}`);
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

export function ParlayPage() {
  const { me, players } = useLeague();
  const toast = useToast();
  const [weeks, setWeeks] = useState<PWeek[] | null>(null);
  const [props, setProps] = useState<PProp[]>([]);
  const [entries, setEntries] = useState<PEntry[]>([]);
  const [weekId, setWeekId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const [w, p, e] = await Promise.all([
      supabase.from('parlay_weeks').select('*').order('season', { ascending: false }).order('season_type', { ascending: false }).order('week', { ascending: false }),
      supabase.from('parlay_props').select('*').order('sort'),
      supabase.from('parlay_entries').select('prop_id,player_id,choice'),
    ]);
    if (w.error) return setErr(w.error.message);
    setWeeks(w.data as PWeek[]);
    setProps((p.data as PProp[]) ?? []);
    setEntries((e.data as PEntry[]) ?? []);
    setWeekId(id => id ?? (w.data as PWeek[])[0]?.id ?? null);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel('parlay')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parlay_entries' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parlay_props' }, () => load())
      .subscribe();
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, [load]);

  const week = weeks?.find(w => w.id === weekId);
  const weekProps = useMemo(() => props.filter(p => p.week_id === weekId), [props, weekId]);
  const pick = (propId: number, pid: string) => entries.find(e => e.prop_id === propId && e.player_id === pid)?.choice;

  // Leaderboard: correct picks among graded props.
  const board = useMemo(() => {
    const graded = weekProps.filter(p => p.status === 'graded');
    return players
      .map(pl => {
        const made = weekProps.filter(p => pick(p.id, pl.id)).length;
        const right = graded.filter(p => p.results?.includes(pick(p.id, pl.id) ?? '')).length;
        const decided = graded.filter(p => pick(p.id, pl.id)).length;
        return { pl, made, right, decided };
      })
      .filter(r => r.made > 0)
      .sort((a, b) => b.right - a.right || b.made - a.made);
  }, [players, weekProps, entries]); // eslint-disable-line
  const allDone = weekProps.length > 0 && weekProps.every(p => p.status !== 'open');
  const top = board[0]?.right ?? 0;

  // Season tally of weekly wins (ties share).
  const champs = useMemo(() => {
    const wins = new Map<string, number>();
    for (const w of weeks ?? []) {
      const ps = props.filter(p => p.week_id === w.id);
      if (!ps.length || ps.some(p => p.status === 'open')) continue;
      const scores = players.map(pl => ({ pl, n: ps.filter(p => p.status === 'graded' && p.results?.includes(entries.find(e => e.prop_id === p.id && e.player_id === pl.id)?.choice ?? '')).length }));
      const best = Math.max(0, ...scores.map(s => s.n));
      if (best > 0) scores.filter(s => s.n === best).forEach(s => wins.set(s.pl.id, (wins.get(s.pl.id) ?? 0) + 1));
    }
    return [...wins].map(([id, n]) => ({ pl: players.find(p => p.id === id)!, n })).filter(x => x.pl).sort((a, b) => b.n - a.n);
  }, [weeks, props, entries, players]);

  const choose = async (p: PProp, key: string, el: HTMLElement) => {
    if (!me) return toast('Log in to play 🎰', true);
    if (Date.parse(p.locks_at) <= Date.now() || p.status !== 'open') return toast('Locked 🔒', true);
    const cur = pick(p.id, me.id);
    const { error } =
      cur === key
        ? await supabase.from('parlay_entries').delete().match({ prop_id: p.id, player_id: me.id })
        : await supabase.from('parlay_entries').upsert({ prop_id: p.id, player_id: me.id, choice: key, updated_at: new Date().toISOString() });
    if (error) return toast(error.message.includes('row-level') ? 'Too late, that one locked 🔒' : error.message, true);
    if (cur !== key) firePick(el);
    load();
  };

  const runNow = async () => {
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const r = await fetch('/.netlify/functions/parlay-now', { method: 'POST', headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) toast(`Failed: ${j.error ?? r.status}`, true);
      else {
        toast(j.built?.created ? `🎰 Built ${j.built.props} props for week ${j.built.week}` : `Graded ${j.graded?.graded ?? 0} props${j.built?.reason ? ` · ${j.built.reason}` : ''}`);
        if (j.built?.created) fireParty();
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (err)
    return (
      <div className="card panel" style={{ background: 'var(--loss-bg)' }}>
        💥 Parlay Party isn't set up yet ({err}). The commish needs to run the setup SQL.
      </div>
    );
  if (!weeks) return <div className="empty" style={{ color: 'white' }}><div className="spinner">🎰</div></div>;

  return (
    <div className="parlay">
      <div className="card panel parlay-hero">
        <div>
          <div className="sticker" style={{ background: 'var(--purple)', color: 'white', fontSize: 24 }}>🎰 Parlay Party</div>
          <p style={{ margin: '10px 0 0', fontWeight: 500 }}>
            A fresh pile of weird bets every Tuesday morning. Most right wins. No stakes, all glory.
            {!me && <> <Link to="/login">Log in</Link> to play.</>}
          </p>
        </div>
        {me?.is_admin && (
          <button className="btn yellow" disabled={busy} onClick={runNow} title="Build this week's slate if it's missing, then grade finished games">
            ⚡ {busy ? 'Working…' : 'Build / grade now'}
          </button>
        )}
      </div>

      {weeks.length > 0 && (
        <div className="week-tabs">
          {weeks.map(w => (
            <button key={w.id} className={`week-tab ${w.id === weekId ? 'active' : ''}`} onClick={() => setWeekId(w.id)}>
              {weekName(w)}
            </button>
          ))}
        </div>
      )}

      {!week ? (
        <div className="card empty">
          <div className="big">🎰</div>
          <p>No slate yet. The first one drops Tuesday morning{me?.is_admin ? ', or hit ⚡ to build this week now' : ''}.</p>
        </div>
      ) : (
        <>
          <div className="card panel">
            <div className="row wrap" style={{ marginBottom: 8 }}>
              <b className="display">🏆 {weekName(week)} leaderboard</b>
              <span className="muted" style={{ fontSize: 13, fontWeight: 700 }}>
                {weekProps.filter(p => p.status !== 'open').length}/{weekProps.length} settled
              </span>
            </div>
            {board.length === 0 ? (
              <div className="muted">Nobody's picked yet. Be the first degenerate.</div>
            ) : (
              <div className="row wrap" style={{ gap: 8 }}>
                {board.map(r => (
                  <span key={r.pl.id} className={`chip ${allDone && r.right === top && top > 0 ? 'yellow' : ''}`} style={{ fontSize: 14, padding: '4px 10px' }}>
                    <Avatar p={r.pl} size="sm" /> {r.pl.name} <b>{r.right}</b>
                    <span className="muted">/{r.decided}</span>
                    {allDone && r.right === top && top > 0 && ' 👑'}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="parlay-grid">
            {weekProps.map(p => {
              const locked = Date.parse(p.locks_at) <= now || p.status !== 'open';
              const mine = me ? pick(p.id, me.id) : undefined;
              return (
                <div key={p.id} className={`card parlay-card ${p.status}`}>
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span className="parlay-emoji">{p.emoji}</span>
                    <span className={`chip ${p.status === 'graded' ? 'green' : p.status === 'void' ? '' : locked ? 'dark' : ''}`}>
                      {p.status === 'graded' ? '✅ settled' : p.status === 'void' ? '🫥 void' : locked ? '🔒 locked' : `⏰ ${when(p.locks_at)}`}
                    </span>
                  </div>
                  <h3 className="parlay-title">{p.title}</h3>
                  {p.detail && <div className="muted" style={{ fontSize: 13 }}>{p.detail}</div>}
                  <div className={`parlay-options ${p.options.length > 3 ? 'many' : ''}`}>
                    {p.options.map(o => {
                      const won = p.status === 'graded' && p.results?.includes(o.key);
                      const lost = p.status === 'graded' && !won;
                      const pickers = players.filter(pl => pick(p.id, pl.id) === o.key);
                      return (
                        <button
                          key={o.key}
                          className={`parlay-opt ${mine === o.key ? 'mine' : ''} ${won ? 'won' : ''} ${lost ? 'lost' : ''}`}
                          disabled={locked || !me}
                          onClick={e => choose(p, o.key, e.currentTarget)}
                        >
                          {o.img && <img src={o.img} alt="" loading="lazy" />}
                          <span className="po-text">
                            <span className="po-label">{o.label}</span>
                            {o.sub && <span className="po-sub">{o.sub}</span>}
                          </span>
                          {won && <span className="po-mark">✅</span>}
                          {pickers.length > 0 && (
                            <span className="po-pickers">
                              {pickers.map(pl => <span key={pl.id} title={pl.name}>{pl.emoji}</span>)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {p.result_note && <div className="parlay-note">{p.status === 'void' ? '🫥 ' : '📣 '}{p.result_note}</div>}
                </div>
              );
            })}
          </div>
        </>
      )}

      {champs.length > 0 && (
        <div className="card panel">
          <b className="display">👑 Parlay champs</b>
          <div className="row wrap" style={{ marginTop: 8 }}>
            {champs.map(c => (
              <span key={c.pl.id} className="chip">
                <Avatar p={c.pl} size="sm" /> {c.pl.name} {'👑'.repeat(Math.min(c.n, 6))}
                {c.n > 6 && `×${c.n}`}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
