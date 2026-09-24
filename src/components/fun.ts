import confetti from 'canvas-confetti';

export const TAGLINES = [
  'Where spreads go to die',
  'Fading the public since forever',
  'Vegas fears us (they do not)',
  'Trust the process (don’t)',
  'Back-door covers welcome',
  'Hook, line & sinker',
  'Ride or die, mostly die',
  'The line is a suggestion',
];

export const WIN_WORDS = ['CASH', 'BANG', 'MONEY', 'NAILED', 'EZ'];
export const LOSS_WORDS = ['BUST', 'OOF', 'YIKES', 'BRICK', 'NOPE'];
export const pickWord = (arr: string[], seed: number) => arr[Math.abs(seed) % arr.length];

const burst = (text: string, x = 0.5, y = 0.6) => {
  try {
    const shape = confetti.shapeFromText({ text, scalar: 2.2 });
    confetti({ shapes: [shape], scalar: 2.2, particleCount: 24, spread: 70, origin: { x, y }, startVelocity: 32, gravity: 0.9, ticks: 120 });
  } catch {
    confetti({ particleCount: 60, spread: 70, origin: { x, y } });
  }
};

function originOf(el?: Element | null) {
  if (!el) return { x: 0.5, y: 0.6 };
  const r = el.getBoundingClientRect();
  return { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight };
}

export const fireDD = (el?: Element | null) => { const o = originOf(el); burst('🔥', o.x, o.y); };
export const fireScore = (el?: Element | null) => { const o = originOf(el); burst('🎯', o.x, o.y); };
export const firePick = (el?: Element | null) => {
  const o = originOf(el);
  confetti({ particleCount: 18, spread: 50, startVelocity: 18, origin: o, colors: ['#ffd23f', '#ff5da2', '#3a86ff'], ticks: 60, scalar: 0.8 });
};
export const fireParty = () => {
  confetti({ particleCount: 150, spread: 100, origin: { y: 0.5 } });
  burst('🏈');
};
