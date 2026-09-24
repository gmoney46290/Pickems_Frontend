import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { useToast } from '../components/Toast';
import { fireParty } from '../components/fun';
import { useLeague } from '../lib/league';
import { supabase } from '../lib/supabase';

export function LoginPage() {
  const { session, me, players, reload } = useLeague();
  const toast = useToast();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [choice, setChoice] = useState<string>('');
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('🏈');

  if (session && me) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } =
      mode === 'in'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) return toast(error.message, true);
    if (mode === 'up') toast('Account created! Now claim your player 👇');
  };

  const claim = async () => {
    setBusy(true);
    const { error } =
      choice === 'new'
        ? await supabase.rpc('join_as_new_player', { p_name: newName, p_emoji: newEmoji, p_code: code })
        : await supabase.rpc('claim_player', { p_player: choice, p_code: code });
    setBusy(false);
    if (error) return toast(error.message, true);
    await reload();
    fireParty();
    toast('Welcome to the league 🎉');
  };

  if (!session) {
    return (
      <form className="card auth-box" onSubmit={submit}>
        <div className="sticker" style={{ background: 'var(--pink)', color: 'white', fontSize: 22, justifySelf: 'start' }}>
          {mode === 'in' ? '🔑 Log in' : '✍️ Sign up'}
        </div>
        <label className="field">
          Email
          <input className="input" type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label className="field">
          Password
          <input className="input" type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />
        </label>
        <button className="btn primary" disabled={busy}>{busy ? '…' : mode === 'in' ? 'Let me in' : 'Create account'}</button>
        <button type="button" className="btn small" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
          {mode === 'in' ? 'First time? Sign up' : 'Already have an account? Log in'}
        </button>
      </form>
    );
  }

  const open = players.filter(p => !p.user_id);
  return (
    <div className="card auth-box" style={{ maxWidth: 560 }}>
      <div className="sticker" style={{ background: 'var(--yellow)', fontSize: 20, justifySelf: 'start' }}>🙋 Who are you?</div>
      <p className="muted" style={{ margin: 0 }}>Pick your player so your history comes with you. Ask the commish for the join code.</p>
      <div className="row wrap">
        {open.map(p => (
          <button key={p.id} className={`btn ${choice === p.id ? 'primary' : ''}`} onClick={() => setChoice(p.id)}>
            <Avatar p={p} size="sm" /> {p.name}
          </button>
        ))}
        <button className={`btn ${choice === 'new' ? 'primary' : ''}`} onClick={() => setChoice('new')}>➕ I'm new</button>
      </div>
      {choice === 'new' && (
        <div className="row">
          <input className="input" style={{ width: 64, textAlign: 'center' }} value={newEmoji} onChange={e => setNewEmoji(e.target.value)} aria-label="emoji" />
          <input className="input grow" placeholder="Display name" value={newName} onChange={e => setNewName(e.target.value)} />
        </div>
      )}
      <label className="field">
        Join code
        <input className="input" value={code} onChange={e => setCode(e.target.value)} placeholder="ask the group chat" />
      </label>
      <button className="btn primary" disabled={!choice || !code || busy || (choice === 'new' && !newName.trim())} onClick={claim}>
        That's me →
      </button>
      <button className="btn small" onClick={() => supabase.auth.signOut()}>Log out</button>
    </div>
  );
}
