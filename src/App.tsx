import { useMemo, useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { Avatar } from './components/Avatar';
import { TAGLINES } from './components/fun';
import { useToast } from './components/Toast';
import { useLeague } from './lib/league';
import { supabase } from './lib/supabase';
import { AdminPage } from './pages/Admin';
import { BoardPage } from './pages/Board';
import { LoginPage } from './pages/Login';
import { PicksPage } from './pages/Picks';
import { RulesPage } from './pages/Rules';
import { StandingsPage } from './pages/Standings';

export default function App() {
  const { ready, error, me, session } = useLeague();
  const tagline = useMemo(() => TAGLINES[Math.floor(Math.random() * TAGLINES.length)], []);

  return (
    <div className="app">
      <header className="masthead">
        <Link to="/" className="logo-block wiggle">
          <h1>PICK'EMS</h1>
          <div className="tagline">{tagline}</div>
        </Link>
        <nav className="nav">
          <NavLink to="/" end><span className="ico">🏈</span> <span className="lbl">Picks</span></NavLink>
          <NavLink to="/board"><span className="ico">📋</span> <span className="lbl">Board</span></NavLink>
          <NavLink to="/standings"><span className="ico">🏆</span> <span className="lbl">Standings</span></NavLink>
          <NavLink to="/rules"><span className="ico">📜</span> <span className="lbl">Rules</span></NavLink>
          {me?.is_admin && <NavLink to="/admin"><span className="ico">🛠️</span> <span className="lbl">Admin</span></NavLink>}
        </nav>
        {me ? <MeChip /> : !session ? <Link className="btn primary" to="/login">Log in</Link> : <Link className="btn yellow" to="/login">Claim player</Link>}
      </header>

      {error && <div className="card panel" style={{ marginBottom: 16, background: 'var(--loss-bg)' }}>💥 {error}</div>}

      {!ready ? (
        <div className="empty" style={{ color: 'white' }}>
          <div className="spinner">🏈</div>
          <p className="display">Warming up…</p>
        </div>
      ) : (
        <Routes>
          <Route path="/" element={<PicksPage />} />
          <Route path="/board" element={<BoardPage />} />
          <Route path="/standings" element={<StandingsPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<div className="card empty"><div className="big">🤷</div><p>Fumble. That page doesn't exist.</p></div>} />
        </Routes>
      )}
      <div className="footer-note">Lines & scores via ESPN · for entertainment, not financial planning 🙃</div>
    </div>
  );
}

function MeChip() {
  const { me, reload } = useLeague();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  if (!me) return null;
  const upd = async (patch: Record<string, string>) => {
    const { error } = await supabase.from('players').update(patch).eq('id', me.id);
    if (error) toast(error.message, true);
    else reload();
  };
  return (
    <div style={{ position: 'relative' }}>
      <button className="me-chip" onClick={() => setOpen(o => !o)}>
        <Avatar p={me} size="sm" /> {me.name}
      </button>
      {open && (
        <div className="card panel" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 60, width: 240, display: 'grid', gap: 10 }}>
          <label className="field">
            Your emoji
            <input className="input" defaultValue={me.emoji} onBlur={e => e.target.value && e.target.value !== me.emoji && upd({ emoji: e.target.value })} />
          </label>
          <label className="field">
            Your color
            <input type="color" defaultValue={me.color} onChange={e => upd({ color: e.target.value })} />
          </label>
          <button className="btn" onClick={() => supabase.auth.signOut().then(() => setOpen(false))}>👋 Log out</button>
        </div>
      )}
    </div>
  );
}
