import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../game/match.js';
import { END_MS, FINAL_MS, INTRO_FIRST_MS, INTRO_MS, MAX_ROUNDS, ROUND_MAX_MS, SETTLE_MS, buildRoster, awards, matchRanking, ordinal } from '../game/rules.js';

const roster = () => buildRoster(['p1', 'p2'], 9);

function startPlay(goal = 3) {
  const m = new Match({ mid: 'm1', by: 'p1', seed: 9, goal, roster: roster(), now: 0 });
  assert.equal(m.g.phase, 'intro');
  assert.equal(m.g.until, INTRO_FIRST_MS);
  m.tick(INTRO_FIRST_MS);
  assert.equal(m.g.phase, 'play');
  assert.equal(m.g.t0, INTRO_FIRST_MS);
  return m;
}

test('the roster: the people, then bots up to four, names from the list, a colour each', () => {
  const r = buildRoster(['a', 'b'], 1);
  assert.deepEqual(r.map((e) => e.id), ['a', 'b', 'bot1', 'bot2']);
  assert.deepEqual(r.map((e) => e.c), [0, 1, 2, 3]);
  assert.ok(r[2].bot && r[2].n && r[3].n && r[2].n !== r[3].n);
  assert.equal(buildRoster([], 1).length, 4);
  assert.equal(buildRoster(['a', 'b', 'c', 'd', 'e', 'f'], 1).length, 6, 'a full table of people has no bots');
  assert.equal(buildRoster(Array.from({ length: 12 }, (_, i) => `p${i}`), 1).length, 8, 'eight tanks at most');
  assert.deepEqual(buildRoster(['a', 'a', 7, ''], 1).filter((e) => !e.bot).map((e) => e.id), ['a']);
});

test('a round is won by the last tank, 2 seconds after the last explosion (shots in flight get to land)', () => {
  const m = startPlay();
  const t0 = m.g.t0;
  assert.ok(m.dead('bot1', { by: 'p1', b: 2 }, t0 + 5000));
  assert.ok(m.dead('bot2', { by: 'p1', b: 0 }, t0 + 6000));
  m.tick(t0 + 6000);
  assert.equal(m.alive().length, 2);
  assert.ok(m.dead('p2', { by: 'p1', b: 1 }, t0 + 8000));
  m.tick(t0 + 8000 + SETTLE_MS - 10);
  assert.equal(m.g.phase, 'play', 'still waiting for shots to land');
  m.tick(t0 + 8000 + SETTLE_MS);
  assert.equal(m.g.phase, 'end');
  assert.equal(m.g.win, 'p1');
  assert.equal(m.g.scores.p1, 1);
  assert.equal(m.g.tEnd, 10000);
  assert.deepEqual(m.g.kills, { p1: 3, p2: 0, bot1: 0, bot2: 0 });
  assert.equal(m.g.bank.p1, 2);
  assert.equal(m.g.st.p1, 1);
});

test('the survivor can still be hit during those 2 seconds: all destroyed together, nobody scores', () => {
  const m = startPlay();
  const t0 = m.g.t0;
  m.dead('bot1', { by: 'p1' }, t0 + 4000);
  m.dead('bot2', { by: 'p1' }, t0 + 4100);
  m.dead('p2', { by: 'p1' }, t0 + 4200);
  m.tick(t0 + 5000);
  assert.equal(m.g.phase, 'play');
  assert.ok(m.dead('p1', { by: 'p1', b: 3 }, t0 + 5500), 'its own bounce comes back');
  m.tick(t0 + 5500 + SETTLE_MS);
  assert.equal(m.g.phase, 'end');
  assert.equal(m.g.win, '');
  assert.deepEqual(Object.values(m.g.scores), [0, 0, 0, 0]);
  assert.equal(m.g.kills.p1, 3, 'a tank taken out by itself is not a kill');
  assert.equal(m.g.over, 0);
});

test('a destroyed tank counts once, and only while the round is being played; nonsense is refused', () => {
  const m = startPlay();
  const t0 = m.g.t0;
  assert.ok(m.dead('bot1', { by: 'p1' }, t0 + 100));
  assert.equal(m.dead('bot1', { by: 'p2' }, t0 + 200), false);
  assert.equal(m.dead('nobody', {}, t0 + 200), false);
  assert.equal(m.dead(7, {}, t0 + 200), false);
  m.dead('p2', { by: 'ghost', b: 500 }, t0 + 300);
  assert.equal(m.g.out.p2[1], '', 'a killer who is not at the table is nobody');
  assert.equal(m.g.out.p2[3], 99);
  assert.equal(m.g.kills.p1, 1);
  const m2 = new Match({ mid: 'm', by: 'p1', seed: 1, goal: 3, roster: roster(), now: 0 });
  assert.equal(m2.dead('bot1', {}, 100), false, 'not in the intro');
});

test('the match goes round by round to the first to the goal, then the podium, then it asks the room to end', () => {
  const goal = 2;
  const m = startPlay(goal);
  let now = m.g.t0;
  const phases = [];
  const winRound = (who) => {
    const t0 = m.g.t0;
    for (const e of m.g.roster) if (e.id !== who) m.dead(e.id, { by: who, b: 0 }, t0 + 1000);
    now = t0 + 1000 + SETTLE_MS;
    m.tick(now);
    phases.push(`${m.g.round}:${m.g.phase}`);
    assert.equal(m.g.win, who);
    now += END_MS;
    return m.tick(now);
  };
  assert.equal(winRound('bot1'), '');
  assert.equal(m.g.phase, 'intro');
  assert.equal(m.g.round, 2);
  assert.equal(m.g.rid, 'm1.2');
  assert.deepEqual(m.g.out, {}, 'a new round starts with everyone in');
  assert.equal(m.g.until, now + INTRO_MS);
  now = m.g.until;
  m.tick(now);
  assert.equal(m.g.phase, 'play');
  // someone else wins round 2, then the first again: that is 2 points
  winRound('p1');
  assert.equal(m.g.phase, 'intro');
  now = m.g.until;
  m.tick(now);
  assert.equal(m.g.round, 3);
  assert.equal(m.g.st.bot1, undefined, 'the streak broke');
  winRound('bot1');
  assert.equal(m.g.over, 1);
  assert.equal(m.g.phase, 'final');
  assert.equal(m.g.rid, 'm1.final');
  assert.equal(m.g.scores.bot1, 2);
  assert.equal(m.tick(m.g.until - 1), '');
  assert.equal(m.tick(m.g.until), 'end');
  assert.equal(m.tick(m.g.until + 100), '', 'asked once, not every tick');
  assert.deepEqual(matchRanking(m.g.roster, m.g.scores, m.g.kills), ['bot1', 'p1', 'p2', 'bot2']);
});

test('a round nobody wins in 75 seconds is a draw; a leaver is a destroyed tank and never stalls the round', () => {
  const m = startPlay();
  const t0 = m.g.t0;
  m.tick(t0 + ROUND_MAX_MS - 1);
  assert.equal(m.g.phase, 'play');
  m.tick(t0 + ROUND_MAX_MS);
  assert.equal(m.g.phase, 'end');
  assert.equal(m.g.win, '');
  assert.equal(m.g.over, 0);
  // a leaver
  const m2 = startPlay();
  const u = m2.g.t0;
  m2.dead('p2', { by: '' }, u + 500);
  assert.equal(m2.g.out.p2[1], '');
  assert.equal(m2.g.scores.p2, 0);
});

test('someone who leaves is out of this round and of every round after it, and keeps their points', () => {
  const m = startPlay();
  const t0 = m.g.t0;
  m.g.scores.p2 = 3;
  assert.ok(m.leave('p2', t0 + 1000));
  assert.equal(m.leave('p2', t0 + 1100), false, 'once');
  assert.equal(m.leave('bot1', t0 + 1100), false, 'a bot does not leave');
  assert.ok(m.g.out.p2, 'out of the round that is running');
  m.dead('bot1', { by: 'p1' }, t0 + 2000);
  m.dead('bot2', { by: 'p1' }, t0 + 3000);
  m.tick(t0 + 3000 + SETTLE_MS);
  assert.equal(m.g.win, 'p1');
  m.tick(m.g.until);
  assert.equal(m.g.phase, 'intro');
  assert.ok(m.g.out.p2 && !m.g.out.p1, 'the next round starts without them, with everyone else in');
  assert.equal(m.g.scores.p2, 3);
  // and one who goes during an intro is out of it at once
  m.leave('p1', m.g.until - 100);
  assert.ok(m.g.out.p1);
});

test('the match always ends: after the last allowed round the best score wins', () => {
  const m = startPlay(15);
  let now = m.g.t0;
  for (let i = 0; i < MAX_ROUNDS; i++) {
    const t0 = m.g.t0;
    // draws all the way: everybody out at once
    for (const e of m.g.roster) m.dead(e.id, {}, t0 + 100);
    m.tick(t0 + 100 + SETTLE_MS);
    assert.equal(m.g.phase, 'end');
    now = m.g.until;
    m.tick(now);
    if (m.g.phase === 'final') break;
    now = m.g.until;
    m.tick(now);
  }
  assert.equal(m.g.phase, 'final');
  assert.equal(m.g.round, MAX_ROUNDS);
});

test('a new host takes the record over as it stands', () => {
  const m = startPlay();
  const t0 = m.g.t0;
  m.dead('bot1', { by: 'p1' }, t0 + 1000);
  m.tick(t0 + 4000);
  const n = Match.fromG(JSON.parse(JSON.stringify(m.g)), 'p2');
  assert.equal(n.g.by, 'p2');
  assert.deepEqual(n.g.out, m.g.out);
  assert.ok(n.dirty);
  n.dead('bot2', { by: 'p2' }, t0 + 4500);
  n.dead('p1', { by: 'p2' }, t0 + 4600);
  n.tick(t0 + 4600 + SETTLE_MS);
  assert.equal(n.g.phase, 'end');
  assert.equal(n.g.win, 'p2');
});

test('awards, the ranking and "You: 5th"', () => {
  const r = buildRoster(['a', 'b'], 1);
  const kills = { a: 4, b: 4, bot1: 1, bot2: 0 };
  assert.deepEqual(matchRanking(r, { a: 2, b: 5, bot1: 5, bot2: 0 }, kills), ['b', 'bot1', 'a', 'bot2']);
  assert.deepEqual(awards(r, kills, { a: 3, bot1: 5 }), { kills: { id: 'a', v: 4 }, bank: { id: 'bot1', v: 5 } });
  assert.deepEqual(awards(r, {}, {}), { kills: null, bank: null });
  assert.deepEqual([1, 2, 3, 4, 5, 11, 12, 13, 21, 22].map(ordinal), ['1st', '2nd', '3rd', '4th', '5th', '11th', '12th', '13th', '21st', '22nd']);
  assert.ok(FINAL_MS >= 8000 && FINAL_MS <= 10000);
});
