import confetti from 'canvas-confetti';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { fireParty } from '../components/fun';
import { useLeague } from '../lib/league';
import { supabase } from '../lib/supabase';

/**
 * Phase-winner prize game (admins only, playable any number of times):
 * pick 1 of 3 briefcases (always candy) → keep the candy or gamble on a quiz →
 * get 2 of 3 right and pick between the two gift-card cases; fail and walk away empty-handed.
 */

interface Question {
  id: string;
  topic: string | null;
  set_name: string;
  question: string;
  choices: { key: string; text: string }[];
  answer: string;
  explanation: string | null;
}

type Prize = 'candy' | 'nike' | 'cfa';
const PRIZES: Record<Prize, { emoji: string; title: string; sub: string }> = {
  candy: { emoji: '🍬', title: 'A piece of candy', sub: 'Sweet. Literally.' },
  nike: { emoji: '👟', title: '$50 Nike gift card', sub: 'Just do it.' },
  cfa: { emoji: '🐔', title: '$25 Chick-fil-A gift card', sub: 'My pleasure.' },
};

const QUIZ_LEN = 3;
const TO_PASS = 2;

type Stage = 'intro' | 'pick' | 'decide' | 'quiz' | 'passed' | 'won' | 'failed' | 'candy';

const shuffle = <T,>(a: T[]) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

const emojiRain = (text: string, n = 30) => {
  try {
    const shape = confetti.shapeFromText({ text, scalar: 2.4 });
    confetti({ shapes: [shape], scalar: 2.4, particleCount: n, spread: 120, origin: { y: 0.2 }, gravity: 1.2, ticks: 200, startVelocity: 20 });
  } catch {
    /* emoji shapes unsupported */
  }
};

export function PrizeGamePage() {
  const { me, ready, players } = useLeague();
  const [bank, setBank] = useState<Question[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('intro');
  const [contestant, setContestant] = useState<string>('');
  // case number (1-3) → prize; filled when the first case is opened
  const [cases, setCases] = useState<Record<number, Prize> | null>(null);
  const [firstPick, setFirstPick] = useState<number | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const [finalPick, setFinalPick] = useState<number | null>(null);
  const [quiz, setQuiz] = useState<Question[]>([]);
  const [qi, setQi] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [right, setRight] = useState(0);
  const [wrong, setWrong] = useState(0);

  useEffect(() => {
    if (!me?.is_admin) return;
    supabase
      .from('quiz_questions')
      .select('*')
      .then(({ data, error }) => {
        if (error) setErr(error.message);
        else setBank((data as Question[]) ?? []);
      });
  }, [me?.is_admin]);

  if (ready && !me?.is_admin) return <Navigate to="/" replace />;

  const who = players.find(p => p.id === contestant);
  const reset = () => {
    setStage('intro');
    setCases(null);
    setFirstPick(null);
    setFinalPick(null);
    setOpening(null);
    setQuiz([]);
    setQi(0);
    setChosen(null);
    setRight(0);
    setWrong(0);
  };

  const pickFirst = (n: number) => {
    if (opening != null) return;
    setOpening(n);
    // The first case is always the candy; the other two get the gift cards in random order.
    const others = [1, 2, 3].filter(x => x !== n);
    const [a, b] = shuffle<Prize>(['nike', 'cfa']);
    setTimeout(() => {
      setCases({ [n]: 'candy', [others[0]]: a, [others[1]]: b } as Record<number, Prize>);
      setFirstPick(n);
      setOpening(null);
      setStage('decide');
      emojiRain('🍬', 20);
    }, 900);
  };

  const startQuiz = () => {
    setQuiz(shuffle(bank ?? []).slice(0, QUIZ_LEN));
    setQi(0);
    setRight(0);
    setWrong(0);
    setChosen(null);
    setStage('quiz');
  };

  const answer = (key: string) => {
    if (chosen) return;
    setChosen(key);
    if (key === quiz[qi].answer) {
      setRight(r => r + 1);
      confetti({ particleCount: 40, spread: 60, origin: { y: 0.7 }, colors: ['#22c55e', '#ffd23f'] });
    } else setWrong(w => w + 1);
  };

  // Decided as soon as it's mathematically over.
  const decided = right >= TO_PASS || wrong > QUIZ_LEN - TO_PASS;
  const next = () => {
    if (decided) {
      if (right >= TO_PASS) {
        setStage('passed');
        fireParty();
      } else {
        setStage('failed');
        emojiRain('😢', 40);
      }
      return;
    }
    setQi(i => i + 1);
    setChosen(null);
  };

  const pickFinal = (n: number) => {
    if (opening != null) return;
    setOpening(n);
    setTimeout(() => {
      setFinalPick(n);
      setOpening(null);
      setStage('won');
      fireParty();
      setTimeout(() => emojiRain(PRIZES[cases![n]].emoji, 40), 400);
    }, 1100);
  };

  const Case = ({ n, onClick, disabled, reveal }: { n: number; onClick?: () => void; disabled?: boolean; reveal?: boolean }) => {
    const prize = cases?.[n];
    const open = reveal && prize;
    return (
      <button className={`briefcase ${opening === n ? 'opening' : ''} ${open ? 'open' : ''}`} onClick={onClick} disabled={disabled || !onClick}>
        <span className="bc-handle" />
        <span className="bc-body">
          {open ? (
            <span className="bc-prize">
              <span className="bc-emoji">{PRIZES[prize].emoji}</span>
              <span className="bc-label">{PRIZES[prize].title}</span>
            </span>
          ) : (
            <span className="bc-num">{n}</span>
          )}
        </span>
      </button>
    );
  };

  const q = quiz[qi];

  return (
    <div className="prize-game">
      <div className="card panel prize-head">
        <div className="sticker" style={{ background: 'var(--ink)', color: 'var(--yellow)', fontSize: 22 }}>💼 Deal or No Deal: Phase Prize</div>
        {who && stage !== 'intro' && (
          <span className="chip" style={{ fontSize: 14 }}>
            <Avatar p={who} size="sm" /> Playing: {who.name}
          </span>
        )}
        {stage !== 'intro' && <button className="btn small" onClick={reset}>↺ Start over</button>}
      </div>

      {err && <div className="card panel" style={{ background: 'var(--loss-bg)' }}>💥 Couldn't load the quiz: {err}</div>}
      {bank && bank.length < QUIZ_LEN && <div className="card panel" style={{ background: 'var(--loss-bg)' }}>The quiz bank is empty. Run scripts/load-quiz.mjs first.</div>}

      {stage === 'intro' && (
        <div className="card panel prize-stage center">
          <h2 className="display" style={{ fontSize: 30, margin: '4px 0' }}>🏆 Phase champ, step up!</h2>
          <p style={{ maxWidth: 560, margin: '8px auto 16px' }}>
            Three briefcases. Pick one and it's yours. Then decide: keep it, or risk it all on an NFL personnel quiz for a shot at something better.
          </p>
          <div className="row wrap" style={{ justifyContent: 'center', marginBottom: 16 }}>
            {players.map(p => (
              <button key={p.id} className={`btn small ${contestant === p.id ? 'primary' : ''}`} onClick={() => setContestant(p.id)}>
                <Avatar p={p} size="sm" /> {p.name}
              </button>
            ))}
          </div>
          <button className="btn primary" style={{ fontSize: 18, padding: '12px 22px' }} disabled={!bank || bank.length < QUIZ_LEN} onClick={() => setStage('pick')}>
            Let's play 💼
          </button>
        </div>
      )}

      {stage === 'pick' && (
        <div className="card panel prize-stage center">
          <h2 className="display">Pick a briefcase</h2>
          <div className="cases">
            {[1, 2, 3].map(n => <Case key={n} n={n} onClick={() => pickFirst(n)} />)}
          </div>
        </div>
      )}

      {stage === 'decide' && firstPick && (
        <div className="card panel prize-stage center">
          <h2 className="display">Briefcase #{firstPick} is…</h2>
          <div className="cases">
            {[1, 2, 3].map(n => <Case key={n} n={n} reveal={n === firstPick} />)}
          </div>
          <h2 className="display" style={{ fontSize: 26 }}>🍬 Candy!</h2>
          <p style={{ maxWidth: 560, margin: '0 auto 16px' }}>
            Take the candy and walk away happy… or give it up and take a <b>{QUIZ_LEN}-question NFL personnel quiz</b>. Get <b>{TO_PASS} right</b> and you pick one of the other two cases. Fail and you get <b>nothing</b>.
          </p>
          <div className="row wrap" style={{ justifyContent: 'center', gap: 12 }}>
            <button className="btn yellow" style={{ fontSize: 16, padding: '12px 20px' }} onClick={() => { setStage('candy'); emojiRain('🍬', 40); }}>
              🍬 I'll take the candy
            </button>
            <button className="btn primary" style={{ fontSize: 16, padding: '12px 20px' }} onClick={startQuiz}>
              🧠 Risk it. Quiz me.
            </button>
          </div>
        </div>
      )}

      {stage === 'quiz' && q && (
        <div className="card panel prize-stage quiz-card" key={q.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="chip dark">Question {qi + 1} of {QUIZ_LEN}</span>
            <span className="row" style={{ gap: 6 }}>
              {Array.from({ length: QUIZ_LEN }, (_, i) => (
                <span key={i} className={`dot-step ${i < right + wrong ? 'done' : ''} ${i === qi ? 'now' : ''}`} />
              ))}
              <span className="chip green">✅ {right}</span>
              <span className="chip red">❌ {wrong}</span>
            </span>
          </div>
          {q.topic && <div className="muted" style={{ fontWeight: 700, fontSize: 13, marginTop: 10 }}>{q.topic}</div>}
          <h2 className="quiz-q">{q.question}</h2>
          <div className="quiz-choices">
            {q.choices.map(c => {
              const state = !chosen ? '' : c.key === q.answer ? 'correct' : c.key === chosen ? 'wrong' : 'dim';
              return (
                <button key={c.key} className={`quiz-choice ${state}`} onClick={() => answer(c.key)} disabled={!!chosen}>
                  <span className="qc-key">{c.key}</span>
                  <span>{c.text}</span>
                  {state === 'correct' && <span className="qc-mark">✅</span>}
                  {state === 'wrong' && <span className="qc-mark">❌</span>}
                </button>
              );
            })}
          </div>
          {chosen && (
            <div className={`quiz-feedback ${chosen === q.answer ? 'good' : 'bad'}`}>
              <b>{chosen === q.answer ? 'Nailed it! 🎯' : 'Oof. Not quite.'}</b>
              {q.explanation && <div style={{ marginTop: 4 }}>{q.explanation}</div>}
              <button className="btn primary" style={{ marginTop: 10 }} onClick={next}>
                {decided ? (right >= TO_PASS ? 'You passed! Pick a case →' : 'See the damage →') : 'Next question →'}
              </button>
            </div>
          )}
        </div>
      )}

      {stage === 'passed' && firstPick && (
        <div className="card panel prize-stage center">
          <h2 className="display" style={{ fontSize: 28 }}>🧠 Big brain! You passed ({right}/{right + wrong})</h2>
          <p>One case has a <b>$50 Nike</b> gift card. The other has a <b>$25 Chick-fil-A</b> gift card. Choose wisely.</p>
          <div className="cases">
            {[1, 2, 3].map(n => (n === firstPick ? <Case key={n} n={n} reveal /> : <Case key={n} n={n} onClick={() => pickFinal(n)} />))}
          </div>
          <p className="muted" style={{ fontSize: 13 }}>(The candy's gone. You traded it for this.)</p>
        </div>
      )}

      {stage === 'won' && finalPick && cases && (
        <div className="card panel prize-stage center">
          <div className="big-prize">{PRIZES[cases[finalPick]].emoji}</div>
          <h2 className="display" style={{ fontSize: 30, margin: 0 }}>{who ? `${who.name} wins ` : 'You win '}a {PRIZES[cases[finalPick]].title}!</h2>
          <p className="muted">{PRIZES[cases[finalPick]].sub}</p>
          <div className="cases">
            {[1, 2, 3].map(n => <Case key={n} n={n} reveal />)}
          </div>
          <button className="btn primary" onClick={reset}>Play again 💼</button>
        </div>
      )}

      {stage === 'failed' && cases && (
        <div className="card panel prize-stage center" style={{ background: 'var(--loss-bg)' }}>
          <div className="big-prize">🎺😢</div>
          <h2 className="display" style={{ fontSize: 28, margin: 0 }}>Womp womp. {right}/{right + wrong}.</h2>
          <p>{who ? `${who.name} gave` : 'You gave'} up the candy and walked away with <b>nothing</b>. Here's what you missed:</p>
          <div className="cases">
            {[1, 2, 3].map(n => <Case key={n} n={n} reveal />)}
          </div>
          <button className="btn primary" onClick={reset}>Play again 💼</button>
        </div>
      )}

      {stage === 'candy' && cases && (
        <div className="card panel prize-stage center">
          <div className="big-prize">🍬</div>
          <h2 className="display" style={{ fontSize: 28, margin: 0 }}>{who ? `${who.name} takes` : 'You take'} the candy!</h2>
          <p>Playing it safe. Here's what was in the other cases…</p>
          <div className="cases">
            {[1, 2, 3].map(n => <Case key={n} n={n} reveal />)}
          </div>
          <button className="btn primary" onClick={reset}>Play again 💼</button>
        </div>
      )}
    </div>
  );
}
