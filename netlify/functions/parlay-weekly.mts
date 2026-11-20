import type { Config } from '@netlify/functions';
import { generateParlayWeek } from './lib/parlay';

// Tuesday 14:00 UTC (6am PT / 9am ET): build the new week's Parlay Party slate.
export default async () => {
  console.log('parlay-weekly', await generateParlayWeek());
};

export const config: Config = { schedule: '0 14 * * 2' };
