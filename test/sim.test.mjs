import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRanking } from '../game/rules.js';
import { playMatch } from './sim.mjs';

const SEEDS = Array.from({ length: 20 }, (_, i) => i * 1013 + 1);

test('20 whole matches with only bots: every one ends, ranks everyone, no NaN, nobody out of the maze', () => {
  let rounds = 0;
  let bankKills = 0;
  let selfKills = 0;
  let deaths = 0;
  const roundMs = [];
  for (const seed of SEEDS) {
    const { g, stats, phases, roster } = playMatch(seed, { goal: 3 });
    assert.deepEqual(stats.bad, [], `seed ${seed}`);
    assert.equal(stats.stuckShots, 0, `seed ${seed}: a shot ended inside a wall`);
    assert.equal(g.phase, 'final');
    // the winner reached the goal (or the round cap was hit)
    const ranking = matchRanking(g.roster, g.scores, g.kills);
    assert.equal(ranking.length, roster.length);
    assert.equal(new Set(ranking).size, roster.length);
    assert.equal(g.scores[ranking[0]], Math.max(...Object.values(g.scores)));
    assert.ok(g.scores[ranking[0]] >= 3, `seed ${seed}: the winner has ${g.scores[ranking[0]]}`);
    assert.equal(Object.values(g.scores).reduce((a, b) => a + b, 0) <= g.round, true, 'at most one point a round');
    // every round: intro, play, end, in order, ending in the final
    const expect = [];
    for (let r = 1; r <= g.round; r++) expect.push(`${r}:intro`, `${r}:play`, `${r}:end`);
    expect.push(`${g.round}:final`);
    assert.deepEqual(phases, expect, `seed ${seed}`);
    rounds += stats.rounds;
    deaths += stats.deaths;
    selfKills += stats.selfKills;
    if (stats.maxBank >= 1) bankKills++;
    roundMs.push(...stats.roundMs);
    for (const ms of stats.roundMs) assert.ok(ms >= 2000 && ms <= 75000, `a round of ${ms} ms`);
  }
  const avg = roundMs.reduce((a, b) => a + b, 0) / roundMs.length / 1000;
  console.log(`  20 matches: ${rounds} rounds, ${deaths} tanks destroyed (${selfKills} by their own shot), average round ${avg.toFixed(1)} s, ricochet kills in ${bankKills} matches`);
  assert.ok(rounds >= 20 * 3, 'at least three rounds each');
  assert.ok(avg >= 6 && avg <= 40, `an average round of ${avg} s`);
  assert.ok(bankKills >= 15, 'bank shots happen');
  assert.ok(selfKills < deaths * 0.25, 'bots do not mostly kill themselves');
});

test('a match with people in it (who sit still) still ends, and they are ranked too', () => {
  for (const seed of [5, 6, 7, 8]) {
    const { g, stats, roster } = playMatch(seed, { goal: 2, humans: ['ann', 'bo'] });
    assert.deepEqual(stats.bad, []);
    assert.equal(roster.length, 4);
    assert.equal(g.phase, 'final');
    assert.equal(matchRanking(g.roster, g.scores, g.kills).length, 4);
  }
});

test('goals of 5, 10 and 15 all end (bots, one seed each)', () => {
  for (const goal of [5, 10, 15]) {
    const { g, stats } = playMatch(goal * 31, { goal });
    assert.deepEqual(stats.bad, []);
    assert.equal(g.phase, 'final');
    assert.ok(Math.max(...Object.values(g.scores)) >= goal);
  }
});

test('a person who mashes everything (stick and keys, every power-up, fire held) breaks nothing', () => {
  for (const seed of [11, 12, 13, 14, 15, 16]) {
    let n = 0;
    const rngState = { s: seed * 7919 };
    const rnd = () => {
      rngState.s = (rngState.s * 1664525 + 1013904223) >>> 0;
      return rngState.s / 4294967296;
    };
    const { g, stats } = playMatch(seed, {
      goal: 3,
      humans: ['ann'],
      drive: (round) => {
        const k = round.byId.get('ann');
        if (!k || !k.alive) return;
        n++;
        const inp = k.inp;
        if (n % 20 === 0) {
          if (rnd() < 0.5) {
            inp.aim = rnd() * 6.28 - 3.14;
            inp.mag = rnd();
            inp.turn = 0;
            inp.thr = 0;
          } else {
            inp.aim = null;
            inp.mag = 0;
            inp.turn = Math.floor(rnd() * 3) - 1;
            inp.thr = Math.floor(rnd() * 3) - 1;
          }
        }
        inp.fire = rnd() < 0.5;
        inp.edge = rnd() < 0.12;
        if (n % 150 === 0 && !k.weapon) k.weapon = { k: 'LSGMH'[Math.floor(rnd() * 5)], ammo: 20 };
      },
    });
    assert.deepEqual(stats.bad, [], `seed ${seed}`);
    assert.equal(stats.stuckShots, 0);
    assert.equal(g.phase, 'final');
  }
});
