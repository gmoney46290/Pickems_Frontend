import fs from 'fs';
import { LEGACY_WEEKS, LEGACY_TO_ESPN, fetchSlate, matchEvent } from './legacy-codes.mjs';
const data = JSON.parse(fs.readFileSync(new URL('./sheet-data.json', import.meta.url)));
const ev = {};
for (const w of LEGACY_WEEKS) {
  const all = [...await fetchSlate('nfl', w.nflWeek), ...await fetchSlate('cfb', w.cfbWeek)];
  for (const g of data.games.filter(g => g.row >= w.firstRow && g.row <= w.lastRow)) ev[g.row] = matchEvent(all, g.away, g.home);
}
const code = c => LEGACY_TO_ESPN[c] ?? c;
for (const [pl, picks] of Object.entries(data.players)) for (const p of picks) {
  if (!p.score) continue;
  const g = data.games.find(x => x.row === p.row), e = ev[p.row], c = e.competitions[0].competitors;
  const A = c.find(t => t.homeAway === 'away'), H = c.find(t => t.homeAway === 'home');
  const homeSpread = code(g.line_team) === H.team.abbreviation ? g.line : -g.line;
  const covers = (a, h) => (h - a + homeSpread) > 0 ? H.team.abbreviation : A.team.abbreviation;
  const [x, y] = p.score;
  const ah = covers(x, y), ha = covers(y, x);
  const pick = code(p.pick);
  let bonusAH = null, bonusHA = null;
  if (e.status.type.completed) { const a = +A.score, h = +H.score; bonusAH = Math.abs(x - a) <= 2 && Math.abs(y - h) <= 2; bonusHA = Math.abs(y - a) <= 2 && Math.abs(x - h) <= 2; }
  const consistent = [ah === pick ? 'AH' : null, ha === pick ? 'HA' : null].filter(Boolean).join('/') || 'NONE';
  console.log(pl.padEnd(8), p.row, `${A.team.abbreviation}@${H.team.abbreviation}`.padEnd(10), `pick ${pick}`.padEnd(10), `${x}-${y}`.padEnd(6), 'consistent:', consistent.padEnd(5), e.status.type.completed ? `final ${A.score}-${H.score} sheetBonus=${p.bonus} AH=${bonusAH} HA=${bonusHA}` : '', 'winnerFirst:', (x>y) ? 'first-bigger':'second-bigger');
}
