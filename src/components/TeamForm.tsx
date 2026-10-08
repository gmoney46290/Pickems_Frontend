import { useEffect, useState } from 'react';
import { fetchRecent, type RecentGame } from '../lib/espn';
import type { Game, Team } from '../lib/types';

/** Record plus the last few results going into this game. */
export function TeamForm({ team, game, season, count = 3 }: { team: Team; game: Game; season: number; count?: number }) {
  const [recent, setRecent] = useState<RecentGame[] | null>(null);
  const record = team.id === game.away_team_id ? game.away_record : game.home_record;

  useEffect(() => {
    let dead = false;
    setRecent(null);
    fetchRecent(team.league, team.espn_id, season, game.kickoff).then(r => !dead && setRecent(r.slice(0, count)));
    return () => {
      dead = true;
    };
  }, [team.id, game.kickoff, season, count]);

  return (
    <div className="form-card">
      <div className="form-head">
        {team.logo && <img src={team.logo} alt="" />}
        <b>{team.abbr}</b>
        {record && <span className="chip">{record}</span>}
      </div>
      {recent == null ? (
        <div className="muted" style={{ fontSize: 12 }}>Checking the tape…</div>
      ) : recent.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>No games yet</div>
      ) : (
        recent.map(r => (
          <div key={r.date} className="form-row">
            <span className={`form-res ${r.result}`}>{r.result}</span>
            <span className="muted">{r.home ? 'vs' : '@'}</span>
            {r.oppLogo && <img src={r.oppLogo} alt="" />}
            <b>{r.opp}</b>
            <span className="grow" />
            <span style={{ fontWeight: 700 }}>{r.us}-{r.them}</span>
          </div>
        ))
      )}
    </div>
  );
}
