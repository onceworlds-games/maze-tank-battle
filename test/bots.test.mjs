import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMaze } from '../game/maze.js';
import { Round } from '../game/round.js';
import { COLS, ROWS, STEP, buildRoster } from '../game/rules.js';
import { mulberry32 } from '../game/rng.js';
import { openMaze, roundWith, run } from './helpers.mjs';

const botRound = (seed, n = 4) => {
  const roster = buildRoster([], seed).slice(0, n);
  const r = new Round({ roster, seed });
  for (const k of r.tanks) k.sim = true;
  return r;
};

test('bots only ever make legal moves, and stay in the maze', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const round = botRound(seed * 13);
    for (let i = 0; i < 40 * 60; i++) {
      round.step(STEP);
      for (const k of round.tanks) {
        const inp = k.inp;
        assert.ok(Number.isFinite(inp.turn) && Math.abs(inp.turn) <= 1, `turn ${inp.turn}`);
        assert.ok(Number.isFinite(inp.thr) && Math.abs(inp.thr) <= 1, `thr ${inp.thr}`);
        assert.ok(inp.aim === null || Number.isFinite(inp.aim));
        assert.ok(typeof inp.fire === 'boolean' && typeof inp.edge === 'boolean');
        assert.ok(Number.isFinite(k.x) && Number.isFinite(k.y) && Number.isFinite(k.a));
        assert.ok(k.x > 0 && k.x < COLS && k.y > 0 && k.y < ROWS);
      }
    }
  }
});

test('a bot with a clear line takes the shot: a still target in a corridor does not live', () => {
  let killed = 0;
  const N = 10;
  for (let seed = 1; seed <= N; seed++) {
    const round = roundWith(
      [
        { id: 'bot1', bot: true, x: 2, y: 3, a: Math.PI },
        { id: 'z', x: 7, y: 3, a: 0 },
      ],
      { maze: openMaze(), seed },
    );
    const bot = round.byId.get('bot1');
    bot.ai.warm = 0;
    let by = '';
    round.hooks.dead = (k, info) => {
      if (k.id === 'z') by = info.by;
    };
    run(round, 12);
    if (by === 'bot1') killed++;
  }
  assert.ok(killed >= 9, `only ${killed} of ${N}`);
});

test('the angle a bot picks really hits, bounces included: fire it and see (perfect aim)', () => {
  const rng = mulberry32(77);
  let found = 0;
  let banks = 0;
  let hit = 0;
  let tries = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const maze = makeMaze(seed * 17);
    for (let rep = 0; rep < 4; rep++) {
      const bx = Math.floor(rng() * COLS) + 0.5;
      const by = Math.floor(rng() * ROWS) + 0.5;
      const ex = Math.floor(rng() * COLS) + 0.5;
      const ey = Math.floor(rng() * ROWS) + 0.5;
      if (Math.hypot(bx - ex, by - ey) < 1.5) continue;
      const mk = () =>
        roundWith(
          [
            { id: 'bot1', bot: true, x: bx, y: by, a: 0 },
            { id: 'z', x: ex, y: ey, a: 0 },
          ],
          { maze, seed: seed + rep },
        );
      const round = mk();
      const bot = round.byId.get('bot1');
      bot.ai.warm = 0;
      bot.ai.skill = 1; // no wobble
      bot.ai.res = 3;
      bot.ai.reach = 30;
      bot.ai.maxB = 3;
      tries++;
      for (let i = 0; i < 30 && !bot.ai.sol; i++) round.step(STEP);
      const sol = bot.ai.sol;
      if (!sol || sol.drop) continue;
      found++;
      if (sol.b >= 1) banks++;
      // the same two tanks in a fresh round, the bot pointing at the angle it chose: its shot must kill the target before anything else dies
      const test = mk();
      const tb = test.byId.get('bot1');
      tb.ai = null;
      tb.x = bot.x;
      tb.y = bot.y;
      tb.a = sol.a;
      let dead = null;
      test.hooks.dead = (k, info) => (dead = dead || { id: k.id, ...info });
      tb.inp.edge = true;
      run(test, 14);
      if (dead && dead.id === 'z' && dead.by === 'bot1') hit++;
    }
  }
  assert.ok(found >= tries * 0.3, `found a shot ${found} times in ${tries}`);
  assert.ok(banks >= 3, `${banks} of them were bank shots`);
  assert.ok(hit >= found * 0.9, `${hit} of ${found} shots hit`);
});

test('a bot sidesteps a shot coming down the corridor', () => {
  let lived = 0;
  const N = 12;
  for (let seed = 1; seed <= N; seed++) {
    const round = roundWith(
      [
        { id: 'bot1', bot: true, x: 8, y: 3, a: Math.PI },
        { id: 'z', x: 0.5, y: 5.5, a: 0, sim: false },
      ],
      { maze: openMaze(), seed },
    );
    const bot = round.byId.get('bot1');
    bot.ai.warm = 1e9; // it only wants to live
    round.spawn({ id: 'x', n: 1, x: 1, y: 3, a: 0, k: 'N', at: 0 }, 0);
    let dead = false;
    round.hooks.dead = () => (dead = true);
    run(round, 4);
    if (!dead) lived++;
  }
  assert.ok(lived >= 11, `${lived} of ${N} lived`);
});

test('bots use what they pick up: a laser is fired at a target in line, a mine goes down, and the bot does not walk onto it', () => {
  // laser
  const r1 = roundWith(
    [
      { id: 'bot1', bot: true, x: 2, y: 3, a: 0 },
      { id: 'z', x: 7, y: 3, a: 0 },
    ],
    { maze: openMaze(), seed: 3 },
  );
  const b1 = r1.byId.get('bot1');
  b1.ai.warm = 0;
  b1.weapon = { k: 'L', ammo: 1 };
  let kind = '';
  r1.hooks.fire = (s) => (kind = kind || s.k);
  run(r1, 6);
  assert.equal(kind, 'L');
  assert.equal(b1.weapon, null);
  // mine
  for (const seed of [1, 2, 3, 4]) {
    const r2 = roundWith(
      [
        { id: 'bot1', bot: true, x: 2.5, y: 2.5, a: 0 },
        { id: 'z', x: 6.5, y: 4.5, a: 0, sim: false },
      ],
      { maze: makeMaze(seed + 100), seed },
    );
    const b2 = r2.byId.get('bot1');
    b2.ai.warm = 0;
    b2.weapon = { k: 'M', ammo: 1 };
    let mined = 0;
    let mineKey = '';
    let byMine = false;
    r2.hooks.fire = (s) => {
      if (s.k === 'M') {
        mined++;
        mineKey = `${s.id}.${s.n}`;
      }
    };
    r2.hooks.dead = (k, info) => (byMine = byMine || info.s === mineKey);
    run(r2, 30);
    assert.equal(mined, 1, `seed ${seed}: the mine went down`);
    assert.ok(!byMine, `seed ${seed}: the bot walked onto its own mine`);
  }
});
