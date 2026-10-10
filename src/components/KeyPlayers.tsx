import { useEffect, useState } from 'react';
import { fetchKeyPlayers, type KeyPlayer } from '../lib/espn';
import type { Game, Team } from '../lib/types';

const ICON: Record<string, string> = { Passing: '🎯', Rushing: '🏃', Receiving: '🙌' };

/** Headshots + season stat lines for each team's top passer, rusher and receiver. */
export function KeyPlayers({ game, away, home, season }: { game: Game; away: Team; home: Team; season: number }) {
  const [data, setData] = useState<Map<string, KeyPlayer[]> | null>(null);

  useEffect(() => {
    let dead = false;
    setData(null);
    Promise.all([away, home].map(t => fetchKeyPlayers(t.league, t.espn_id, season).then(l => [t.espn_id, l] as const))).then(
      pairs => !dead && setData(new Map(pairs)),
    );
    return () => {
      dead = true;
    };
  }, [away.id, home.id, season]);

  const label = 'Key players (season stats)';

  return (
    <div>
      <div className="center display" style={{ fontSize: 13, margin: '6px 0' }}>⭐ {label}</div>
      <div className="room-form">
        {[away, home].map(t => {
          const list = data?.get(t.espn_id);
          return (
            <div key={t.id} className="form-card">
              <div className="form-head">
                {t.logo && <img src={t.logo} alt="" />}
                <b>{t.abbr}</b>
              </div>
              {data == null ? (
                <div className="muted" style={{ fontSize: 12 }}>Scouting…</div>
              ) : !list?.length ? (
                <div className="muted" style={{ fontSize: 12 }}>No stats yet</div>
              ) : (
                list.map(p => (
                  <div key={p.category} className="key-player">
                    {p.headshot ? <img src={p.headshot} alt="" loading="lazy" /> : <span className="kp-blank">{ICON[p.category]}</span>}
                    <div style={{ minWidth: 0 }}>
                      <div className="kp-name">
                        {p.name} <span className="muted">{p.position}{p.jersey ? ` #${p.jersey}` : ''}</span>
                      </div>
                      <div className="kp-stat">
                        {ICON[p.category]} {p.stat}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
