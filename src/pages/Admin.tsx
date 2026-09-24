import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { weekTitle } from '../components/WeekTabs';
import { currentWeeks, fetchSlate, teamRow, type EspnGame } from '../lib/espn';
import { useLeague } from '../lib/league';
import { fmtSpread, weekLocked } from '../lib/scoring';
import { supabase } from '../lib/supabase';
import type { Game, League, Week } from '../lib/types';

export function AdminPage() {
  const { me, ready } = useLeague();
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  if (ready && !me?.is_admin) return <Navigate to="/" replace />;
  return (
    <div className="admin-grid">
      <div className="row wrap">
        <div className="sticker" style={{ background: 'var(--ink)', color: 'var(--yellow)', fontSize: 22 }}>🛠️ Commish Corner</div>
        <SyncButton />
      </div>
      {editing != null ? (
        <WeekEditor key={String(editing)} weekId={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
      ) : (
        <WeeksList onEdit={setEditing} />
      )}
      <PhasesPanel />
      <PlayersPanel />
      <JoinCodePanel />
    </div>
  );
}

function SyncButton() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn yellow"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await fetch('/.netlify/functions/sync-now', { method: 'POST' });
          const j = await r.json().catch(() => ({}));
          toast(r.ok ? `Synced ${j.updated ?? 0} games from ESPN` : `Sync failed: ${j.error ?? r.status}`, !r.ok);
        } catch (e: any) {
          toast(`Sync failed: ${e.message}`, true);
        }
        setBusy(false);
      }}
    >
      🔄 {busy ? 'Syncing…' : 'Sync scores now'}
    </button>
  );
}

// ---------------------------------------------------------------- weeks list

function WeeksList({ onEdit }: { onEdit: (id: number | 'new') => void }) {
  const { weeks, games, picks, reload } = useLeague();
  const toast = useToast();
  const setStatus = async (w: Week, status: Week['status']) => {
    const { error } = await supabase.from('weeks').update({ status }).eq('id', w.id);
    if (error) return toast(error.message, true);
    toast(status === 'open' ? `${weekTitle(w)} is open for picks! 📣` : `${weekTitle(w)} → ${status}`);
    reload();
  };
  const setLock = async (w: Week, locks_at: string | null) => {
    const { error } = await supabase.from('weeks').update({ locks_at }).eq('id', w.id);
    if (error) return toast(error.message, true);
    toast(!locks_at ? `${weekTitle(w)} unlocked 🔓` : new Date(locks_at).getTime() <= Date.now() ? `${weekTitle(w)} picks locked 🔒` : `${weekTitle(w)} locks ${new Date(locks_at).toLocaleString()}`);
    reload();
  };
  // datetime-local wants local time without zone
  const toLocalInput = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  const del = async (w: Week) => {
    const n = picks.filter(p => games.some(g => g.id === p.game_id && g.week_id === w.id)).length;
    if (!confirm(`Delete ${weekTitle(w)}${n ? ` and its ${n} picks` : ''}? No undo.`)) return;
    const { error } = await supabase.from('weeks').delete().eq('id', w.id);
    if (error) return toast(error.message, true);
    reload();
  };
  return (
    <div className="card panel">
      <div className="row" style={{ marginBottom: 10 }}>
        <h3 className="display grow" style={{ margin: 0 }}>🗓️ Weeks</h3>
        <button className="btn primary" onClick={() => onEdit('new')}>➕ New week</button>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Week</th>
            <th className="hide-sm">NFL / CFB wk</th>
            <th>Games</th>
            <th>Status</th>
            <th>Picks lock</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {[...weeks].reverse().map(w => {
            const gs = games.filter(g => g.week_id === w.id);
            return (
              <tr key={w.id}>
                <td style={{ fontWeight: 700 }}>{weekTitle(w)} <span className="muted">· {w.season}</span></td>
                <td className="hide-sm">{w.nfl_week ?? '—'} / {w.cfb_week ?? '—'}</td>
                <td>{gs.length} <span className="muted">({gs.filter(g => g.status === 'final').length} final)</span></td>
                <td>
                  <select className="input" value={w.status} onChange={e => setStatus(w, e.target.value as Week['status'])}>
                    <option value="draft">✏️ draft</option>
                    <option value="open">📣 open</option>
                    <option value="final">📦 final</option>
                  </select>
                </td>
                <td>
                  {weekLocked(w) ? (
                    <span className="row">
                      <span className="chip dark">🔒 locked</span>
                      <button className="btn small" onClick={() => setLock(w, null)}>Unlock</button>
                    </span>
                  ) : (
                    <span className="row wrap">
                      <button className="btn small dark" onClick={() => setLock(w, new Date().toISOString())}>🔒 Lock now</button>
                      <input
                        className="input"
                        type="datetime-local"
                        title="Schedule a lock time"
                        value={toLocalInput(w.locks_at)}
                        onChange={e => setLock(w, e.target.value ? new Date(e.target.value).toISOString() : null)}
                      />
                    </span>
                  )}
                </td>
                <td className="row" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn small" onClick={() => onEdit(w.id)}>Edit</button>
                  <button className="btn small" onClick={() => del(w)}>🗑️</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- week editor

interface Sel {
  e: EspnGame;
  favHome: boolean;
  pts: string; // absolute points, e.g. "7.5"
}

const spreadFrom = (s: Sel) => {
  const p = Math.abs(parseFloat(s.pts) || 0);
  return s.favHome ? -p : p;
};

function WeekEditor({ weekId, onDone }: { weekId: number | null; onDone: () => void }) {
  const { weeks, games, picks, reload, teams } = useLeague();
  const toast = useToast();
  const existing = weeks.find(w => w.id === weekId);
  const existingGames = useMemo(() => games.filter(g => g.week_id === weekId), [games, weekId]);

  const [season, setSeason] = useState(existing?.season ?? new Date().getFullYear());
  const [number, setNumber] = useState(existing?.number ?? (weeks.filter(w => w.season === new Date().getFullYear()).at(-1)?.number ?? 0) + 1);
  const [label, setLabel] = useState(existing?.label ?? '');
  const [nflWeek, setNflWeek] = useState<number | ''>(existing?.nfl_week ?? '');
  const [cfbWeek, setCfbWeek] = useState<number | ''>(existing?.cfb_week ?? '');
  const [scorePicks, setScorePicks] = useState(existing?.score_picks ?? 3);
  const [slate, setSlate] = useState<Record<League, EspnGame[]>>({ nfl: [], cfb: [] });
  const [sel, setSel] = useState<Map<string, Sel>>(new Map());
  const [filter, setFilter] = useState('');
  const [top25, setTop25] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing) return;
    currentWeeks().then(c => {
      setSeason(c.season);
      setNflWeek(c.nfl);
      setCfbWeek(c.cfb);
    }).catch(() => {});
  }, []); // eslint-disable-line

  const load = async () => {
    setLoading(true);
    try {
      const [nfl, cfb] = await Promise.all([
        nflWeek ? fetchSlate('nfl', Number(nflWeek), season) : Promise.resolve([]),
        cfbWeek ? fetchSlate('cfb', Number(cfbWeek), season) : Promise.resolve([]),
      ]);
      setSlate({ nfl, cfb });
      // Pre-select games already in this week, keeping our (possibly tweaked) lines.
      const m = new Map<string, Sel>();
      for (const g of existingGames) {
        const e = [...nfl, ...cfb].find(x => x.eventId === g.espn_event_id);
        if (e) m.set(e.eventId, { e, favHome: Number(g.home_spread) <= 0, pts: String(Math.abs(Number(g.home_spread))) });
      }
      setSel(m);
    } catch (e: any) {
      toast(`ESPN said no: ${e.message}`, true);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (existing && (existing.nfl_week || existing.cfb_week)) load();
  }, []); // eslint-disable-line

  const toggle = (e: EspnGame) => {
    setSel(m => {
      const n = new Map(m);
      if (n.has(e.eventId)) n.delete(e.eventId);
      else n.set(e.eventId, { e, favHome: (e.homeSpread ?? 0) <= 0, pts: e.homeSpread != null ? String(Math.abs(e.homeSpread)) : '' });
      return n;
    });
  };
  const patchSel = (id: string, patch: Partial<Sel>) => setSel(m => new Map(m).set(id, { ...m.get(id)!, ...patch }));

  const save = async () => {
    if (!sel.size) return toast('Pick at least one game', true);
    const missing = [...sel.values()].filter(s => s.pts === '');
    if (missing.length && !confirm(`${missing.length} game(s) have no line (will be PK). Continue?`)) return;
    setSaving(true);
    try {
      const chosen = [...sel.values()];
      const teamRows = new Map<string, ReturnType<typeof teamRow>>();
      for (const s of chosen)
        for (const t of [s.e.away, s.e.home]) {
          const row = teamRow(t, s.e.league);
          teamRows.set(row.id, { ...row, legacy_code: teams.get(row.id)?.legacy_code ?? null });
        }
      let { error } = await supabase.from('teams').upsert([...teamRows.values()]);
      if (error) throw error;

      const weekRow = { season, number, label: label.trim() || null, nfl_week: nflWeek || null, cfb_week: cfbWeek || null, score_picks: scorePicks };
      let wid = weekId;
      if (wid) {
        ({ error } = await supabase.from('weeks').update(weekRow).eq('id', wid));
        if (error) throw error;
      } else {
        const r = await supabase.from('weeks').insert({ ...weekRow, status: 'draft' }).select().single();
        if (r.error) throw r.error;
        wid = r.data.id;
      }

      const ordered = [...chosen].sort((a, b) => (a.e.league === b.e.league ? a.e.kickoff.localeCompare(b.e.kickoff) : a.e.league === 'cfb' ? -1 : 1));
      const rows = ordered.map((s, i) => ({
        week_id: wid,
        league: s.e.league,
        espn_event_id: s.e.eventId,
        away_team_id: `${s.e.league}-${s.e.away.id}`,
        home_team_id: `${s.e.league}-${s.e.home.id}`,
        neutral: s.e.neutral,
        kickoff: s.e.kickoff,
        home_spread: spreadFrom(s),
        market_spread: s.e.homeSpread,
        market_total: s.e.overUnder,
        sort: i,
      }));
      ({ error } = await supabase.from('games').upsert(rows, { onConflict: 'week_id,espn_event_id' }));
      if (error) throw error;

      const dropped = existingGames.filter(g => !g.espn_event_id || !sel.has(g.espn_event_id));
      if (dropped.length) {
        const withPicks = dropped.filter(g => picks.some(p => p.game_id === g.id));
        if (!withPicks.length || confirm(`Remove ${dropped.length} game(s) from the week? ${withPicks.length} have picks that will be deleted.`)) {
          ({ error } = await supabase.from('games').delete().in('id', dropped.map(g => g.id)));
          if (error) throw error;
        }
      }
      toast(weekId ? 'Week updated ✅' : 'Week created as a draft. Open it when ready! ✏️');
      await reload();
      onDone();
    } catch (e: any) {
      toast(e.message ?? String(e), true);
    }
    setSaving(false);
  };

  const q = filter.trim().toLowerCase();
  const matches = (e: EspnGame) =>
    !q || [e.away.displayName, e.home.displayName, e.away.abbreviation, e.home.abbreviation].some(s => s.toLowerCase().includes(q));
  const lineChanged = (s: Sel) => s.e.homeSpread != null && spreadFrom(s) !== s.e.homeSpread;
  const weekHasPicks = picks.some(p => existingGames.some(g => g.id === p.game_id));

  const renderSlate = (lg: League) => {
    const list = slate[lg].filter(e => sel.has(e.eventId) || (matches(e) && (lg === 'nfl' || !top25 || e.away.rank || e.home.rank || q)));
    if (!slate[lg].length) return null;
    return (
      <div>
        <div className="section-title" style={{ marginTop: 12 }}>
          {lg === 'nfl' ? '🏟️ Pro' : '🎓 College'} · {[...sel.values()].filter(s => s.e.league === lg).length} picked
        </div>
        <div className="slate">
          {list.map(e => {
            const s = sel.get(e.eventId);
            return (
              <div key={e.eventId} className={`slate-row ${s ? 'sel' : ''}`} style={s ? { gridTemplateColumns: '28px 1fr' } : undefined}>
                <input type="checkbox" checked={!!s} onChange={() => toggle(e)} />
                <div>
                  <div style={{ fontWeight: 700 }}>
                    {e.away.logo && <img src={e.away.logo} alt="" />} {e.away.rank ? `#${e.away.rank} ` : ''}{e.away.shortDisplayName}
                    {e.neutral ? ' vs ' : ' @ '}
                    {e.home.logo && <img src={e.home.logo} alt="" />} {e.home.rank ? `#${e.home.rank} ` : ''}{e.home.shortDisplayName}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {new Date(e.kickoff).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                    {e.broadcast && ` · ${e.broadcast}`} · Vegas: {e.spreadDetails ?? 'no line yet'}
                  </div>
                  {s && (
                    <div className="row wrap" style={{ marginTop: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>Our line:</span>
                      <select className="input" value={s.favHome ? 'home' : 'away'} onChange={ev => patchSel(e.eventId, { favHome: ev.target.value === 'home' })}>
                        <option value="away">{e.away.abbreviation}</option>
                        <option value="home">{e.home.abbreviation}</option>
                      </select>
                      <span>−</span>
                      <input className="input" style={{ width: 80 }} type="number" step="0.5" min="0" value={s.pts} onChange={ev => patchSel(e.eventId, { pts: ev.target.value })} />
                      {lineChanged(s) && <span className="chip yellow">🌶️ tweaked from {fmtSpread(e.homeSpread!)} (home)</span>}
                      {e.homeSpread != null && lineChanged(s) && (
                        <button className="btn small" onClick={() => patchSel(e.eventId, { favHome: e.homeSpread! <= 0, pts: String(Math.abs(e.homeSpread!)) })}>reset</button>
                      )}
                      {[-1, -0.5, 0.5, 1].map(d => (
                        <button key={d} className="btn small" onClick={() => patchSel(e.eventId, { pts: String(Math.max(0, (parseFloat(s.pts) || 0) + d)) })}>
                          {d > 0 ? `+${d}` : d}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {!list.length && <div className="slate-row muted">Nothing matches.</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="card panel">
      <div className="row" style={{ marginBottom: 12 }}>
        <h3 className="display grow" style={{ margin: 0 }}>{existing ? `✏️ Edit ${weekTitle(existing)}` : '➕ New week'}</h3>
        <button className="btn" onClick={onDone}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : '💾 Save week'}</button>
      </div>
      {weekHasPicks && <p className="chip yellow" style={{ marginTop: 0 }}>⚠️ People have picked this week. Changing a line changes how their picks grade.</p>}
      <div className="row wrap" style={{ gap: 12, alignItems: 'end' }}>
        <label className="field">Season<input className="input" type="number" value={season} onChange={e => setSeason(+e.target.value)} style={{ width: 90 }} /></label>
        <label className="field">Our week #<input className="input" type="number" value={number} onChange={e => setNumber(+e.target.value)} style={{ width: 80 }} /></label>
        <label className="field">Label (optional)<input className="input" value={label} onChange={e => setLabel(e.target.value)} placeholder="Rivalry Week 🔥" /></label>
        <label className="field">NFL week<input className="input" type="number" value={nflWeek} onChange={e => setNflWeek(e.target.value ? +e.target.value : '')} style={{ width: 80 }} /></label>
        <label className="field">CFB week<input className="input" type="number" value={cfbWeek} onChange={e => setCfbWeek(e.target.value ? +e.target.value : '')} style={{ width: 80 }} /></label>
        <label className="field">Score calls<input className="input" type="number" value={scorePicks} onChange={e => setScorePicks(+e.target.value)} style={{ width: 80 }} /></label>
        <button className="btn blue" onClick={load} disabled={loading}>{loading ? 'Loading…' : '📡 Load ESPN slate'}</button>
      </div>
      {(slate.nfl.length > 0 || slate.cfb.length > 0) && (
        <div className="row wrap" style={{ marginTop: 12 }}>
          <input className="input grow" placeholder="Search teams…" value={filter} onChange={e => setFilter(e.target.value)} />
          <label className="row" style={{ fontWeight: 700 }}>
            <input type="checkbox" checked={top25} onChange={e => setTop25(e.target.checked)} /> Ranked college games only
          </label>
        </div>
      )}
      {renderSlate('cfb')}
      {renderSlate('nfl')}
      {existing && <ResultsEditor games={existingGames} />}
    </div>
  );
}

/** Manual override for when ESPN is being weird. */
function ResultsEditor({ games }: { games: Game[] }) {
  const { teams, upsertLocalGame } = useLeague();
  const toast = useToast();
  const save = async (g: Game, patch: Partial<Game>) => {
    const { data, error } = await supabase.from('games').update(patch).eq('id', g.id).select().single();
    if (error) return toast(error.message, true);
    upsertLocalGame(data as Game);
  };
  return (
    <>
      <div className="section-title" style={{ marginTop: 16 }}>🧮 Results (manual override)</div>
      <table className="tbl">
        <thead>
          <tr><th>Game</th><th>Our line</th><th>Away</th><th>Home</th><th>Status</th></tr>
        </thead>
        <tbody>
          {[...games].sort((a, b) => a.sort - b.sort).map(g => (
            <tr key={g.id}>
              <td style={{ fontWeight: 700 }}>{teams.get(g.away_team_id)?.abbr} @ {teams.get(g.home_team_id)?.abbr}</td>
              <td>{teams.get(g.home_team_id)?.abbr} {fmtSpread(Number(g.home_spread))}</td>
              <td><input className="input" style={{ width: 64 }} type="number" defaultValue={g.away_score ?? ''} onBlur={e => save(g, { away_score: e.target.value === '' ? null : +e.target.value })} /></td>
              <td><input className="input" style={{ width: 64 }} type="number" defaultValue={g.home_score ?? ''} onBlur={e => save(g, { home_score: e.target.value === '' ? null : +e.target.value })} /></td>
              <td>
                <select className="input" value={g.status} onChange={e => save(g, { status: e.target.value as Game['status'] })}>
                  <option value="scheduled">scheduled</option>
                  <option value="in">live</option>
                  <option value="final">final</option>
                  <option value="canceled">canceled</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ---------------------------------------------------------------- phases

function PhasesPanel() {
  const { phases, phaseWeeks, weeks, reload } = useLeague();
  const toast = useToast();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🏆');
  const add = async () => {
    if (!name.trim()) return;
    const { error } = await supabase.from('phases').insert({ name: name.trim(), emoji, season: weeks.at(-1)?.season ?? new Date().getFullYear(), sort: phases.length });
    if (error) return toast(error.message, true);
    setName('');
    reload();
  };
  const toggle = async (phaseId: number, weekId: number, on: boolean) => {
    const { error } = on
      ? await supabase.from('phase_weeks').insert({ phase_id: phaseId, week_id: weekId })
      : await supabase.from('phase_weeks').delete().match({ phase_id: phaseId, week_id: weekId });
    if (error) return toast(error.message, true);
    reload();
  };
  const del = async (id: number) => {
    if (!confirm('Delete this phase? (weeks and picks are kept)')) return;
    await supabase.from('phases').delete().eq('id', id);
    reload();
  };
  return (
    <div className="card panel">
      <h3 className="display" style={{ marginTop: 0 }}>🧩 Phases (mini-seasons)</h3>
      <p className="muted" style={{ marginTop: 0 }}>Group weeks into phases. Each phase gets its own standings tab.</p>
      <table className="tbl">
        <thead>
          <tr>
            <th>Phase</th>
            {weeks.map(w => <th key={w.id} className="center">{weekTitle(w).replace('Week ', 'W')}</th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {phases.map(p => (
            <tr key={p.id}>
              <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{p.emoji} {p.name}</td>
              {weeks.map(w => {
                const on = phaseWeeks.some(pw => pw.phase_id === p.id && pw.week_id === w.id);
                return <td key={w.id} className="center"><input type="checkbox" checked={on} onChange={() => toggle(p.id, w.id, !on)} /></td>;
              })}
              <td><button className="btn small" onClick={() => del(p.id)}>🗑️</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 10 }}>
        <input className="input" style={{ width: 60, textAlign: 'center' }} value={emoji} onChange={e => setEmoji(e.target.value)} aria-label="emoji" />
        <input className="input grow" placeholder="e.g. Phase 1: Early Season Chaos" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <button className="btn primary" onClick={add}>Add phase</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- players

function PlayersPanel() {
  const { players, reload, me } = useLeague();
  const toast = useToast();
  const [name, setName] = useState('');
  const upd = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await supabase.from('players').update(patch).eq('id', id);
    if (error) return toast(error.message, true);
    reload();
  };
  const add = async () => {
    if (!name.trim()) return;
    const { error } = await supabase.from('players').insert({ name: name.trim(), sort: players.length + 1 });
    if (error) return toast(error.message, true);
    setName('');
    reload();
  };
  return (
    <div className="card panel">
      <h3 className="display" style={{ marginTop: 0 }}>👥 Players</h3>
      <table className="tbl">
        <thead>
          <tr><th>Emoji</th><th>Name</th><th>Color</th><th>Account</th><th>Admin</th></tr>
        </thead>
        <tbody>
          {players.map(p => (
            <tr key={p.id}>
              <td><input className="input" style={{ width: 52, textAlign: 'center' }} defaultValue={p.emoji} onBlur={e => e.target.value !== p.emoji && upd(p.id, { emoji: e.target.value })} /></td>
              <td><input className="input" defaultValue={p.name} onBlur={e => e.target.value !== p.name && upd(p.id, { name: e.target.value })} /></td>
              <td><input type="color" defaultValue={p.color} onBlur={e => e.target.value !== p.color && upd(p.id, { color: e.target.value })} /></td>
              <td>
                {p.user_id ? (
                  <button className="btn small" disabled={p.id === me?.id} onClick={() => confirm(`Unlink ${p.name}'s login? They can re-claim with the join code.`) && upd(p.id, { user_id: null })}>
                    ✅ claimed · unlink
                  </button>
                ) : (
                  <span className="muted">unclaimed</span>
                )}
              </td>
              <td><input type="checkbox" checked={p.is_admin} disabled={p.id === me?.id} onChange={e => upd(p.id, { is_admin: e.target.checked })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 10 }}>
        <input className="input grow" placeholder="New player name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <button className="btn primary" onClick={add}>Add player</button>
      </div>
    </div>
  );
}

function JoinCodePanel() {
  const toast = useToast();
  const [code, setCode] = useState('');
  useEffect(() => {
    supabase.rpc('get_join_code').then(({ data }) => setCode(data ?? ''));
  }, []);
  return (
    <div className="card panel">
      <h3 className="display" style={{ marginTop: 0 }}>🔐 Join code</h3>
      <p className="muted" style={{ marginTop: 0 }}>People need this to claim a player after signing up. Drop it in the group chat.</p>
      <div className="row">
        <input className="input grow" value={code} onChange={e => setCode(e.target.value)} />
        <button
          className="btn primary"
          onClick={async () => {
            const { error } = await supabase.rpc('set_join_code', { p_code: code });
            toast(error ? error.message : 'Join code updated', !!error);
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
