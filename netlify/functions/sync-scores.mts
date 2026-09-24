import type { Config } from '@netlify/functions';
import { syncScores } from './lib/sync';

// Runs every minute. Cheap when nothing is live: one DB query and done.
export default async () => {
  const full = new Date().getUTCMinutes() % 20 === 0; // refresh upcoming lines/kickoffs every 20 min
  const res = await syncScores({ full });
  console.log('sync-scores', full ? 'full' : 'live', res);
};

export const config: Config = { schedule: '* * * * *' };
