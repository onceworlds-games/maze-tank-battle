import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../game/match.js';
import { CRATE, STEP, WEAPON } from '../game/rules.js';
import { angDiff } from '../game/geom.js';
import { near, openMaze, roundWith, run, splitMaze } from './helpers.mjs';

function track(round) {
  const log = { dead: [], fire: [], boom: [], claim: [], pop: 0 };
  round.hooks.dead = (k, info) => log.dead.push({ id: k.id, ...info });
  round.hooks.fire = (spec, k, local) => log.fire.push({ ...spec, local });
  round.hooks.boom = (m, local) => log.boom.push({ key: m.key, local });
  round.hooks.claim = (k, c) => log.claim.push({ id: k.id, n: c.n, kind: c.kind });
  round.hooks.pop = () => log.pop++;
  return log;
}

test('laser: one instant beam, four bounces, and it kills whatever it crosses, its owner on the way back included', () => {
  const round = roundWith(
    [
      { id: 'a', x: 2, y: 3, a: 0 },
      { id: 'b', x: 6, y: 3, a: 0 },
    ],
    { maze: openMaze() },
  );
  const log = track(round);
  const a = round.byId.get('a');
  a.weapon = { k: 'L', ammo: 1 };
  a.inp.edge = true;
  round.step(STEP);
  assert.equal(round.beams.length, 1);
  const pts = round.beams[0].pts;
  assert.equal(pts.length, 2 + 5 * 2, 'a start and five ends: four bounces');
  assert.ok(near(pts[2], 9 - 0.055 - 0.01, 1e-9), 'the first end is on the wall');
  assert.ok(near(pts[3], 3, 1e-9));
  assert.equal(a.weapon, null, 'the power-up is used up');
  assert.equal(log.fire[0].k, 'L');
  assert.deepEqual(log.dead.map((d) => d.id).sort(), ['a', 'b']);
  const bd = log.dead.find((d) => d.id === 'b');
  assert.equal(bd.by, 'a');
  assert.equal(bd.b, 0);
  const ad = log.dead.find((d) => d.id === 'a');
  assert.equal(ad.by, 'a');
  assert.equal(ad.b, 1, 'its owner on the bounce back');
  // the beam fades and is gone
  run(round, 0.7);
  assert.equal(round.beams.length, 0);
});

test('laser: a wall stops it (it comes back off the wall), and a tank behind a wall is safe', () => {
  const round = roundWith(
    [
      { id: 'a', x: 3, y: 3, a: 0 },
      { id: 'b', x: 7, y: 3, a: 0 },
    ],
    { maze: splitMaze() },
  );
  const log = track(round);
  const a = round.byId.get('a');
  a.weapon = { k: 'L', ammo: 1 };
  a.inp.edge = true;
  round.step(STEP);
  assert.deepEqual(log.dead.map((d) => d.id), ['a']);
  assert.ok(round.byId.get('b').alive);
});

test('shotgun: five pellets fanned over +-0.3 rad, fast and short-lived', () => {
  const round = roundWith([{ id: 'a', x: 2, y: 1, a: 0.5 }], { maze: openMaze() });
  const a = round.byId.get('a');
  a.weapon = { k: 'S', ammo: 1 };
  a.inp.edge = true;
  round.step(STEP);
  const pellets = round.shots.filter((s) => s.k === 'S');
  assert.equal(pellets.length, 5);
  const angs = pellets.map((s) => angDiff(Math.atan2(s.dy, s.dx), 0.5)).sort((x, y) => x - y);
  [-0.3, -0.15, 0, 0.15, 0.3].forEach((v, i) => assert.ok(near(angs[i], v, 0.03), `pellet ${i}: ${angs[i]}`));
  assert.equal(pellets[0].speed, WEAPON.S.speed);
  assert.ok(WEAPON.S.speed > 3.2);
  run(round, 0.9);
  assert.equal(round.shots.length, 0, 'gone after under a second');
  assert.equal(a.weapon, null);
});

test('gatling: 20 shots in 2 seconds while fire is held, then back to normal; letting go keeps what is left', () => {
  const round = roundWith([{ id: 'a', x: 1, y: 3, a: 0 }], { maze: openMaze() });
  const a = round.byId.get('a');
  const times = [];
  round.hooks.fire = (spec) => times.push({ k: spec.k, t: round.t });
  a.weapon = { k: 'G', ammo: 20 };
  a.inp.fire = true;
  run(round, 0.55);
  a.inp.fire = false;
  const so = times.length;
  assert.ok(so >= 5 && so <= 7, `${so} shots in the first half second`);
  assert.equal(a.weapon.ammo, 20 - so);
  run(round, 1);
  assert.equal(times.length, so, 'nothing while fire is let go');
  a.inp.fire = true;
  run(round, 3);
  const g = times.filter((x) => x.k === 'G');
  assert.equal(g.length, 20);
  assert.equal(a.weapon, null);
  assert.ok(g[19].t - g[so].t >= 1290 && g[19].t - g[so].t < 1600, `the rest took ${g[19].t - g[so].t} ms`);
  // 20 shots, 2 s of holding fire: the spacing is a tenth of a second
  const hold = [];
  for (let i = 1; i < g.length; i++) if (g[i].t - g[i - 1].t < 400) hold.push(g[i].t - g[i - 1].t);
  assert.ok(hold.every((d) => d >= 95 && d <= 125), `gaps ${hold}`);
});

test('mine: armed after a second, barely visible, and it takes whoever touches it, its owner too, but not through a wall', () => {
  const round = roundWith(
    [
      { id: 'a', x: 2, y: 3, a: 0 },
      { id: 'b', x: 2.6, y: 3, a: 0, sim: false }, // 0.6 from the mine: inside the blast, but only a copy here
    ],
    { maze: splitMaze() },
  );
  const log = track(round);
  const a = round.byId.get('a');
  a.weapon = { k: 'M', ammo: 1 };
  a.inp.edge = true;
  round.step(STEP);
  assert.equal(round.mines.length, 1);
  const m = round.mines[0];
  assert.ok(near(m.x, 1.7, 0.01) && near(m.y, 3), 'dropped behind the tank');
  assert.equal(m.armed, false);
  // standing next to it for a while changes nothing until it arms
  run(round, 0.9);
  assert.equal(round.mines.length, 1);
  // drive back onto it: now it goes off, and the tank on top of it is the one that dies here
  a.inp.thr = -1;
  run(round, 0.6);
  assert.equal(log.boom.length, 1);
  assert.equal(log.boom[0].local, true, 'this page set it off and says so');
  assert.deepEqual(log.dead.map((d) => d.id), ['a']);
  assert.equal(log.dead[0].by, 'a');
  assert.equal(round.mines.length, 0);
  assert.ok(round.byId.get('b').alive, 'a copy is decided on its own page');
  // a mine's blast does not go through a wall: c is in the open 0.5 away, b is 0.6 away on the other side of the dividing wall
  const r2 = roundWith(
    [
      { id: 'a', x: 1, y: 3, a: 0 },
      { id: 'b', x: 5.3, y: 3, a: 0 },
      { id: 'c', x: 4.2, y: 3, a: 0 },
    ],
    { maze: splitMaze() },
  );
  const l2 = track(r2);
  r2.spawn({ id: 'a', n: 1, x: 4.7, y: 3, a: 0, k: 'M', at: 0 }, 1.2);
  assert.ok(r2.remoteBoom('a.1'));
  assert.deepEqual(l2.dead.map((d) => d.id), ['c']);
});

test('mine: a boom from another page takes the tanks this page decides about that are in the open', () => {
  const round = roundWith(
    [
      { id: 'a', x: 6, y: 3, a: 0, sim: false },
      { id: 'b', x: 6.5, y: 3, a: 0, sim: true },
      { id: 'c', x: 8.5, y: 3, a: 0, sim: true },
    ],
    { maze: openMaze() },
  );
  const log = track(round);
  round.remoteFire({ id: 'a', n: 1, x: 6, y: 3, a: 0, k: 'M', at: 0 });
  assert.equal(round.mines.length, 1);
  assert.ok(round.remoteBoom('a.1'));
  assert.deepEqual(log.dead.map((d) => d.id), ['b']);
  assert.equal(log.dead[0].by, 'a');
  assert.equal(log.dead[0].local, true);
  assert.equal(log.boom[0].local, false, 'it was told about, so it does not tell again');
  assert.equal(round.remoteBoom('a.1'), false);
});

test('missile: slow, follows the nearest other tank after a second, and a shot can bring it down', () => {
  const round = roundWith(
    [
      { id: 'a', x: 2, y: 1, a: 0 },
      { id: 'b', x: 5, y: 5, a: 0, sim: true },
    ],
    { maze: openMaze() },
  );
  const log = track(round);
  const a = round.byId.get('a');
  a.weapon = { k: 'H', ammo: 1 };
  a.inp.edge = true;
  round.step(STEP);
  const m = round.shots.find((s) => s.k === 'H');
  assert.ok(m && m.speed < 3.2);
  run(round, 0.9);
  assert.ok(near(Math.atan2(m.dy, m.dx), 0, 1e-6), 'straight for the first second');
  run(round, 0.6);
  assert.ok(Math.atan2(m.dy, m.dx) > 0.2, 'then it turns towards b');
  run(round, 8);
  assert.ok(log.dead.some((d) => d.id === 'b' && d.by === 'a'), 'and gets it');
  // shot down
  const r2 = roundWith(
    [
      { id: 'a', x: 1, y: 3, a: 0 },
      { id: 'c', x: 8, y: 5, a: 0, sim: true },
    ],
    { maze: openMaze() },
  );
  const l2 = track(r2);
  r2.spawn({ id: 'z', n: 1, x: 4, y: 3, a: Math.PI, k: 'H', at: 0 }, 0);
  r2.byId.get('c').x = 8;
  r2.spawn({ id: 'a', n: 2, x: 1.4, y: 3, a: 0, k: 'N', at: 0 }, 0);
  run(r2, 1.5);
  assert.equal(r2.shots.length, 0, 'the missile and the shot are both gone');
  assert.equal(l2.pop, 1);
});

test('crates: one every 6-10 s, never more than two, taking one lifts it off the floor and arms the tank', () => {
  const roster = [{ id: 'a', bot: 0, c: 0 }, { id: 'b', bot: 1, n: 'Nova', c: 1 }];
  const m = new Match({ mid: 'm', by: 'a', seed: 5, goal: 5, roster, now: 0 });
  let now = 0;
  const born = [];
  let seen = 0;
  for (; now < 200000; now += 100) {
    m.tick(now, { positions: [] });
    if (m.g.phase !== 'play') continue;
    assert.ok(m.g.cr.length <= CRATE.max);
    if (m.g.cn > seen) {
      seen = m.g.cn;
      born.push(m.playMs(now));
    }
    // keep the round going: nobody dies
    m.g.until = now + 1e9;
    if (born.length >= 2 && m.g.cr.length === 2 && m.playMs(now) > 40000) break;
  }
  assert.ok(born[0] >= 3000 && born[0] <= 6100, `first at ${born[0]}`);
  assert.ok(born[1] - born[0] >= 5900 && born[1] - born[0] <= 10100, `second ${born[1] - born[0]} later`);
  assert.equal(born.length, 2, 'a full floor stays at two');
  const [n, cx, cy, kind] = m.g.cr[0];
  assert.ok(cx >= 0 && cx < 9 && cy >= 0 && cy < 6 && 'LSGMH'.includes(kind));
  assert.equal(m.claim('a', n), kind);
  assert.equal(m.claim('b', n), '', 'it is gone');
  assert.equal(m.g.cr.length, 1);

  // the Round hands the tank its power-up once, and only a tank that has none
  const round = roundWith([{ id: 'a', x: cx + 0.5, y: cy + 0.5, a: 0 }], { maze: openMaze() });
  const log = track(round);
  round.setCrates([[7, cx, cy, 'L']]);
  round.step(STEP);
  assert.equal(log.claim.length, 1);
  assert.equal(round.byId.get('a').weapon.k, 'L');
  round.step(STEP);
  assert.equal(log.claim.length, 1);
  const r3 = roundWith([{ id: 'a', x: 3.5, y: 3.5, a: 0 }], { maze: openMaze() });
  r3.byId.get('a').weapon = { k: 'S', ammo: 1 };
  r3.setCrates([[8, 3, 3, 'L']]);
  r3.step(STEP);
  assert.equal(r3.byId.get('a').weapon.k, 'S', 'a tank with a power-up leaves the crate');
});
