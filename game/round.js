// One round: the maze, every tank, every shot in flight, mines, crates and the laser beams. Pure (no page, no SDK), so the tests
// play whole matches with it.
//
// Who decides what. Every page runs a Round and simulates every shot from the message that announced it, so all pages agree on
// each path (bounces are exact: see geom.castRects). A tank is `sim` on the page that decides about it: your own tank on your
// page, the bots on the host's page (and, there, a player who is away). Only `sim` tanks are moved, tested against shots, mines
// and beams, and picked up crates with; the other tanks are copies put in place from presence or the bots' snapshots. Whatever
// a `sim` tank suffers comes out of the hooks (`dead`, `fire`, `boom`, `claim`) for the net layer to tell the others.

import { think, newAI } from './bots.js';
import { angDiff, castRects, insideRects, pushCircle, reflect, segObb, wrapAngle } from './geom.js';
import { WALL_T, cellAt, makeMaze, spawnPlan } from './maze.js';
import { hashStr, mulberry32, shuffle } from './rng.js';
import { CRATE, SHOT, SHOT_KINDS, STEP, TANK, WEAPON, WEAPON_KEYS, clamp, num } from './rules.js';

const OFFS = [-TANK.off, 0, TANK.off];
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;
const TRAIL = 14;

export function makeInput() {
  return { turn: 0, thr: 0, aim: null, mag: 0, fire: false, edge: false };
}

export class Round {
  /** opts: { roster: [{ id, bot, n, c }], seed (the maze's), roundNo, practice (shots hurt nobody; there are targets) } */
  constructor(opts = {}) {
    const roster = opts.roster || [];
    this.seed = (opts.seed ?? 1) >>> 0;
    this.roundNo = opts.roundNo ?? 1;
    this.practice = Boolean(opts.practice);
    this.maze = opts.maze || makeMaze(this.seed);
    this.rc = this.maze.rc;
    this.nrc = this.maze.nrc;
    this.rng = mulberry32(hashStr(`round:${this.seed}:${this.roundNo}`));
    this.t = 0; // ms since play began
    this.tanks = [];
    this.byId = new Map();
    this.shots = [];
    this.mines = [];
    this.beams = [];
    this.crates = [];
    this.targets = [];
    this.claimed = new Set(); // crates this page's tanks have taken
    this.fired = new Set(); // keys of shots already spawned (a message that comes twice does nothing the second time)
    this.hooks = {};
    this.stuckShots = 0; // shots that ended inside a wall (never happens; the tests watch it)
    this.catching = false; // true while a shot that arrived late is being brought up to date
    this._hit = { t: 0, nx: 0, ny: 0 };
    this._r = [0, 0];
    this._p = { x: 0, y: 0 };
    const n = roster.length;
    if (n) {
      const plan = spawnPlan(this.maze, n, mulberry32(hashStr(`spawn:${this.seed}`)));
      const seats = shuffle(
        roster.map((_, i) => i),
        mulberry32(hashStr(`seat:${this.seed}:${this.roundNo}`)),
      );
      roster.forEach((e, i) => this.addTank(e, plan[seats[i]]));
    }
  }

  // ------------------------------------------------------------------ tanks
  addTank(entry, spot) {
    const idx = this.tanks.length;
    const s = spot || { x: this.maze.cols / 2, y: this.maze.rows / 2, a: 0 };
    const k = {
      id: entry.id,
      bot: Boolean(entry.bot),
      c: num(entry.c, idx),
      name: typeof entry.n === 'string' ? entry.n : '',
      idx,
      sim: false,
      ai: entry.bot ? newAI(mulberry32(hashStr(`ai:${this.seed}:${entry.id}`)), idx) : null,
      x: s.x,
      y: s.y,
      a: s.a,
      vx: 0,
      vy: 0,
      alive: true,
      weapon: null, // { k: 'L'|'S'|'G'|'M'|'H', ammo }
      cd: 0,
      rep: 0,
      gcd: 0,
      buf: 0,
      seq: 0,
      inp: makeInput(),
      diedAt: -1,
      vis: { pop: 1, recoil: 0, track: 0, flash: 0, mx: s.x, my: s.y, ma: s.a, hold: 0 },
    };
    this.tanks.push(k);
    this.byId.set(k.id, k);
    return k;
  }

  removeTank(id) {
    const i = this.tanks.findIndex((k) => k.id === id);
    if (i < 0) return;
    this.tanks.splice(i, 1);
    this.byId.delete(id);
    this.tanks.forEach((k, j) => (k.idx = j));
  }

  setSim(id, on) {
    const k = this.byId.get(id);
    if (k) k.sim = Boolean(on);
  }

  aliveTanks() {
    return this.tanks.filter((k) => k.alive);
  }

  aliveCount() {
    let n = 0;
    for (const k of this.tanks) if (k.alive) n++;
    return n;
  }

  liveCount(id, kind) {
    let n = 0;
    for (const s of this.shots) if (!s.dead && s.id === id && s.k === kind) n++;
    return n;
  }

  /** Is the point a shot would start from free of walls? */
  muzzleFree(k) {
    const x = k.x + Math.cos(k.a) * TANK.muzzle;
    const y = k.y + Math.sin(k.a) * TANK.muzzle;
    return !insideRects(this.rc, this.nrc, x, y, SHOT.r + 0.004);
  }

  // ------------------------------------------------------------------ one step
  /** Advance by dt seconds. coast: the round is decided: tanks take no orders, shots and mines carry on. */
  step(dt, coast = false) {
    const tanks = this.tanks;
    for (let i = 0; i < tanks.length; i++) {
      const k = tanks[i];
      if (!k.alive || !k.sim) continue;
      if (coast) {
        const inp = k.inp;
        inp.turn = 0;
        inp.thr = 0;
        inp.aim = null;
        inp.mag = 0;
        inp.fire = false;
        inp.edge = false;
      } else if (k.ai) think(this, k, dt);
      this.moveTank(k, dt);
    }
    this.separate();
    if (!coast) for (let i = 0; i < tanks.length; i++) if (tanks[i].alive && tanks[i].sim) this.fireControl(tanks[i], dt);
    this.claimCrates();
    this.stepShots(dt);
    this.stepMines(dt);
    if (this.beams.length) {
      let w = 0;
      for (const b of this.beams) if (this.t - b.born < b.life) this.beams[w++] = b;
      this.beams.length = w;
    }
    for (const g of this.targets) if (g.hitAt >= 0 && this.t - g.hitAt > 2500) g.hitAt = -1;
    this.t += dt * 1000;
  }

  moveTank(k, dt) {
    const inp = k.inp;
    this.clampInside(k);
    let thr;
    if (inp.aim !== null && Number.isFinite(inp.aim)) {
      const err = angDiff(inp.aim, k.a);
      const lim = TANK.stickTurn * dt;
      k.a = wrapAngle(k.a + (Math.abs(err) <= lim ? err : Math.sign(err) * lim));
      thr = clamp(num(inp.mag), 0, 1) * Math.max(0, Math.cos(angDiff(inp.aim, k.a)));
    } else {
      k.a = wrapAngle(k.a + clamp(num(inp.turn), -1, 1) * TANK.turn * dt);
      thr = clamp(num(inp.thr), -1, 1);
    }
    const sp = thr >= 0 ? thr * TANK.fwd : thr * TANK.back;
    const ox = k.x;
    const oy = k.y;
    k.x += Math.cos(k.a) * sp * dt;
    k.y += Math.sin(k.a) * sp * dt;
    this.collideWalls(k);
    k.vx = (k.x - ox) / dt;
    k.vy = (k.y - oy) / dt;
    // the treads turn with the ground under them
    k.vis.track += (k.vx * Math.cos(k.a) + k.vy * Math.sin(k.a)) * dt;
  }

  /** Keep the tank inside the border walls (they are as thick as any), whichever way it points. Repairs a broken position too. */
  clampInside(k) {
    const m = this.maze;
    if (!Number.isFinite(k.x) || !Number.isFinite(k.y)) {
      k.x = m.cols / 2;
      k.y = m.rows / 2;
    }
    if (!Number.isFinite(k.a)) k.a = 0;
    const edge = WALL_T / 2 + TANK.rc;
    const ex = edge + Math.abs(Math.cos(k.a)) * TANK.off;
    const ey = edge + Math.abs(Math.sin(k.a)) * TANK.off;
    k.x = clamp(k.x, ex, m.cols - ex);
    k.y = clamp(k.y, ey, m.rows - ey);
  }

  collideWalls(k) {
    const p = this._p;
    this.clampInside(k);
    const cs = Math.cos(k.a);
    const sn = Math.sin(k.a);
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (let i = 0; i < 3; i++) {
        p.x = k.x + cs * OFFS[i];
        p.y = k.y + sn * OFFS[i];
        const ox = p.x;
        const oy = p.y;
        if (pushCircle(this.rc, this.nrc, p, TANK.rc)) {
          k.x += p.x - ox;
          k.y += p.y - oy;
          moved = true;
        }
      }
      if (!moved) break;
    }
    this.clampInside(k);
  }

  /** Tanks don't drive through each other. A tank that is only a copy never moves: the one that is simulated gives way. */
  separate() {
    const ts = this.tanks;
    for (let i = 0; i < ts.length; i++) {
      const a = ts[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < ts.length; j++) {
        const b = ts[j];
        if (!b.alive || (!a.sim && !b.sim)) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (dx * dx + dy * dy > 0.6 * 0.6) continue;
        const ca = Math.cos(a.a);
        const sa = Math.sin(a.a);
        const cb = Math.cos(b.a);
        const sb = Math.sin(b.a);
        let moved = false;
        for (let pass = 0; pass < 2; pass++) {
          for (let p = 0; p < 3; p++) {
            for (let q = 0; q < 3; q++) {
              const ax = a.x + ca * OFFS[p];
              const ay = a.y + sa * OFFS[p];
              const bx = b.x + cb * OFFS[q];
              const by = b.y + sb * OFFS[q];
              let ex = bx - ax;
              let ey = by - ay;
              const d = Math.hypot(ex, ey);
              if (d >= TANK.rc * 2) continue;
              if (d < 1e-6) {
                ex = 1;
                ey = 0;
              } else {
                ex /= d;
                ey /= d;
              }
              const push = TANK.rc * 2 - d;
              moved = true;
              if (a.sim && b.sim) {
                a.x -= (ex * push) / 2;
                a.y -= (ey * push) / 2;
                b.x += (ex * push) / 2;
                b.y += (ey * push) / 2;
              } else if (a.sim) {
                a.x -= ex * push;
                a.y -= ey * push;
              } else {
                b.x += ex * push;
                b.y += ey * push;
              }
            }
          }
          if (!moved) break;
        }
        if (moved) {
          if (a.sim) this.collideWalls(a);
          if (b.sim) this.collideWalls(b);
        }
      }
    }
  }

  // ------------------------------------------------------------------ firing
  fireControl(k, dt) {
    const inp = k.inp;
    if (k.cd > 0) k.cd = Math.max(0, k.cd - dt);
    if (k.rep > 0) k.rep = Math.max(0, k.rep - dt);
    if (k.gcd > 0) k.gcd = Math.max(0, k.gcd - dt);
    if (inp.edge) {
      k.buf = 0.12; // a press a moment too early still counts
      inp.edge = false;
    } else if (k.buf > 0) k.buf = Math.max(0, k.buf - dt);
    const w = k.weapon;
    const edge = k.buf > 0;
    // (timers within a hair of zero are ready: a tenth of a second is six steps, not seven)
    if (w && w.k === 'G') {
      if ((inp.fire || edge) && k.gcd <= 1e-9) this.fireGatling(k, w);
    } else if (w) {
      if (edge && k.cd <= 1e-9) this.fireWeapon(k, w);
    } else if (k.cd <= 1e-9 && (edge || (inp.fire && k.rep <= 1e-9))) this.fireNormal(k);
  }

  makeSpec(k, kind, x, y, a) {
    return { id: k.id, n: ++k.seq, x: r4(x), y: r4(y), a: r4(a), k: kind, at: Math.round(this.t) };
  }

  fizzle(k) {
    k.cd = 0.12;
    k.buf = 0;
    k.vis.recoil = 0.3;
    if (this.hooks.fizzle) this.hooks.fizzle(k);
  }

  announce(spec, k) {
    k.vis.recoil = 1;
    if (this.hooks.fire) this.hooks.fire(spec, k, true);
  }

  fireNormal(k) {
    if (this.liveCount(k.id, 'N') >= SHOT.max) {
      k.buf = 0;
      return;
    }
    if (!this.muzzleFree(k)) return this.fizzle(k);
    const spec = this.makeSpec(k, 'N', k.x + Math.cos(k.a) * TANK.muzzle, k.y + Math.sin(k.a) * TANK.muzzle, k.a);
    this.spawn(spec, 0);
    k.cd = SHOT.cd;
    k.rep = SHOT.repeat;
    k.buf = 0;
    this.announce(spec, k);
  }

  fireWeapon(k, w) {
    const kind = w.k;
    let x = k.x + Math.cos(k.a) * TANK.muzzle;
    let y = k.y + Math.sin(k.a) * TANK.muzzle;
    if (kind === 'M') {
      // a mine goes down behind the tank (under it when a wall is there)
      x = k.x - Math.cos(k.a) * 0.3;
      y = k.y - Math.sin(k.a) * 0.3;
      if (insideRects(this.rc, this.nrc, x, y, 0.1)) {
        x = k.x;
        y = k.y;
      }
    } else if (!this.muzzleFree(k)) return this.fizzle(k);
    const spec = this.makeSpec(k, kind, x, y, k.a);
    k.weapon = null;
    k.buf = 0;
    k.cd = (WEAPON[kind] && WEAPON[kind].cd) || 0.4;
    this.spawn(spec, 0);
    this.announce(spec, k);
  }

  fireGatling(k, w) {
    if (!this.muzzleFree(k)) return this.fizzle(k);
    const n = k.seq + 1;
    const wob = Math.sin(n * 12.9898) * 0.035; // a little spray, the same every time
    const spec = this.makeSpec(k, 'G', k.x + Math.cos(k.a) * TANK.muzzle, k.y + Math.sin(k.a) * TANK.muzzle, k.a + wob);
    this.spawn(spec, 0);
    k.gcd = WEAPON.G.gap;
    k.buf = 0;
    w.ammo -= 1;
    if (w.ammo <= 0) {
      k.weapon = null;
      k.cd = 0.3;
    }
    this.announce(spec, k);
  }

  // ------------------------------------------------------------------ shots
  /** Put a fired thing into the world (its spec is what went out in the message), `elapsed` seconds into its life. */
  spawn(spec, elapsed = 0) {
    const key = `${spec.id}.${spec.n}`;
    if (this.fired.has(key)) return;
    this.fired.add(key);
    if (this.fired.size > 4000) this.fired.clear();
    const kind = spec.k;
    if (kind === 'L') return this.laser(spec, key);
    if (kind === 'M') {
      const armed = elapsed >= WEAPON.M.arm;
      this.mines.push({ key, id: spec.id, x: spec.x, y: spec.y, age: elapsed, armed, dead: false });
      return;
    }
    const added = [];
    if (kind === 'S') {
      const W = WEAPON.S;
      for (let i = 0; i < W.n; i++) {
        const a = spec.a + (i - (W.n - 1) / 2) * (W.spread / ((W.n - 1) / 2));
        added.push(this.newShot(`${key}.${i}`, spec, 'S', a, W.speed, W.r, W.life));
      }
    } else if (kind === 'G') added.push(this.newShot(key, spec, 'G', spec.a, WEAPON.G.speed, WEAPON.G.r, WEAPON.G.life));
    else if (kind === 'H') added.push(this.newShot(key, spec, 'H', spec.a, WEAPON.H.speed, WEAPON.H.r, WEAPON.H.life));
    else added.push(this.newShot(key, spec, 'N', spec.a, SHOT.speed, SHOT.r, SHOT.life));
    this.catching = elapsed > 0;
    for (const s of added) {
      let e = elapsed;
      while (e > 1e-9 && !s.dead) {
        const d = Math.min(e, STEP);
        this.stepShot(s, d);
        e -= d;
      }
    }
    this.catching = false;
  }

  newShot(key, spec, kind, a, speed, r, life) {
    const s = {
      key,
      id: spec.id,
      k: kind,
      x: spec.x,
      y: spec.y,
      dx: Math.cos(a),
      dy: Math.sin(a),
      speed,
      r,
      age: 0,
      life,
      bounces: 0,
      dead: false,
      tx: new Float32Array(TRAIL),
      ty: new Float32Array(TRAIL),
      tn: 0,
      th: 0,
    };
    this.shots.push(s);
    return s;
  }

  stepShots(dt) {
    const shots = this.shots;
    for (let i = 0; i < shots.length; i++) if (!shots[i].dead) this.stepShot(shots[i], dt);
    // a missile can be shot down
    for (let i = 0; i < shots.length; i++) {
      const m = shots[i];
      if (m.dead || m.k !== 'H') continue;
      for (let j = 0; j < shots.length; j++) {
        const o = shots[j];
        if (o.dead || o.k === 'H') continue;
        const d = Math.hypot(o.x - m.x, o.y - m.y);
        if (d < m.r + o.r + 0.02) {
          m.dead = true;
          o.dead = true;
          if (this.hooks.pop) this.hooks.pop(m.x, m.y, m);
          break;
        }
      }
    }
    let w = 0;
    for (let i = 0; i < shots.length; i++) if (!shots[i].dead) shots[w++] = shots[i];
    shots.length = w;
  }

  stepShot(s, dt) {
    if (s.dead) return;
    s.age += dt;
    if (s.age >= s.life) {
      s.dead = true;
      if (this.hooks.expire) this.hooks.expire(s);
      return;
    }
    if (s.k === 'H') this.steer(s, dt);
    let remain = s.speed * dt;
    const hit = this._hit;
    const rf = this._r;
    for (let it = 0; it < 16 && remain > 1e-9; it++) {
      const wall = castRects(this.rc, this.nrc, s.x, s.y, s.dx, s.dy, remain, s.r, hit);
      const seg = wall ? hit.t : remain;
      const x1 = s.x + s.dx * seg;
      const y1 = s.y + s.dy * seg;
      if (this.practice) {
        if (this.hitTargets(s, s.x, s.y, x1, y1)) return;
      } else if (this.hitTanks(s, s.x, s.y, x1, y1)) return;
      s.x = x1;
      s.y = y1;
      if (wall) {
        reflect(s.dx, s.dy, hit.nx, hit.ny, rf);
        s.dx = rf[0];
        s.dy = rf[1];
        const l = Math.hypot(s.dx, s.dy) || 1;
        s.dx /= l;
        s.dy /= l;
        s.x += hit.nx * 1e-7;
        s.y += hit.ny * 1e-7;
        s.bounces++;
        remain -= seg;
        if (this.hooks.bounce && !this.catching) this.hooks.bounce(s, hit.nx, hit.ny);
      } else remain = 0;
    }
    if (insideRects(this.rc, this.nrc, s.x, s.y, s.r)) {
      this.stuckShots++;
      s.dead = true;
      return;
    }
    s.tx[s.th] = s.x;
    s.ty[s.th] = s.y;
    s.th = (s.th + 1) % TRAIL;
    if (s.tn < TRAIL) s.tn++;
  }

  steer(s, dt) {
    if (s.age < WEAPON.H.home) return;
    let best = null;
    let bd = Infinity;
    for (const k of this.tanks) {
      if (!k.alive || k.id === s.id) continue;
      const d = Math.hypot(k.x - s.x, k.y - s.y);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    if (!best) return;
    const want = Math.atan2(best.y - s.y, best.x - s.x);
    const cur = Math.atan2(s.dy, s.dx);
    const lim = WEAPON.H.turn * dt;
    const na = cur + clamp(angDiff(want, cur), -lim, lim);
    s.dx = Math.cos(na);
    s.dy = Math.sin(na);
  }

  hitTanks(s, x0, y0, x1, y1) {
    let bt = Infinity;
    let bk = null;
    for (const k of this.tanks) {
      if (!k.alive || !k.sim) continue;
      const t = segObb(x0, y0, x1, y1, k.x, k.y, k.a, TANK.hl + s.r, TANK.hw + s.r);
      if (t >= 0 && t < bt) {
        bt = t;
        bk = k;
      }
    }
    if (!bk) return false;
    s.x = x0 + (x1 - x0) * bt;
    s.y = y0 + (y1 - y0) * bt;
    s.dead = true;
    this.kill(bk, { by: s.id, s: s.key, b: s.bounces, local: true });
    return true;
  }

  hitTargets(s, x0, y0, x1, y1) {
    for (const g of this.targets) {
      if (g.hitAt >= 0) continue;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const l2 = dx * dx + dy * dy;
      let t = l2 > 1e-12 ? ((g.x - x0) * dx + (g.y - y0) * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      if (Math.hypot(g.x - px, g.y - py) < g.r + s.r) {
        g.hitAt = this.t;
        s.x = px;
        s.y = py;
        s.dead = true;
        if (this.hooks.target) this.hooks.target(g, s);
        return true;
      }
    }
    return false;
  }

  laser(spec, key) {
    const pts = [spec.x, spec.y];
    const segs = [];
    let x = spec.x;
    let y = spec.y;
    let dx = Math.cos(spec.a);
    let dy = Math.sin(spec.a);
    const hit = this._hit;
    const rf = this._r;
    for (let i = 0; i <= WEAPON.L.bounces; i++) {
      const wall = castRects(this.rc, this.nrc, x, y, dx, dy, 80, 0.01, hit);
      if (!wall) break;
      const ex = x + dx * hit.t;
      const ey = y + dy * hit.t;
      segs.push(x, y, ex, ey);
      pts.push(ex, ey);
      reflect(dx, dy, hit.nx, hit.ny, rf);
      dx = rf[0];
      dy = rf[1];
      x = ex + hit.nx * 1e-6;
      y = ey + hit.ny * 1e-6;
    }
    const beam = { key, id: spec.id, pts, born: this.t, life: 550 };
    this.beams.push(beam);
    if (this.hooks.laser) this.hooks.laser(beam);
    if (this.practice) return;
    for (const k of this.tanks) {
      if (!k.alive || !k.sim) continue;
      for (let i = 0; i < segs.length; i += 4) {
        const t = segObb(segs[i], segs[i + 1], segs[i + 2], segs[i + 3], k.x, k.y, k.a, TANK.hl + WEAPON.L.hit, TANK.hw + WEAPON.L.hit);
        if (t >= 0) {
          this.kill(k, { by: spec.id, s: key, b: i / 4, local: true });
          break;
        }
      }
    }
  }

  // ------------------------------------------------------------------ mines
  stepMines(dt) {
    const ms = this.mines;
    if (!ms.length) return;
    for (const m of ms) {
      if (m.dead) continue;
      m.age += dt;
      if (!m.armed && m.age >= WEAPON.M.arm) {
        m.armed = true;
        if (this.hooks.armed) this.hooks.armed(m);
      }
      if (!m.armed) continue;
      for (const k of this.tanks) {
        if (!k.alive || !k.sim) continue;
        const cs = Math.cos(k.a);
        const sn = Math.sin(k.a);
        let near = false;
        for (let i = 0; i < 3; i++) if (Math.hypot(k.x + cs * OFFS[i] - m.x, k.y + sn * OFFS[i] - m.y) < TANK.rc + WEAPON.M.trig) near = true;
        if (near) {
          this.detonate(m, true);
          break;
        }
      }
    }
    let w = 0;
    for (const m of ms) if (!m.dead) ms[w++] = m;
    ms.length = w;
  }

  /** A mine goes off (local: this page's tank set it off, so the others must be told). Every tank this page decides about that is in the blast, in the open, dies. */
  detonate(m, local) {
    if (m.dead) return;
    m.dead = true;
    if (this.hooks.boom) this.hooks.boom(m, local);
    for (const k of this.tanks) {
      if (!k.alive || !k.sim) continue;
      const d = Math.hypot(k.x - m.x, k.y - m.y);
      if (d > WEAPON.M.blast) continue;
      if (d > 1e-6 && castRects(this.rc, this.nrc, m.x, m.y, (k.x - m.x) / d, (k.y - m.y) / d, d, 0, this._hit)) continue;
      this.kill(k, { by: m.id, s: m.key, b: 0, local: true });
    }
  }

  remoteBoom(key) {
    for (const m of this.mines) {
      if (m.key === key && !m.dead) {
        this.detonate(m, false);
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ crates
  setCrates(list) {
    this.crates = [];
    if (!Array.isArray(list)) return;
    for (const c of list) {
      if (!Array.isArray(c) || c.length < 4) continue;
      const cx = num(c[1], -1);
      const cy = num(c[2], -1);
      const kind = String(c[3]);
      if (cx < 0 || cy < 0 || cx >= this.maze.cols || cy >= this.maze.rows || !WEAPON_KEYS.includes(kind)) continue;
      this.crates.push({ n: num(c[0]), x: cx + 0.5, y: cy + 0.5, kind });
    }
  }

  claimCrates() {
    if (!this.crates.length) return;
    for (const k of this.tanks) {
      if (!k.alive || !k.sim || k.weapon) continue;
      for (const c of this.crates) {
        if (this.claimed.has(c.n)) continue;
        if (Math.hypot(k.x - c.x, k.y - c.y) < CRATE.pick) {
          this.claimed.add(c.n);
          k.weapon = { k: c.kind, ammo: c.kind === 'G' ? WEAPON.G.ammo : 1 };
          if (this.hooks.claim) this.hooks.claim(k, c);
          break;
        }
      }
    }
  }

  // ------------------------------------------------------------------ deaths
  /** A tank is destroyed. info: { by, s (the shot or mine's key), b (bounces), local (decided on this page) }. */
  kill(k, info = {}) {
    if (info.s) this.dropShot(info.s);
    if (!k || !k.alive) return false;
    k.alive = false;
    k.weapon = null;
    k.vx = 0;
    k.vy = 0;
    k.diedAt = this.t;
    k.inp.fire = false;
    k.inp.edge = false;
    if (this.hooks.dead) this.hooks.dead(k, info);
    return true;
  }

  /** The shot (or mine) with this key is gone: it hit a tank. */
  dropShot(key) {
    for (const s of this.shots) if (s.key === key) s.dead = true;
    for (const m of this.mines) if (m.key === key) m.dead = true;
  }

  // ------------------------------------------------------------------ what comes from the network
  /** A fire message from another page (already checked for who may send it). `msg.at` is round milliseconds. */
  remoteFire(msg) {
    if (!msg || !SHOT_KINDS.includes(msg.k) || typeof msg.id !== 'string') return false;
    const { cols, rows } = this.maze;
    const x = num(msg.x, NaN);
    const y = num(msg.y, NaN);
    const a = num(msg.a, NaN);
    if (!(x > -0.5 && x < cols + 0.5 && y > -0.5 && y < rows + 0.5) || !Number.isFinite(a)) return false;
    const n = Math.round(num(msg.n, -1));
    if (n < 0 || n > 1e6) return false;
    const spec = { id: msg.id, n, x, y, a, k: msg.k, at: num(msg.at, this.t) };
    if (this.fired.has(`${spec.id}.${spec.n}`)) return false;
    const elapsed = clamp((this.t - spec.at) / 1000, 0, 1.5);
    this.spawn(spec, elapsed);
    const k = this.byId.get(spec.id);
    if (k) k.vis.recoil = 1;
    if (this.hooks.fire) this.hooks.fire(spec, k || null, false);
    return spec;
  }

  remoteDead(id, info) {
    const k = this.byId.get(id);
    if (info && info.s) this.dropShot(info.s);
    if (!k) return false;
    return this.kill(k, { ...info, local: false });
  }

  // ------------------------------------------------------------------ the bots' state, for a page that is not the host
  snapshotBots() {
    const p = [];
    for (const k of this.tanks) {
      if (!k.bot) continue;
      const w = k.weapon ? WEAPON_KEYS.indexOf(k.weapon.k) + 1 : 0;
      p.push([r2(k.x), r2(k.y), r2(k.a), (k.alive ? 0 : 1) | (w << 1)]);
    }
    return p;
  }

  restoreBots(p) {
    if (!Array.isArray(p)) return;
    let i = 0;
    for (const k of this.tanks) {
      if (!k.bot) continue;
      const s = p[i++];
      if (!Array.isArray(s) || s.length < 4 || !s.every(Number.isFinite)) continue;
      k.x = clamp(s[0], 0, this.maze.cols);
      k.y = clamp(s[1], 0, this.maze.rows);
      k.a = s[2];
      if (s[3] & 1) k.alive = false;
      const w = (s[3] >> 1) & 7;
      k.weapon = w >= 1 && w <= WEAPON_KEYS.length && k.alive ? { k: WEAPON_KEYS[w - 1], ammo: WEAPON_KEYS[w - 1] === 'G' ? WEAPON.G.ammo : 1 } : null;
    }
  }

  /** Practice targets for the lobby: bullseyes in fixed places. */
  addTargets(cells) {
    for (const c of cells) this.targets.push({ x: (c % this.maze.cols) + 0.5, y: ((c / this.maze.cols) | 0) + 0.5, r: 0.2, hitAt: -1 });
  }

  cellOf(k) {
    return cellAt(this.maze, k.x, k.y);
  }
}
