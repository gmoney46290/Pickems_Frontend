# Pick'ems 🏈

Weekly college + NFL pick'em against the spread. Vite + React on Netlify, Supabase for data/auth,
live scores from ESPN.

## Rules (encoded in `pick_scores` view + `src/lib/scoring.ts`)
- Pick every game ATS: +1 right, 0 wrong/push. The line is the group's house line (editable in Admin).
- One college + one pro double down per week: +2 right, −1 wrong.
- 3 score calls per week: +3 if both teams within ±2.
- Picks lock at each game's kickoff; others' picks are hidden until then (enforced by RLS).

## Setup
1. Supabase SQL editor: run `supabase/migrations/0001_init.sql`.
2. Supabase → Auth → Providers → Email: turn off "Confirm email".
3. Fill `.env` (see `.env.example`).
4. `python3 scripts/extract_sheet.py "Pickems 2026.xlsx"` then `npm run import-sheet`.
5. `npm run dev`.

## Netlify
Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
optional `ODDS_API_KEY` (the-odds-api.com free tier) for multi-book lines.
`sync-scores` runs every minute and pulls ESPN scores into `games`; clients get them via Realtime.
