import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castRects, reflect, segObb } from '../game/geom.js';
import { WALL_T, makeMaze } from '../game/maze.js';
import { COLS, ROWS, SHOT, STEP, TANK } from '../game/rules.js';
import { mulberry32 } from '../game/rng.js';
import { near, openMaze, roundWith, run } from './helpers.mjs';

/** Where a point moving in a straight line from x0 at speed v ends after t, bouncing between the walls lo and hi (unfolding). */
function fold(x0, v, t, lo, hi) {
  const w = hi - lo;
  let p = (x0 + v * t - lo) % (2 * w);
  if (p < 0) p += 2 * w;
  return lo + (p <= w ? p : 2 * w - p);
}

const lo = (r) => WALL_T / 2 + r;

test('castRects: a circle meets a wall face where its edge touches it, with the face normal', () => {
  const rc = Float64Array.from([2, 0, 2.2, 5]); // a vertical wall, x from 2 to 2.2
  const out = {};
  assert.ok(castRects(rc, 1, 0, 1, 1, 0, 10, 0.05, out));
  assert.ok(near(out.t, 2 - 0.05 - 0));
  assert.equal(out.nx, -1);
  assert.equal(out.ny, 0);
  // from the other side
  assert.ok(castRects(rc, 1, 3, 1, -1, 0, 10, 0.05, out));
  assert.ok(near(out.t, 3 - 2.2 - 0.05));
  assert.equal(out.nx, 1);
  // too short to arrive, parallel to the face, and starting inside: no hit
  assert.ok(!castRects(rc, 1, 0, 1, 1, 0, 1, 0.05, out));
  assert.ok(!castRects(rc, 1, 1, 1, 0, 1, 10, 0.05, out));
  assert.ok(!castRects(rc, 1, 2.1, 1, 1, 0, 10, 0.05, out));
});

test('reflect mirrors a direction in a face', () => {
  const o = [0, 0];
  reflect(1, 1, -1, 0, o);
  assert.deepEqual(o, [-1, 1]);
  reflect(0.6, -0.8, 0, 1, o);
  assert.ok(near(o[0], 0.6) && near(o[1], 0.8));
});

test('segObb: a segment through a tank is found, one beside it is not', () => {
  assert.ok(segObb(-1, 0, 1, 0, 0, 0, 0, 0.25, 0.2) >= 0);
  assert.ok(near(segObb(-1, 0, 1, 0, 0, 0, 0, 0.25, 0.2), 0.375));
  assert.equal(segObb(-1, 0.5, 1, 0.5, 0, 0, 0, 0.25, 0.2), -1);
  // turned a quarter: the long side faces up
  assert.ok(segObb(-1, 0.3, 1, 0.3, 0, 0, Math.PI / 2, 0.25, 0.2) === -1);
  assert.ok(segObb(-1, 0.22, 1, 0.22, 0, 0, Math.PI / 2, 0.25, 0.2) >= 0);
  assert.ok(segObb(0, -1, 0, 1, 0, 0, Math.PI / 2, 0.25, 0.2) >= 0);
});

test('a shot reflects exactly: its path is the unfolded straight line, at any angle', () => {
  const maze = openMaze();
  const r = SHOT.r;
  let worst = 0;
  const rng = mulberry32(11);
  for (let i = 0; i < 60; i++) {
    const a = rng() * Math.PI * 2;
    if (Math.abs(Math.cos(a)) < 0.02 || Math.abs(Math.sin(a)) < 0.02) continue;
    const x0 = 1 + rng() * 6;
    const y0 = 1 + rng() * 3;
    const round = roundWith([{ id: 'a', x: 4.5, y: 3, sim: false }], { maze });
    round.spawn({ id: 'a', n: 1, x: x0, y: y0, a, k: 'N', at: 0 }, 0);
    const s = round.shots[0];
    const T = 8.5; // under the 9 s life
    for (let t = 0; t < T - 1e-9; t += STEP) round.step(STEP);
    assert.ok(!s.dead, 'still flying');
    const v = SHOT.speed;
    const ex = fold(x0, v * Math.cos(a), s.age, lo(r), COLS - lo(r));
    const ey = fold(y0, v * Math.sin(a), s.age, lo(r), ROWS - lo(r));
    worst = Math.max(worst, Math.abs(s.x - ex), Math.abs(s.y - ey));
    assert.ok(s.bounces >= 2);
    assert.ok(Math.abs(Math.hypot(s.dx, s.dy) - 1) < 1e-9);
  }
  assert.ok(worst < 1e-5, `the path drifted ${worst} from the exact reflection`);
});

test('the same shot gives the same path whatever the step sizes (frame rates)', () => {
  const maze = makeMaze(31);
  const spec = { id: 'a', n: 1, x: 4.5, y: 2.5, a: 0.7, k: 'N', at: 0 };
  const paths = [];
  for (const mode of ['60', '30', 'mixed', '144']) {
    const round = roundWith([{ id: 'z', x: 0.5, y: 0.5, sim: false }], { maze });
    round.spawn({ ...spec }, 0);
    const rng = mulberry32(5);
    let t = 0;
    while (t < 6 - 1e-9) {
      let dt = mode === '60' ? 1 / 60 : mode === '30' ? 1 / 30 : mode === '144' ? 1 / 144 : 1 / 240 + rng() / 40;
      dt = Math.min(dt, 6 - t);
      round.step(dt);
      t += dt;
    }
    const s = round.shots[0];
    paths.push([s.x, s.y, s.dx, s.dy, s.bounces, s.age]);
  }
  for (const p of paths.slice(1)) {
    assert.equal(p[4], paths[0][4], 'same number of bounces');
    assert.ok(near(p[0], paths[0][0], 1e-4) && near(p[1], paths[0][1], 1e-4), `position ${p[0]},${p[1]} vs ${paths[0][0]},${paths[0][1]}`);
  }
});

test('two pages agree: a shot that arrives late is brought up to date to where the shooter sees it', () => {
  for (const seed of [3, 4, 5, 6, 7, 8]) {
    const maze = makeMaze(seed);
    // (nobody is decided about on either page: only the paths are compared)
    const shooter = roundWith([{ id: 'a', x: 1.5, y: 1.5, a: 0.4, sim: false }, { id: 'b', x: 7.5, y: 4.5, sim: false }], { maze });
    const viewer = roundWith([{ id: 'a', x: 1.5, y: 1.5, a: 0.4, sim: false }, { id: 'b', x: 7.5, y: 4.5, sim: false }], { maze });
    let spec = null;
    shooter.hooks.fire = (s) => (spec = s);
    shooter.fireNormal(shooter.byId.get('a'));
    // the viewer hears of it 90 ms later (its own clock is 90 ms on)
    run(shooter, 0.09);
    run(viewer, 0.09);
    assert.ok(spec, 'it fired');
    assert.ok(viewer.remoteFire({ ...spec }), 'the viewer took it in');
    run(shooter, 2);
    run(viewer, 2);
    const a = shooter.shots[0];
    const b = viewer.shots[0];
    assert.ok(a && b);
    assert.equal(a.key, b.key);
    assert.ok(near(a.x, b.x, 2e-3) && near(a.y, b.y, 2e-3), `seed ${seed}: ${a.x},${a.y} vs ${b.x},${b.y}`);
    assert.equal(a.bounces, b.bounces);
  }
});

test('a shot lives 9 seconds and is then gone; a repeated message does not make a second shot', () => {
  const round = roundWith([{ id: 'a', x: 4.5, y: 3, sim: false }], { maze: openMaze() });
  const spec = { id: 'a', n: 1, x: 3, y: 2, a: 0.5, k: 'N', at: 0 };
  assert.ok(round.remoteFire(spec));
  assert.equal(round.remoteFire(spec), false);
  assert.equal(round.shots.length, 1);
  run(round, 8.9);
  assert.equal(round.shots.length, 1);
  run(round, 0.2);
  assert.equal(round.shots.length, 0);
});

test('fire: 0.18 s apart, never more than 5 shots in flight, and holding fire keeps firing', () => {
  const round = roundWith([{ id: 'a', x: 4.5, y: 3, a: 0, sim: true }], { maze: openMaze() });
  const k = round.byId.get('a');
  const times = [];
  round.hooks.fire = () => times.push(round.t);
  // taps faster than the cooldown: the first goes at once, the next waits for the cooldown
  k.inp.edge = true;
  round.step(STEP);
  k.inp.edge = true;
  round.step(STEP);
  assert.equal(times.length, 1);
  run(round, 0.3);
  assert.ok(times.length <= 2);
  // hold fire for 4 s in a box: the shots pile up to 5 and no further
  k.inp.fire = true;
  let most = 0;
  for (let i = 0; i < 240; i++) {
    round.step(STEP);
    most = Math.max(most, round.liveCount('a', 'N'));
  }
  assert.equal(most, 5);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 179, `shots ${times[i] - times[i - 1]} ms apart`);
});

test('a shot kills the tank it hits, its owner included, once it has bounced back; shots only hurt tanks this page decides', () => {
  // a box: shoot at the right wall; the bounce comes straight back to the shooter
  const round = roundWith([{ id: 'a', x: 6, y: 3, a: 0, sim: true }], { maze: openMaze() });
  let death = null;
  round.hooks.dead = (k, info) => (death = { id: k.id, ...info });
  const k = round.byId.get('a');
  k.inp.edge = true;
  run(round, 3);
  assert.ok(death, 'the shooter was hit by its own shot');
  assert.equal(death.id, 'a');
  assert.equal(death.by, 'a');
  assert.equal(death.b, 1);
  assert.equal(death.local, true);
  assert.equal(round.shots.length, 0, 'the shot that hit is spent');
  // a tank that is only a copy is not hurt here
  const r2 = roundWith([{ id: 'a', x: 2, y: 3, a: 0, sim: true }, { id: 'b', x: 5, y: 3, a: 0, sim: false }], { maze: openMaze() });
  let hurt = false;
  r2.hooks.dead = (t) => (hurt = hurt || t.id === 'b');
  r2.byId.get('a').inp.edge = true;
  run(r2, 1.5);
  assert.ok(!hurt && r2.byId.get('b').alive);
});

test('a shot cannot start inside a wall: pressed against it the tank only fizzles', () => {
  const round = roundWith([{ id: 'a', x: 8.5, y: 3, a: 0, sim: true }], { maze: openMaze() });
  const k = round.byId.get('a');
  // drive into the right wall
  k.inp.thr = 1;
  run(round, 1.5);
  k.inp.thr = 0;
  assert.ok(!round.muzzleFree(k));
  let fizzled = 0;
  let fired = 0;
  round.hooks.fizzle = () => fizzled++;
  round.hooks.fire = () => fired++;
  k.inp.edge = true;
  run(round, 0.3);
  assert.equal(fired, 0);
  assert.ok(fizzled >= 1);
  assert.equal(round.shots.length, 0);
  assert.equal(round.byId.get('a').alive, true);
});

test('shots never leave the maze or end up inside a wall (300 shots, random angles, many mazes)', () => {
  const rng = mulberry32(2024);
  for (const seed of [1, 2, 3, 4, 5]) {
    const maze = makeMaze(seed);
    const round = roundWith([{ id: 'z', x: 0.5, y: 0.5, sim: false }], { maze });
    for (let i = 0; i < 60; i++) {
      // from the middle of a random cell, in a random direction
      const cx = Math.floor(rng() * COLS);
      const cy = Math.floor(rng() * ROWS);
      round.spawn({ id: 'z', n: i + 1, x: cx + 0.5, y: cy + 0.5, a: rng() * 6.28, k: i % 3 === 0 ? 'G' : 'N', at: 0 }, 0);
    }
    for (let t = 0; t < 10 * 60; t++) {
      round.step(STEP);
      for (const s of round.shots) {
        assert.ok(s.x > 0 && s.x < COLS && s.y > 0 && s.y < ROWS, `shot at ${s.x}, ${s.y}`);
        assert.ok(Number.isFinite(s.dx) && Number.isFinite(s.dy));
      }
    }
    assert.equal(round.stuckShots, 0);
  }
});

test('the muzzle is where the barrel ends and the tank is the size of the spec', () => {
  assert.equal(TANK.hl * 2, 0.42);
  assert.equal(TANK.hw * 2, 0.32);
  assert.ok(TANK.muzzle > TANK.hl + 0.05);
  assert.equal(SHOT.speed, 3.2);
  assert.equal(SHOT.life, 9);
  assert.equal(SHOT.max, 5);
  assert.equal(SHOT.cd, 0.18);
});
