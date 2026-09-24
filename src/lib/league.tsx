import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchAll, supabase, supabaseConfigured } from './supabase';
import type { Game, Phase, Pick, Player, Team, Week } from './types';

interface LeagueState {
  ready: boolean;
  error: string | null;
  session: Session | null;
  me: Player | null;
  players: Player[];
  teams: Map<string, Team>;
  weeks: Week[];
  phases: Phase[];
  phaseWeeks: { phase_id: number; week_id: number }[];
  games: Game[];
  picks: Pick[];
  reload: () => Promise<void>;
  /** Upsert (or clear) a pick. Defaults to me; admins may pass any player. Throws a friendly message on failure. */
  savePick: (gameId: number, patch: Partial<Pick>, playerId?: string) => Promise<void>;
  upsertLocalGame: (g: Game) => void;
}

const Ctx = createContext<LeagueState | null>(null);

export function useLeague() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLeague outside provider');
  return v;
}

export function LeagueProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teamList, setTeamList] = useState<Team[]>([]);
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [phaseWeeks, setPhaseWeeks] = useState<{ phase_id: number; week_id: number }[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const picksRef = useRef(picks);
  picksRef.current = picks;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const loadPicks = useCallback(async () => setPicks(await fetchAll<Pick>('picks')), []);

  const reload = useCallback(async () => {
    if (!supabaseConfigured) {
      setError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      setReady(true);
      return;
    }
    try {
      const [p, t, w, ph, pw, g, pk] = await Promise.all([
        fetchAll<Player>('players', 'sort'),
        fetchAll<Team>('teams'),
        fetchAll<Week>('weeks'),
        fetchAll<Phase>('phases', 'sort'),
        supabase.from('phase_weeks').select('*').then(r => (r.data ?? []) as { phase_id: number; week_id: number }[]),
        fetchAll<Game>('games'),
        fetchAll<Pick>('picks'),
      ]);
      setPlayers(p);
      setTeamList(t);
      setWeeks(w.sort((a, b) => a.season - b.season || a.number - b.number));
      setPhases(ph);
      setPhaseWeeks(pw);
      setGames(g);
      setPicks(pk);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setReady(true);
    }
  }, []);

  // Reload whenever the logged-in user changes (visibility of drafts/picks depends on it).
  useEffect(() => {
    reload();
  }, [reload, session?.user.id]);

  // Live updates: scores stream in via the games table; picks as people make them.
  useEffect(() => {
    if (!supabaseConfigured) return;
    const ch = supabase
      .channel('league')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, payload => {
        if (payload.eventType === 'DELETE') {
          setGames(gs => gs.filter(g => g.id !== (payload.old as Game).id));
          return;
        }
        const g = payload.new as Game;
        setGames(gs => {
          const prev = gs.find(x => x.id === g.id);
          return prev ? gs.map(x => (x.id === g.id ? g : x)) : [...gs, g];
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'picks' }, payload => {
        if (payload.eventType === 'DELETE') {
          setPicks(ps => ps.filter(p => p.id !== (payload.old as Pick).id));
          return;
        }
        const p = payload.new as Pick;
        setPicks(ps => (ps.some(x => x.id === p.id) ? ps.map(x => (x.id === p.id ? p : x)) : [...ps, p]));
      })
      .subscribe();
    // Safety net in case a realtime message is missed.
    const t = setInterval(loadPicks, 120_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, [loadPicks]);

  const me = useMemo(() => players.find(p => p.user_id && p.user_id === session?.user.id) ?? null, [players, session]);
  const teams = useMemo(() => new Map(teamList.map(t => [t.id, t])), [teamList]);

  const savePick = useCallback(
    async (gameId: number, patch: Partial<Pick>, playerId?: string) => {
      if (!me) throw new Error('Log in and claim a player first');
      const pid = playerId ?? me.id;
      if (pid !== me.id && !me.is_admin) throw new Error('Only admins can pick for other people');
      const tempId = -(gameId * 1000 + (pid.charCodeAt(0) + pid.charCodeAt(1)));
      const existing = picksRef.current.find(p => p.game_id === gameId && p.player_id === pid);
      const next = {
        game_id: gameId,
        player_id: pid,
        pick_team_id: existing?.pick_team_id ?? null,
        is_dd: existing?.is_dd ?? false,
        score_away: existing?.score_away ?? null,
        score_home: existing?.score_home ?? null,
        ...patch,
      };
      const same = (p: Pick) => p.game_id === gameId && p.player_id === pid;
      // optimistic
      setPicks(ps => (existing ? ps.map(p => (same(p) ? { ...p, ...next } : p)) : [...ps, { id: tempId, ...next } as Pick]));
      picksRef.current = existing
        ? picksRef.current.map(p => (same(p) ? { ...p, ...next } : p))
        : [...picksRef.current, { id: tempId, ...next } as Pick];
      const { data, error } = await supabase.from('picks').upsert(next, { onConflict: 'game_id,player_id' }).select().single();
      if (error) {
        setPicks(ps => (existing ? ps.map(p => (same(p) ? existing : p)) : ps.filter(p => !same(p))));
        picksRef.current = existing ? picksRef.current.map(p => (same(p) ? existing : p)) : picksRef.current.filter(p => !same(p));
        throw new Error(friendly(error.message));
      }
      setPicks(ps => ps.map(p => (same(p) ? (data as Pick) : p)));
    },
    [me],
  );

  const upsertLocalGame = useCallback((g: Game) => {
    setGames(gs => (gs.some(x => x.id === g.id) ? gs.map(x => (x.id === g.id ? g : x)) : [...gs, g]));
  }, []);

  const value: LeagueState = {
    ready,
    error,
    session,
    me,
    players,
    teams,
    weeks,
    phases,
    phaseWeeks,
    games,
    picks,
    reload,
    savePick,
    upsertLocalGame,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function friendly(msg: string) {
  if (msg.includes('row-level security')) return 'Too late! That game is locked. 🔒';
  return msg;
}
