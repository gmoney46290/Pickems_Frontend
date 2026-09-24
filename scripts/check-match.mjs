import fs from 'fs';
import { LEGACY_WEEKS, fetchSlate, matchEvent } from './legacy-codes.mjs';
const data = JSON.parse(fs.readFileSync(new URL('./sheet-data.json', import.meta.url)));
for (const w of LEGACY_WEEKS) {
  const nfl = await fetchSlate('nfl', w.nflWeek), cfb = await fetchSlate('cfb', w.cfbWeek);
  for (const g of data.games.filter(g => g.row >= w.firstRow && g.row <= w.lastRow)) {
    const e = matchEvent(nfl, g.away, g.home) ?? matchEvent(cfb, g.away, g.home);
    if (!e) { console.log('NO MATCH', g.row, g.away, g.home); continue; }
    const c = e.competitions[0].competitors, away = c.find(t => t.homeAway === 'away'), home = c.find(t => t.homeAway === 'home');
    const s = e.status.type.completed ? `${away.score}-${home.score}` : '';
    const sheet = g.score ? g.score.join('-') : '';
    console.log(g.row, `${g.away}@${g.home}`, '=>', e.shortName, e.status.type.name, s, sheet && sheet !== s ? `!! sheet ${sheet}` : '', e.competitions[0].neutralSite ? 'neutral' : '');
  }
}
