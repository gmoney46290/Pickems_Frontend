"""Extract the legacy Google Sheet export into scripts/sheet-data.json.

Usage: python scripts/extract_sheet.py "/path/to/Pickems 2026.xlsx"
Google Sheets turned some scores like "9-3" into dates; we undo that (month-day).
"""
import json, sys, datetime, openpyxl

def score(v):
    if v is None: return None
    if isinstance(v, datetime.datetime): return [v.month, v.day]
    a, b = str(v).split('-')
    return [int(a), int(b)]

wb = openpyxl.load_workbook(sys.argv[1])
m = wb['Master']
games = []
for r in range(2, m.max_row + 1):
    g = m.cell(r, 1).value
    if not g: continue
    line = m.cell(r, 2).value.strip()
    team, num = line.rsplit(' ', 1)
    away, home = [s.strip() for s in g.split('(')[0].split('@')]
    games.append(dict(row=r, away=away, home=home, line_team=team, line=float(num),
                      result=m.cell(r, 3).value, score=score(m.cell(r, 4).value)))

players = {}
for ws in wb.worksheets[1:]:
    picks = []
    for g in games:
        r = g['row']
        pick = ws.cell(r, 3).value
        if not pick: continue
        picks.append(dict(row=r, pick=pick, dd=bool(ws.cell(r, 4).value),
                          score=score(ws.cell(r, 5).value), bonus=bool(ws.cell(r, 6).value)))
    players[ws.title] = picks

json.dump(dict(games=games, players=players), open(sys.argv[2] if len(sys.argv) > 2 else 'scripts/sheet-data.json', 'w'), indent=1)
print(len(games), 'games,', {k: len(v) for k, v in players.items()})
