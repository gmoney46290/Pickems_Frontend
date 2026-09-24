// The old sheet used 49ers-style school/club codes. Map them to ESPN abbreviations.
export const LEGACY_TO_ESPN = {
  // NFL (only differences)
  ARZ: 'ARI', WAS: 'WSH',
  // College
  TXHO: 'HOU', TXTC: 'TTU', SCCC: 'CCU', DEUN: 'DEL', FLST: 'FSU', ALUN: 'ALA',
  TXMU: 'SMU', KYLO: 'LOU', MSST: 'MSST', SCUN: 'SC', FLUN: 'FLA', ALAU: 'AUB',
  LAST: 'LSU', MSUN: 'MISS', COUN: 'COLO', ILNW: 'NU', TXSN: 'UTSA', TXUN: 'TEX',
  CAFR: 'FRES', CASJ: 'SJSU', SCCL: 'CLEM', CAUN: 'CAL', TNUN: 'TENN', CASS: 'SDSU',
  OHTO: 'TOL', OKUN: 'OU', GAUN: 'UGA', OKST: 'OKST', WVUN: 'WVU', ORUN: 'ORE',
  CASC: 'USC', GATC: 'GT', CAST: 'STAN',
};

// Which sheet rows belong to which week of the old sheet.
export const LEGACY_WEEKS = [
  { number: 1, firstRow: 2, lastRow: 21, nflWeek: 2, cfbWeek: 3 },
  { number: 2, firstRow: 22, lastRow: 40, nflWeek: 3, cfbWeek: 4 },
];

export async function getJson(url, tries = 4) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'curl/8.7.1', Accept: 'application/json' } });
    const t = await r.text();
    try { return JSON.parse(t); } catch (e) {
      if (i >= tries) throw new Error(`ESPN gave non-JSON for ${url}: ${t.slice(0, 80)}`);
      await new Promise(res => setTimeout(res, 800 * (i + 1)));
    }
  }
}

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football';

export async function fetchSlate(league, week, season = 2026) {
  const urls = league === 'nfl'
    ? [`${BASE}/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`]
    : [80, 81].map(g => `${BASE}/college-football/scoreboard?seasontype=2&week=${week}&dates=${season}&groups=${g}&limit=400`);
  const events = [];
  for (const u of urls) {
    const d = await getJson(u);
    for (const e of d.events ?? []) if (!events.some(x => x.id === e.id)) events.push(e);
  }
  return events;
}

export function matchEvent(events, awayCode, homeCode) {
  const a = LEGACY_TO_ESPN[awayCode] ?? awayCode, h = LEGACY_TO_ESPN[homeCode] ?? homeCode;
  return events.find(e => {
    const c = e.competitions[0].competitors;
    const ab = Object.fromEntries(c.map(t => [t.homeAway, t.team.abbreviation]));
    return (ab.away === a && ab.home === h) || (ab.away === h && ab.home === a);
  });
}
