import { generateParlayWeek, gradeParlay, buildSlate, oddsLog } from './lib/parlay';
import { admin } from './lib/sync';

// On demand: build this week's slate if it's missing, then grade. Building can spend Odds API
// credits, so callers must be a logged-in admin (Bearer token) or present the Odds API key.
//   ?dry=1  build a slate and return it without saving (for checking lines)
async function allowed(req: Request) {
  const key = process.env.ODDS_API_KEY;
  if (key && req.headers.get('x-parlay-key') === key) return true;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const sb = admin();
  const { data } = await sb.auth.getUser(token);
  if (!data.user) return false;
  const { data: p } = await sb.from('players').select('is_admin').eq('user_id', data.user.id).maybeSingle();
  return !!p?.is_admin;
}

export default async (req: Request) => {
  try {
    if (!(await allowed(req))) return Response.json({ error: 'Admins only' }, { status: 401 });
    if (new URL(req.url).searchParams.get('dry')) {
      const { wk, props, reason } = await buildSlate();
      return Response.json({ week: wk.week, reason, odds: oddsLog, props });
    }
    const built = await generateParlayWeek();
    const graded = await gradeParlay();
    return Response.json({ built, graded, odds: oddsLog });
  } catch (e: any) {
    return Response.json({ error: e.message ?? String(e), odds: oddsLog }, { status: 500 });
  }
};
