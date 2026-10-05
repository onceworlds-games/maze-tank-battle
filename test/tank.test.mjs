import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMaze } from '../game/maze.js';
import { COLS, ROWS, STEP, TANK } from '../game/rules.js';
import { mulberry32 } from '../game/rng.js';
import { near, openMaze, roundWith, run } from './helpers.mjs';

/** The smallest distance from any of the tank's three circle centres to any wall rectangle. */
function clearance(round, k) {
  let min = Infinity;
  for (const off of [-TANK.off, 0, TANK.off]) {
    const px = k.x + Math.cos(k.a) * off;
    const py = k.y + Math.sin(k.a) * off;
    for (const [x0, y0, x1, y1] of round.maze.rects) {
      const qx = Math.max(x0, Math.min(px, x1));
      const qy = Math.max(y0, Math.min(py, y1));
      min = Math.min(min, Math.hypot(px - qx, py - qy));
    }
  }
  return min;
}

test('speeds: 1.6 cells/s forward, 1.1 back, 3.2 rad/s round', () => {
  const round = roundWith([{ id: 'a', x: 2, y: 3, a: 0 }], { maze: openMaze() });
  const k = round.byId.get('a');
  k.inp.thr = 1;
  run(round, 1);
  assert.ok(near(k.x, 3.6, 1e-6), `forward ${k.x - 2}`);
  k.inp.thr = -1;
  run(round, 1);
  assert.ok(near(k.x, 3.6 - 1.1, 1e-6), `back ${3.6 - k.x}`);
  k.inp.thr = 0;
  k.inp.turn = 1;
  const a0 = k.a;
  run(round, 0.5);
  assert.ok(near(k.a - a0, 1.6, 1e-6), `turn ${k.a - a0}`);
  assert.ok(Math.abs(k.vx) < 1e-9);
});

test('tanks never get into a wall or out of the maze: random driving in 20 mazes', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const maze = makeMaze(seed * 31);
    const round = roundWith([{ id: 'a', x: 0.5 + (seed % COLS), y: 0.5 + (seed % ROWS), a: seed }], { maze });
    const k = round.byId.get('a');
    const rng = mulberry32(seed);
    let path = 0;
    let lx = k.x;
    let ly = k.y;
    for (let i = 0; i < 40 * 60; i++) {
      if (i % 24 === 0) {
        k.inp.turn = Math.floor(rng() * 3) - 1;
        k.inp.thr = rng() < 0.8 ? 1 : -1;
      }
      round.step(STEP);
      assert.ok(Number.isFinite(k.x) && Number.isFinite(k.y) && Number.isFinite(k.a));
      assert.ok(k.x > 0 && k.x < COLS && k.y > 0 && k.y < ROWS);
      assert.ok(clearance(round, k) >= TANK.rc - 2e-3, `seed ${seed}, step ${i}: ${clearance(round, k)} from a wall`);
      path += Math.hypot(k.x - lx, k.y - ly);
      lx = k.x;
      ly = k.y;
    }
    assert.ok(path > 8, `seed ${seed}: the tank only went ${path}`);
  }
});

test('driving at a wall slants: the tank slides along it instead of sticking', () => {
  const round = roundWith([{ id: 'a', x: 8.2, y: 3, a: Math.PI / 4 }], { maze: openMaze() });
  const k = round.byId.get('a');
  k.inp.thr = 1;
  run(round, 2);
  assert.ok(k.y > 4.2, `slid down the wall to ${k.y}`);
  assert.ok(k.x < COLS - TANK.rc);
});

test('turning on the spot beside a wall never goes through it', () => {
  const round = roundWith([{ id: 'a', x: 8.5, y: 0.5, a: 0 }], { maze: openMaze() });
  const k = round.byId.get('a');
  k.x = COLS - 0.17 - 0.055;
  k.y = 0.17 + 0.055;
  k.inp.turn = 1;
  for (let i = 0; i < 300; i++) {
    round.step(STEP);
    assert.ok(clearance(round, k) >= TANK.rc - 2e-3);
  }
});

test('on the stick the tank turns to face the way pushed and only drives once it is facing it', () => {
  const round = roundWith([{ id: 'a', x: 3, y: 3, a: 0 }], { maze: openMaze() });
  const k = round.byId.get('a');
  k.inp.aim = Math.PI / 2;
  k.inp.mag = 1;
  run(round, 0.1);
  assert.ok(Math.hypot(k.x - 3, k.y - 3) < 0.05, 'it turns first');
  run(round, 0.8);
  assert.ok(near(k.a, Math.PI / 2, 1e-6));
  assert.ok(k.y > 3.4, `then drives (${k.y})`);
  assert.ok(Math.abs(k.x - 3) < 0.2);
  // let go: it stops
  k.inp.aim = null;
  k.inp.mag = 0;
  const y = k.y;
  run(round, 0.3);
  assert.ok(near(k.y, y, 1e-9));
});

test('tanks collide: a tank that is only a copy never moves, the one simulated here gives way', () => {
  const round = roundWith(
    [
      { id: 'a', x: 3, y: 3, a: 0, sim: true },
      { id: 'b', x: 3.7, y: 3, a: Math.PI, sim: false },
    ],
    { maze: openMaze() },
  );
  const a = round.byId.get('a');
  const b = round.byId.get('b');
  a.inp.thr = 1;
  run(round, 2);
  assert.equal(b.x, 3.7);
  assert.equal(b.y, 3);
  assert.ok(a.x < 3.7 - 2 * TANK.rc + 0.05 + 0.3, `a stopped at ${a.x}`);
  // two simulated tanks driving at each other don't overlap either
  const r2 = roundWith(
    [
      { id: 'a', x: 2, y: 3, a: 0 },
      { id: 'b', x: 5, y: 3, a: Math.PI },
    ],
    { maze: openMaze() },
  );
  r2.byId.get('a').inp.thr = 1;
  r2.byId.get('b').inp.thr = 1;
  run(r2, 3);
  const [p, q] = [r2.byId.get('a'), r2.byId.get('b')];
  assert.ok(q.x - p.x > 2 * TANK.rc - 0.02, `${q.x - p.x} apart`);
  assert.ok(p.x < q.x);
});

test('a tank put right in a wall is moved out, and a broken position is repaired', () => {
  const round = roundWith([{ id: 'a', x: 2, y: 3, a: 0 }], { maze: makeMaze(8) });
  const k = round.byId.get('a');
  k.x = NaN;
  round.step(STEP);
  assert.ok(Number.isFinite(k.x));
  const m = round.maze;
  const [x0, y0, x1, y1] = m.rects[Math.floor(m.rects.length / 2)];
  k.x = (x0 + x1) / 2;
  k.y = (y0 + y1) / 2;
  round.step(STEP);
  assert.ok(clearance(round, k) >= TANK.rc - 2e-3);
});
