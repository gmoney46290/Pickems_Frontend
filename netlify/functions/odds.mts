import { admin } from './lib/sync';

// Multi-book spreads from The Odds API (https://the-odds-api.com), cached in odds_cache.
// Optional: without ODDS_API_KEY this is a no-op and the app just shows ESPN/DraftKings.
const SPORT = { nfl: 'americanfootball_nfl', cfb: 'americanfootball_ncaaf' } as const;
const FRESH_MS = 45 * 60 * 1000;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export default async (req: Request) => {
  const key = process.env.ODDS_API_KEY;
  if (!key) return Response.json({ skipped: 'no ODDS_API_KEY' });
  const weekId = Number(new URL(req.url).searchParams.get('week'));
  if (!weekId) return Response.json({ error: 'week required' }, { status: 400 });

  const sb = admin();
  const { data: games } = await sb
    .from('games')
    .select('id,league,kickoff,status,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name)')
    .eq('week_id', weekId)
    .eq('status', 'scheduled');
  if (!games?.length) return Response.json({ skipped: 'no upcoming games' });

  const { data: cached } = await sb.from('odds_cache').select('game_id,updated_at').in('game_id', games.map(g => g.id));
  // The '_refresh' marker row records when we last asked, even if no books matched.
  const newest = Math.max(0, ...(cached ?? []).map(c => new Date(c.updated_at).getTime()));
  if (Date.now() - newest < FRESH_MS) return Response.json({ cached: true });
  // Claim the refresh so concurrent viewers don't all spend API credits.
  await sb.from('odds_cache').upsert(games.map(g => ({ game_id: g.id, book: '_refresh', updated_at: new Date().toISOString() })));

  const rows: any[] = [];
  for (const league of ['nfl', 'cfb'] as const) {
    const gs = games.filter(g => g.league === league);
    if (!gs.length) continue;
    const r = await fetch(`https://api.the-odds-api.com/v4/sports/${SPORT[league]}/odds?regions=us&markets=spreads,totals&oddsFormat=american&apiKey=${key}`);
    if (!r.ok) {
      console.warn('odds api', r.status, await r.text());
      continue;
    }
    const events: any[] = await r.json();
    for (const g of gs as any[]) {
      const home = norm(g.home.name), away = norm(g.away.name);
      const ev = events.find(
        e => Math.abs(new Date(e.commence_time).getTime() - new Date(g.kickoff).getTime()) < 864e5 &&
          ((norm(e.home_team) === home && norm(e.away_team) === away) || (norm(e.home_team) === away && norm(e.away_team) === home)),
      );
      if (!ev) continue;
      for (const b of ev.bookmakers ?? []) {
        const sp = b.markets?.find((m: any) => m.key === 'spreads');
        const tot = b.markets?.find((m: any) => m.key === 'totals');
        const h = sp?.outcomes?.find((o: any) => norm(o.name) === home);
        const a = sp?.outcomes?.find((o: any) => norm(o.name) === away);
        rows.push({
          game_id: g.id,
          book: b.title,
          home_spread: h?.point ?? (a?.point != null ? -a.point : null),
          home_price: h?.price ?? null,
          away_price: a?.price ?? null,
          total: tot?.outcomes?.[0]?.point ?? null,
          updated_at: new Date().toISOString(),
        });
      }
    }
  }
  if (rows.length) await sb.from('odds_cache').upsert(rows);
  return Response.json({ updated: rows.length });
};
