// Load the Prize Game quiz questions into Supabase (admin-only table).
// The quiz source is confidential, so it is NOT committed to this public repo; pass its path:
//
//   node --env-file=.env scripts/load-quiz.mjs "/Users/you/Downloads/PICK EMS nfl-roster-contract-quiz.md"
//
// Expects "**A1.** question" followed by "- A. choice" lines, and an "# ANSWER KEY" section with
// "**A1. A (47).** explanation" entries. Safe to re-run (upserts by question id).
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const file = process.argv[2];
if (!file) throw new Error('Pass the quiz markdown path');
const md = fs.readFileSync(file, 'utf8');
const [body, key] = md.split(/^# ANSWER KEY\s*$/m);
if (!key) throw new Error('No "# ANSWER KEY" section found');

const questions = new Map();
let setName = '', topic = null, current = null;
for (const raw of body.split('\n')) {
  const line = raw.trim();
  let m;
  if ((m = line.match(/^# SET [AB]: (.+)$/))) { setName = m[1].trim(); topic = null; continue; }
  if ((m = line.match(/^## (.+)$/))) { topic = m[1].trim(); continue; }
  if ((m = line.match(/^\*\*([AB]\d+)\.\*\*\s*(.+)$/))) {
    current = { id: m[1], set_name: setName, topic, question: m[2].trim(), choices: [] };
    questions.set(current.id, current);
    continue;
  }
  if (current && (m = line.match(/^- ([A-D])\. (.+)$/))) current.choices.push({ key: m[1], text: m[2].trim() });
}

for (const raw of key.split('\n')) {
  const m = raw.trim().match(/^\*\*([AB]\d+)\. ([A-D])\b.*?\*\*\s*(.*)$/);
  if (!m) continue;
  const q = questions.get(m[1]);
  if (!q) continue;
  q.answer = m[2];
  q.explanation = m[3].trim() || null;
}

const rows = [...questions.values()];
const bad = rows.filter(q => q.choices.length !== 4 || !q.answer);
if (bad.length) throw new Error(`Couldn't parse: ${bad.map(q => q.id).join(', ')}`);

if (process.argv.includes('--dry')) {
  // Prints shape only (counts, topics, answer-letter spread), never question text.
  const topics = {}; const letters = {};
  for (const q of rows) { topics[q.topic ?? q.set_name] = (topics[q.topic ?? q.set_name] ?? 0) + 1; letters[q.answer] = (letters[q.answer] ?? 0) + 1; }
  console.log(rows.length, 'questions;', 'with explanations:', rows.filter(q => q.explanation).length);
  console.log('by topic:', topics);
  console.log('answer letters:', letters);
  process.exit(0);
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { error } = await sb.from('quiz_questions').upsert(rows);
if (error) throw new Error(error.message);
console.log(`loaded ${rows.length} questions (${rows.filter(q => q.id.startsWith('A')).length} set A, ${rows.filter(q => q.id.startsWith('B')).length} set B)`);
