import type { Config } from '@netlify/functions';
import { generateParlayWeek, gradeParlay } from './lib/parlay';

// Every 10 minutes: grade props whose games are final. Also builds the week's slate if the
// Tuesday job missed, but only from Tuesday 14:00 UTC through Thursday so it never jumps ahead.
export default async () => {
  const now = new Date();
  const day = now.getUTCDay(), hour = now.getUTCHours();
  if ((day === 2 && hour >= 14) || day === 3 || day === 4) console.log('parlay build check', await generateParlayWeek());
  console.log('parlay-grade', await gradeParlay());
};

export const config: Config = { schedule: '*/10 * * * *' };
