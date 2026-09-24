export function RulesPage() {
  return (
    <div className="card panel rules" style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="sticker" style={{ background: 'var(--yellow)', fontSize: 22 }}>📜 The Sacred Texts</div>

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
        <li>Everyone's picks are hidden until kickoff, then fully public for roasting.</li>
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
