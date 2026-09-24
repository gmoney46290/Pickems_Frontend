import type { Player } from '../lib/types';

export function Avatar({ p, size }: { p: Player; size?: 'sm' }) {
  return (
    <span className={`avatar ${size ?? ''}`} style={{ ['--c' as any]: p.color }} title={p.name}>
      {p.emoji}
    </span>
  );
}
