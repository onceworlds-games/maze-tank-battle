// Bots. They drive like people do: tank controls (turn and drive), a reaction time, a limited eye for angles and a different
// skill each. To shoot they try angles every few degrees and follow each one through up to three bounces (four for a laser),
// firing when a path hits a tank and doesn't come back through themselves. To get there they walk the maze cell by cell
// (breadth-first search). To live they watch every shot in flight and step out of the way of any that will pass within a
// moment. Pure: it only reads the Round and writes the tank's `inp`.

import { angDiff, castRects, insideRects, pointSegDist2, reflect, segObb } from './geom.js';
import { DIRS, cellAt, distTo, isOpen, nextCell } from './maze.js';
import { SHOT, TANK, WEAPON, clamp } from './rules.js';

const DEG = Math.PI / 180;
const HIT = { t: 0, nx: 0, ny: 0 };
const RF = [0, 0];
const SOL = { e: null, len: 0, b: 0 };
const HORIZON = 0.8; // seconds of a shot's path looked at for danger

export function newAI(rng, idx) {
  const skill = 0.3 + rng() * 0.6;
  return {
    rng,
    idx,
    skill,
    react: 0.75 - skill * 0.5 + rng() * 0.1, // seconds before it answers something it has just noticed
    res: skill > 0.8 ? 3 : skill > 0.55 ? 5 : 7, // degrees between the angles it tries
    maxB: skill > 0.85 ? 3 : skill > 0.6 ? 2 : 1, // bounces it will plan a shot with
    reach: 2.5 + skill * 4.5, // cells a planned shot may travel
    warm: 2.4 + rng() * 3, // seconds it spends getting its bearings before it hunts
    scootUntil: 0,
    scootA: 0,
    phase: rng() * 7,
    clock: 0,
    think: rng() * 0.15,
    sol: null, // { a, e, b, len } the shot it is about to take
    hadSol: false,
    fireAt: 0,
    cool: 0,
    goalX: 0,
    goalY: 0,
    goalCell: -1,
    haveGoal: false,
    wanderAt: 0,
    dodgeUntil: 0,
    dodgeA: 0,
    seen: new Map(),
    probeAt: 0,
    probeX: 0,
    probeY: 0,
    unstick: 0,
    unstickDir: 1,
    hadWeapon: '',
    gotAt: 0,
    mineWait: 0,
  };
}

/** One tick of thinking for bot tank `k` of `round`: fills k.inp. */
export function think(round, k, dt) {
  const ai = k.ai;
  ai.clock += dt;
  if (ai.cool > 0) ai.cool = Math.max(0, ai.cool - dt);
  ai.think -= dt;
  if (ai.think <= 0) {
    ai.think = 0.09 + ai.rng() * 0.05;
    decide(round, k, ai);
  }
  act(round, k, ai);
}

// ---------------------------------------------------------------------------------------------------------------- deciding
function decide(round, k, ai) {
  const wk = k.weapon ? k.weapon.k : '';
  if (wk !== ai.hadWeapon) {
    ai.hadWeapon = wk;
    ai.gotAt = ai.clock;
  }
  // stuck? (it means to be going somewhere and hasn't moved)
  if (ai.clock >= ai.probeAt) {
    const moved = Math.hypot(k.x - ai.probeX, k.y - ai.probeY);
    if (ai.probeAt > 0 && moved < 0.05 && ai.haveGoal && !ai.sol && ai.clock >= ai.unstick) {
      ai.unstick = ai.clock + 0.5;
      ai.unstickDir = ai.rng() < 0.5 ? -1 : 1;
    }
    ai.probeAt = ai.clock + 0.8;
    ai.probeX = k.x;
    ai.probeY = k.y;
  }

  // 1. danger comes first
  const away = findThreat(round, k, ai);
  if (away !== null) {
    ai.dodgeUntil = ai.clock + 0.45;
    ai.dodgeA = away;
    ai.sol = null;
    ai.hadSol = false;
    return;
  }
  if (ai.clock < ai.dodgeUntil) return;

  const enemies = [];
  for (const e of round.tanks) if (e.alive && e !== k) enemies.push(e);
  ai.sol = null;
  ai.haveGoal = false;
  if (ai.clock < ai.scootUntil) return;
  if (!enemies.length) {
    wander(round, k, ai);
    return;
  }

  // 2. a shot to take
  if (wk === 'M') {
    // a mine goes down some seconds after it is picked up, wherever the bot happens to be
    if (ai.clock - ai.gotAt > 1.5 + ai.rng() * 2) ai.sol = { a: k.a, e: null, b: 0, len: 0, drop: true };
  } else if (wk === 'H') {
    // a missile finds its own way: let it go down a corridor
    if (ai.clock - ai.gotAt > 0.5 + ai.react && round.muzzleFree(k) && !castRects(round.rc, round.nrc, k.x, k.y, Math.cos(k.a), Math.sin(k.a), 0.9, 0.1, HIT)) ai.sol = { a: k.a, e: null, b: 0, len: 0, drop: true };
  } else if (ai.clock >= ai.warm) {
    const maxB = wk === 'L' ? WEAPON.L.bounces : wk === 'S' ? 0 : ai.maxB;
    const maxLen = wk === 'S' ? 3.3 : wk === 'L' ? 60 : ai.reach;
    if (findSolution(round, k, ai, enemies, maxB, maxLen)) {
      ai.sol = { a: SOL.a, e: SOL.e, b: SOL.b, len: SOL.len, drop: false };
      if (!ai.hadSol) ai.fireAt = ai.clock + ai.react * (0.6 + ai.rng() * 0.8);
      ai.hadSol = true;
    } else ai.hadSol = false;
  }
  if (ai.sol) return;

  // 3. somewhere to go: a crate close by, else the nearest enemy
  const here = cellAt(round.maze, k.x, k.y);
  if (!k.weapon && round.crates.length) {
    let bc = null;
    let bd = 6;
    for (const c of round.crates) {
      if (round.claimed.has(c.n)) continue;
      const d = distTo(round.maze, here)[cellAt(round.maze, c.x, c.y)];
      if (d >= 0 && d < bd) {
        bd = d;
        bc = c;
      }
    }
    if (bc) {
      goTo(round, k, ai, cellAt(round.maze, bc.x, bc.y), bc.x, bc.y);
      return;
    }
  }
  let best = null;
  let bd = Infinity;
  for (const e of enemies) {
    const d = distTo(round.maze, here)[cellAt(round.maze, e.x, e.y)];
    if (d >= 0 && d < bd) {
      bd = d;
      best = e;
    }
  }
  if (best) goTo(round, k, ai, cellAt(round.maze, best.x, best.y), best.x, best.y);
  else wander(round, k, ai);
}

function wander(round, k, ai) {
  const m = round.maze;
  if (ai.clock >= ai.wanderAt || ai.goalCell < 0) {
    ai.wanderAt = ai.clock + 3 + ai.rng() * 3;
    ai.goalCell = Math.floor(ai.rng() * m.cols * m.rows);
  }
  goTo(round, k, ai, ai.goalCell, (ai.goalCell % m.cols) + 0.5, ((ai.goalCell / m.cols) | 0) + 0.5);
}

/** Aim for the middle of the next cell on the way to `cell`; keep to the middle of the corridor on the way there. */
function goTo(round, k, ai, cell, px, py) {
  const m = round.maze;
  const from = cellAt(m, k.x, k.y);
  const nxt = round.mines.length ? nextAvoiding(round, from, cell) : nextCell(m, from, cell);
  ai.haveGoal = true;
  if (nxt === from) {
    ai.goalX = px;
    ai.goalY = py;
    return;
  }
  const fx = from % m.cols;
  const fy = (from / m.cols) | 0;
  const nx = nxt % m.cols;
  const ny = (nxt / m.cols) | 0;
  const dx = nx - fx;
  const dy = ny - fy;
  const cx = fx + 0.5;
  const cy = fy + 0.5;
  const lat = dx !== 0 ? k.y - cy : k.x - cx;
  const along = dx !== 0 ? (k.x - cx) * dx : (k.y - cy) * dy;
  if (Math.abs(lat) > 0.12 && along < 0.35) {
    // back onto the line through the cells' middles while still moving along it
    ai.goalX = dx !== 0 ? k.x + dx * 0.4 : cx;
    ai.goalY = dx !== 0 ? cy : k.y + dy * 0.4;
  } else {
    ai.goalX = nx + 0.5;
    ai.goalY = ny + 0.5;
  }
}

/** The next cell towards `to`, going round any cell that holds a mine. */
function nextAvoiding(round, from, to) {
  const m = round.maze;
  const blocked = new Set();
  for (const mn of round.mines) if (!mn.dead) blocked.add(cellAt(m, mn.x, mn.y));
  blocked.delete(from);
  if (!blocked.size || blocked.has(to)) return nextCell(m, from, to);
  const d = new Int16Array(m.cols * m.rows).fill(-1);
  const q = [to];
  d[to] = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    const cx = c % m.cols;
    const cy = (c / m.cols) | 0;
    for (let i = 0; i < 4; i++) {
      if (!isOpen(m, cx, cy, i)) continue;
      const n = (cy + DIRS[i][1]) * m.cols + cx + DIRS[i][0];
      if (d[n] < 0 && !blocked.has(n)) {
        d[n] = d[c] + 1;
        q.push(n);
      }
    }
  }
  if (d[from] < 0) return nextCell(m, from, to);
  const fx = from % m.cols;
  const fy = (from / m.cols) | 0;
  let best = from;
  let bd = d[from];
  for (let i = 0; i < 4; i++) {
    if (!isOpen(m, fx, fy, i)) continue;
    const n = (fy + DIRS[i][1]) * m.cols + fx + DIRS[i][0];
    if (d[n] >= 0 && d[n] < bd) {
      bd = d[n];
      best = n;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------- shooting
/**
 * Try angles all the way round. Writes the best into SOL ({ a, e, b, len }): the cheapest path (length plus a cost per bounce)
 * that ends in an enemy without crossing the bot itself on the way. Direct shots lead a moving target a little.
 */
function findSolution(round, k, ai, enemies, maxB, maxLen) {
  let bestCost = Infinity;
  let ba = 0;
  let be = null;
  let bb = 0;
  let bl = 0;
  for (let deg = ai.phase; deg < 360 + ai.phase; deg += ai.res) {
    const a = deg * DEG;
    if (!trace(round, k, a, maxB, maxLen, enemies)) continue;
    const cost = SOL.len + SOL.b * 0.8;
    if (cost < bestCost) {
      bestCost = cost;
      ba = a;
      be = SOL.e;
      bb = SOL.b;
      bl = SOL.len;
    }
  }
  if (!be) return false;
  let a = ba;
  if (bb === 0) {
    // lead the target: aim where it will be when the shot gets there
    const t = bl / SHOT.speed;
    const px = be.x + clamp(be.vx * t, -0.45, 0.45);
    const py = be.y + clamp(be.vy * t, -0.45, 0.45);
    const mx = k.x + Math.cos(ba) * TANK.muzzle;
    const my = k.y + Math.sin(ba) * TANK.muzzle;
    const d = Math.hypot(px - mx, py - my);
    if (d > 0.2 && !castRects(round.rc, round.nrc, mx, my, (px - mx) / d, (py - my) / d, d, SHOT.r, HIT)) a = Math.atan2(py - k.y, px - k.x);
  }
  // a bot never aims perfectly
  a += (ai.rng() - 0.5) * 2 * (1 - ai.skill) * 0.12;
  SOL.a = a;
  SOL.e = be;
  SOL.b = bb;
  SOL.len = bl;
  return true;
}

/** Follow a shot fired at angle a: true (and SOL.e, SOL.len, SOL.b set) when it ends in an enemy before it can come back through the bot. */
function trace(round, k, a, maxB, maxLen, enemies) {
  const rc = round.rc;
  const n = round.nrc;
  let dx = Math.cos(a);
  let dy = Math.sin(a);
  let x = k.x + dx * TANK.muzzle;
  let y = k.y + dy * TANK.muzzle;
  if (insideRects(rc, n, x, y, SHOT.r + 0.004)) return false;
  let len = 0;
  const grow = SHOT.r + 0.03;
  for (let b = 0; b <= maxB; b++) {
    const wall = castRects(rc, n, x, y, dx, dy, 60, SHOT.r, HIT);
    const seg = wall ? HIT.t : 60;
    const ex = x + dx * seg;
    const ey = y + dy * seg;
    let bt = Infinity;
    let be = null;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const t = segObb(x, y, ex, ey, e.x, e.y, e.a, TANK.hl + grow, TANK.hw + grow);
      if (t >= 0 && t < bt) {
        bt = t;
        be = e;
      }
    }
    if (b >= 1) {
      const ts = segObb(x, y, ex, ey, k.x, k.y, a, TANK.hl + SHOT.r + 0.03, TANK.hw + SHOT.r + 0.03);
      if (ts >= 0 && ts <= bt) return false;
    }
    if (be) {
      SOL.e = be;
      SOL.len = len + bt * seg;
      SOL.b = b;
      return SOL.len <= maxLen;
    }
    if (!wall || len + seg > maxLen) return false;
    len += seg;
    reflect(dx, dy, HIT.nx, HIT.ny, RF);
    dx = RF[0];
    dy = RF[1];
    x = ex + HIT.nx * 1e-6;
    y = ey + HIT.ny * 1e-6;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------- dodging
/** If a shot in flight will pass close within a moment (and the bot has noticed it), the angle to run at; else null. */
function findThreat(round, k, ai) {
  const rc = round.rc;
  const n = round.nrc;
  let best = null;
  let bestEta = Infinity;
  const live = new Set();
  for (const s of round.shots) {
    if (s.dead) continue;
    live.add(s.key);
    if (s.id === k.id && s.age < 0.3) continue; // it is only just leaving the barrel
    const reach = 0.3 + s.r + (s.k === 'H' ? 0.15 : 0);
    let x = s.x;
    let y = s.y;
    let dx = s.dx;
    let dy = s.dy;
    let left = s.speed * HORIZON;
    let travelled = 0;
    for (let b = 0; b <= 3 && left > 1e-6; b++) {
      const wall = castRects(rc, n, x, y, dx, dy, left, s.r, HIT);
      const seg = wall ? HIT.t : left;
      const ex = x + dx * seg;
      const ey = y + dy * seg;
      if (pointSegDist2(k.x, k.y, x, y, ex, ey) < reach * reach) {
        const along = Math.max(0, (k.x - x) * dx + (k.y - y) * dy);
        const eta = (travelled + Math.min(along, seg)) / s.speed;
        if (eta < bestEta) {
          bestEta = eta;
          best = { dx, dy, key: s.key };
        }
        break;
      }
      if (!wall) break;
      reflect(dx, dy, HIT.nx, HIT.ny, RF);
      dx = RF[0];
      dy = RF[1];
      x = ex + HIT.nx * 1e-6;
      y = ey + HIT.ny * 1e-6;
      travelled += seg;
      left -= seg;
    }
  }
  // forget shots that are gone
  if (ai.seen.size > 40) for (const key of ai.seen.keys()) if (!live.has(key)) ai.seen.delete(key);
  if (!best) return null;
  const first = ai.seen.get(best.key);
  if (first === undefined) ai.seen.set(best.key, ai.clock);
  if (ai.clock - (first === undefined ? ai.clock : first) < ai.react * 0.7) return null;
  // step sideways, to the side with more room
  const p1x = -best.dy;
  const p1y = best.dx;
  const f1 = room(round, k, p1x, p1y);
  const f2 = room(round, k, -p1x, -p1y);
  if (f1 < 0.25 && f2 < 0.25) return Math.atan2(best.dy, best.dx); // boxed in: run the way it is going
  return f1 >= f2 ? Math.atan2(p1y, p1x) : Math.atan2(-p1y, -p1x);
}

/** How far the tank could go in a direction before a wall (up to 0.8). */
function room(round, k, dx, dy) {
  return castRects(round.rc, round.nrc, k.x, k.y, dx, dy, 0.8, 0.1, HIT) ? HIT.t : 0.8;
}

// ---------------------------------------------------------------------------------------------------------------- acting
function steer(k, inp, target, allowReverse) {
  let err = angDiff(target, k.a);
  let rev = false;
  if (allowReverse && Math.abs(err) > 2.0) {
    err = angDiff(target + Math.PI, k.a);
    rev = true;
  }
  inp.turn = clamp(err / 0.12, -1, 1);
  const c = Math.cos(err);
  const thr = c > 0.25 ? (c > 0.85 ? 1 : 0.55) : 0;
  inp.thr = rev ? -thr : thr;
}

function act(round, k, ai) {
  actOrders(round, k, ai);
  if (round.mines.length) guardMines(round, k, k.inp);
}

/** Never drive onto a mine, theirs or a stranger's: back away when close, and stop rather than drive at one. */
function guardMines(round, k, inp) {
  let near = null;
  let nd = 0.9;
  for (const m of round.mines) {
    if (m.dead) continue;
    const d = Math.hypot(m.x - k.x, m.y - k.y);
    if (d < nd) {
      nd = d;
      near = m;
    }
  }
  if (!near) return;
  if (nd < 0.55) {
    steer(k, inp, Math.atan2(k.y - near.y, k.x - near.x), true);
    return;
  }
  const dir = inp.thr >= 0 ? 1 : -1;
  const lx = k.x + Math.cos(k.a) * 0.35 * dir;
  const ly = k.y + Math.sin(k.a) * 0.35 * dir;
  if (inp.thr !== 0 && Math.hypot(near.x - lx, near.y - ly) < nd) inp.thr = 0;
}

function actOrders(round, k, ai) {
  const inp = k.inp;
  inp.edge = false;
  inp.fire = false;
  inp.aim = null;
  inp.mag = 0;
  inp.turn = 0;
  inp.thr = 0;
  if (ai.clock < ai.unstick) {
    inp.thr = -1;
    inp.turn = ai.unstickDir;
    return;
  }
  if (ai.clock < ai.dodgeUntil) {
    steer(k, inp, ai.dodgeA, true);
    return;
  }
  if (ai.clock < ai.scootUntil) {
    steer(k, inp, ai.scootA, true);
    return;
  }
  const sol = ai.sol;
  if (sol) {
    if (sol.drop) {
      // a mine or a missile: let it go, and carry on
      inp.edge = true;
      ai.sol = null;
      return;
    }
    const err = angDiff(sol.a, k.a);
    inp.turn = clamp(err / 0.12, -1, 1);
    const tol = 0.035 + (1 - ai.skill) * 0.03;
    if (Math.abs(err) < tol && ai.clock >= ai.fireAt) {
      const wk = k.weapon ? k.weapon.k : '';
      if (wk === 'G') inp.fire = true;
      else if (wk) inp.edge = true;
      else if (ai.cool <= 0 && round.liveCount(k.id, 'N') < 3) {
        inp.edge = true;
        ai.cool = 1.0 + (1 - ai.skill) * 1.6;
        scoot(round, k, ai);
      }
    }
    return;
  }
  if (ai.haveGoal) {
    const tx = ai.goalX - k.x;
    const ty = ai.goalY - k.y;
    if (Math.hypot(tx, ty) < 0.06) return;
    steer(k, inp, Math.atan2(ty, tx), false);
  }
}

/** After a shot a bot doesn't stand there: it moves off to a side where there is room. */
function scoot(round, k, ai) {
  let best = -1;
  let ba = k.a + Math.PI / 2;
  for (let i = 0; i < 4; i++) {
    const a = k.a + i * (Math.PI / 2) + (i === 0 ? Math.PI * 2 : 0);
    const r = room(round, k, Math.cos(a), Math.sin(a)) + ai.rng() * 0.25 - (i === 0 ? 0.3 : 0);
    if (r > best) {
      best = r;
      ba = a;
    }
  }
  ai.scootA = ba;
  ai.scootUntil = ai.clock + 0.5 + ai.rng() * 0.5;
  ai.sol = null;
  ai.hadSol = false;
}
