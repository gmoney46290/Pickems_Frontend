import type { Game, Week } from '../lib/types';

export function weekTitle(w: Week) {
  return w.label?.trim() || `Week ${w.number}`;
}

export function WeekTabs({ weeks, games, value, onChange }: { weeks: Week[]; games: Game[]; value: number | null; onChange: (id: number) => void }) {
  return (
    <div className="week-tabs">
      {weeks.map(w => {
        const live = games.some(g => g.week_id === w.id && g.status === 'in');
        return (
          <button key={w.id} className={`week-tab ${value === w.id ? 'active' : ''}`} onClick={() => onChange(w.id)}>
            {weekTitle(w)}
            {w.status === 'draft' && ' ✏️'}
            {live && <span className="dot" />}
          </button>
        );
      })}
    </div>
  );
}

/** The week people most likely care about: live > first open week with games left > latest. */
export function defaultWeek(weeks: Week[], games: Game[]): number | null {
  const live = weeks.find(w => games.some(g => g.week_id === w.id && g.status === 'in'));
  if (live) return live.id;
  const open = weeks.filter(w => w.status === 'open' && games.some(g => g.week_id === w.id && g.status !== 'final'));
  if (open.length) return open[0].id;
  const visible = weeks.filter(w => w.status !== 'draft');
  return (visible.at(-1) ?? weeks.at(-1))?.id ?? null;
}
