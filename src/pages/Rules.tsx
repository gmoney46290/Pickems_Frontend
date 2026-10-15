import { ITEMS } from '../lib/boxes';

export function RulesPage() {
  return (
    <div className="card panel rules" style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="sticker" style={{ background: 'var(--yellow)', fontSize: 22 }}>📜 The Sacred Texts</div>

      <h3>🎁 New for Q2: Mystery Boxes</h3>
      <ul>
        <li>Everything below still applies, with two changes to score calls:</li>
        <li>🎯 A score call hits if <b>both</b> teams land within <span className="big-num">5</span> points of your call (was 2).</li>
        <li>A hit no longer scores points. Each hit earns you an extra 🎁 <b>next week</b>.</li>
        <li>Everybody gets <b>1 mystery box</b> every week, plus one per score hit from last week.</li>
        <li>Boxes must be played <b>before picks lock</b> for the week (and before that game kicks off). They don't carry over. Use it or lose it 💨</li>
        <li>Nobody knows what's in your box until you play it. Then it's public.</li>
      </ul>
      <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
        {Object.values(ITEMS).map(it => (
          <li key={it.key}>
            <b>{it.emoji} {it.name}</b> · {it.blurb}
            {it.key === 'landmine' && ' Stacks with a double down (a losing DD becomes −2).'}
            {it.key === 'taser' && ' Stacks: two tasers = 4 points harder.'}
            {it.key === 'lone_wolf' && ' Nobody can switch sides on that game afterward.'}
          </li>
        ))}
      </ul>
      <p className="muted" style={{ fontSize: 13 }}>Q1 weeks are final and keep the old rules (score calls within 2 = +3).</p>

      <h3>🏈 Pick every game against the spread</h3>
      <ul>
        <li>Every week the commish posts a slate of college and pro games with a line.</li>
        <li>Pick who covers. Right = <span className="big-num">+1</span>. Wrong = 0. A push is 0.</li>
        <li>The line we pick against is <b>our house line</b>. It usually matches Vegas, but the commish can season it to taste 🌶️.</li>
      </ul>

      <h3>🔥 Double down (one college, one pro)</h3>
      <ul>
        <li>Pick one college game and one pro game per week to double down on.</li>
        <li>Right = <span className="big-num">+2</span>. Wrong = <span className="big-num">−1</span>. Choose wisely, or at least loudly.</li>
      </ul>

      <h3>🎯 Call three scores</h3>
      <ul>
        <li>You get 3 score calls a week. Put in the final score for both teams.</li>
        <li>If <b>both</b> teams land within 2 points of your call, that's a bullseye: <span className="big-num">+3</span>.</li>
        <li>Score calls are separate from your ATS pick. You can call 31–30 and still take the dog.</li>
      </ul>

      <h3>🔒 Locks & peeking</h3>
      <ul>
        <li>Each game locks at its own kickoff. Change your mind all you want before then.</li>
        <li>Everyone's picks are public the second they're made. Pick with your chest.</li>
        <li>Scores update live from ESPN. You'll see who's covering as it happens.</li>
      </ul>

      <h3>🏆 Standings</h3>
      <ul>
        <li>Points add up over the season. Weekly winners get a 👑.</li>
        <li>The season is split into phases (mini-seasons) with their own standings, so everybody gets a fresh shot.</li>
        <li>Ties are broken by bullseyes, then vibes.</li>
      </ul>
    </div>
  );
}
