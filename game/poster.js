// Store art. With `?poster=<name>` in the address the page skips the room and the SDK, sizes the canvas to the picture's exact size
// at pixel ratio 1, draws ONE staged frame with the game's own renderer (fixed seeds, the action frozen at its best moment) and
// sets document.body.dataset.ready = '1'. Pictures: cover, action, win, icon, and badge-<id> for each badge.

import { drawTankSolo, drawWorld } from './draw.js';
import { createFx } from './fx.js';
import { castRects, insideRects, reflect, segObb } from './geom.js';
import { INK, TAU, circle, clamp, rgba, shade, text } from './gfx.js';
import { makeMaze } from './maze.js';
import { mulberry32 } from './rng.js';
import { Round } from './round.js';
import { COLORS, COLS, ROWS, SHOT, TANK } from './rules.js';
import * as ui from './ui.js';

const SIZES = { cover: [1280, 720], action: [1280, 720], win: [1280, 720], icon: [512, 512] };
const BADGES = ['first-win', 'bank-shot', 'oops', 'ace'];
const HIT = { t: 0, nx: 0, ny: 0 };
const RF = [0, 0];

// ------------------------------------------------------------------------------------------------------------------ geometry for staging
/** The polyline of a shot (or beam) from (x, y) at angle a: up to `bounces` reflections and `maxLen` cells. [x0, y0, x1, y1, ...] */
function pathOf(maze, x, y, a, bounces, maxLen, r = SHOT.r) {
  const pts = [x, y];
  let dx = Math.cos(a);
  let dy = Math.sin(a);
  let len = 0;
  for (let i = 0; i <= bounces && len < maxLen; i++) {
    const wall = castRects(maze.rc, maze.nrc, x, y, dx, dy, maxLen - len, r, HIT);
    const seg = wall ? HIT.t : maxLen - len;
    x += dx * seg;
    y += dy * seg;
    len += seg;
    pts.push(x, y);
    if (!wall) break;
    reflect(dx, dy, HIT.nx, HIT.ny, RF);
    dx = RF[0];
    dy = RF[1];
    x += HIT.nx * 1e-6;
    y += HIT.ny * 1e-6;
  }
  return pts;
}

const lengthOf = (pts) => {
  let l = 0;
  for (let i = 2; i < pts.length; i += 2) l += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return l;
};

const cellCenter = (c) => [(c % COLS) + 0.5, ((c / COLS) | 0) + 0.5];

function mkScene(seed, w, h, scale, cx, cy) {
  const fx = createFx();
  fx.rand = mulberry32(seed ^ 0xabc123);
  const Sc = { w, h, pr: 1, u: clamp(h / 430, 0.8, 1.9), scale, ox: w / 2 - cx * scale, oy: h / 2 - cy * scale, shx: 0, shy: 0, time: 2, q: 1, reduced: false, cache: null };
  return { fx, Sc };
}

function newRound(maze, tanks) {
  const round = new Round({ roster: [], seed: maze.seed, roundNo: 1, maze, practice: true });
  tanks.forEach((t, i) => {
    const k = round.addTank({ id: t.id || `t${i}`, bot: Boolean(t.bot), n: t.n || '', c: t.c ?? i }, { x: t.x, y: t.y, a: t.a });
    k.vis.pop = 0;
    k.vis.mx = k.x;
    k.vis.my = k.y;
    if (t.weapon) k.weapon = { k: t.weapon, ammo: 1 };
    if (t.dead) k.alive = false;
  });
  return round;
}

/** Tread marks along a path of points (older marks first, so they fade in order). */
function drive(fx, pts, age) {
  const t0 = fx.t;
  fx.t = age;
  for (let i = 2; i < pts.length; i += 2) {
    const x0 = pts[i - 2];
    const y0 = pts[i - 1];
    const x1 = pts[i];
    const y1 = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 0.01) continue;
    const a = Math.atan2(y1 - y0, x1 - x0);
    const px = -Math.sin(a);
    const py = Math.cos(a);
    const n = Math.max(1, Math.floor(len / 0.1));
    for (let k = 0; k < n; k++) {
      const f0 = k / n;
      const f1 = (k + 1) / n;
      for (const o of [-0.105, 0.105]) fx.mark(x0 + (x1 - x0) * f0 + px * o, y0 + (y1 - y0) * f0 + py * o, x0 + (x1 - x0) * f1 + px * o, y0 + (y1 - y0) * f1 + py * o);
    }
  }
  fx.t = t0;
}

/** A long fading line along a path (brightest at its head, the last point). */
function streak(ctx, Sc, pts, col, width, alpha = 0.9) {
  const total = lengthOf(pts);
  let acc = 0;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 2; i < pts.length; i += 2) {
    const seg = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    const f0 = acc / total;
    acc += seg;
    const f1 = acc / total;
    const steps = Math.max(1, Math.ceil(seg * 6));
    for (let k = 0; k < steps; k++) {
      const a = f0 + ((f1 - f0) * k) / steps;
      const b = f0 + ((f1 - f0) * (k + 1)) / steps;
      const ax = pts[i - 2] + ((pts[i] - pts[i - 2]) * k) / steps;
      const ay = pts[i - 1] + ((pts[i + 1] - pts[i - 1]) * k) / steps;
      const bx = pts[i - 2] + ((pts[i] - pts[i - 2]) * (k + 1)) / steps;
      const by = pts[i - 1] + ((pts[i + 1] - pts[i - 1]) * (k + 1)) / steps;
      const f = (a + b) / 2;
      ctx.strokeStyle = rgba(col, alpha * f * f);
      ctx.lineWidth = width * Sc.scale * (0.35 + 0.65 * f);
      ctx.beginPath();
      ctx.moveTo(Sc.ox + ax * Sc.scale, Sc.oy + ay * Sc.scale);
      ctx.lineTo(Sc.ox + bx * Sc.scale, Sc.oy + by * Sc.scale);
      ctx.stroke();
    }
  }
}

function vignette(ctx, w, h, a = 0.45) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(6,8,14,0)');
  g.addColorStop(1, `rgba(6,8,14,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function skewText(ctx, str, x, y, size, o) {
  ctx.save();
  ctx.translate(x, y);
  ctx.transform(1, 0, -0.14, 1, 0, 0);
  text(ctx, str, 0, 0, size, o);
  ctx.restore();
}

// ------------------------------------------------------------------------------------------------------------------ the pictures
function cover(ctx) {
  const [w, h] = SIZES.cover;
  const maze = makeMaze(77031);
  const scale = w / 9.04;
  const { fx, Sc } = mkScene(5, w, h, scale, COLS / 2, ROWS / 2 + 0.55);
  // four tanks in the lower part, in cells far from each other
  const lower = [];
  for (let c = 0; c < COLS * ROWS; c++) if (((c / COLS) | 0) >= 2) lower.push(c);
  const rng = mulberry32(1234);
  const picks = [];
  while (picks.length < 4) {
    const c = lower[Math.floor(rng() * lower.length)];
    const [x, y] = cellCenter(c);
    if (picks.every((p) => Math.hypot(p[0] - x, p[1] - y) > 2.6)) picks.push([x, y]);
    if (picks.length < 4 && rng() < 0.002) break;
  }
  while (picks.length < 4) picks.push([1.5 + picks.length * 2, 4.5]);
  const tanks = picks.map((p, i) => ({ id: `t${i}`, x: p[0], y: p[1], a: rng() * TAU, c: [0, 1, 3, 4][i], me: false, dead: i === 2, weapon: i === 1 ? 'L' : null }));
  const round = newRound(maze, tanks);
  // each aims along the line that bounces the most while staying long and clear
  const best = (k, bounces, maxLen, minSeg) => {
    let top = -1;
    let ba = 0;
    for (let d = 0; d < 360; d += 2) {
      const a = (d * Math.PI) / 180;
      const pts = pathOf(maze, k.x + Math.cos(a) * TANK.muzzle, k.y + Math.sin(a) * TANK.muzzle, a, bounces, maxLen);
      let ok = true;
      for (let i = 2; i < pts.length; i += 2) if (Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]) < minSeg) ok = false;
      const sc = (pts.length / 2) * 2 + lengthOf(pts) * 0.3;
      if (ok && pts.length / 2 - 1 >= bounces && sc > top) {
        top = sc;
        ba = a;
      }
    }
    return ba;
  };
  const paths = [];
  const shooters = [0, 3];
  for (const i of shooters) {
    const k = round.tanks[i];
    k.a = best(k, 3, 7.5, 0.5);
    paths.push({ pts: pathOf(maze, k.x + Math.cos(k.a) * TANK.muzzle, k.y + Math.sin(k.a) * TANK.muzzle, k.a, 3, 7.5), col: COLORS[k.c].main });
  }
  const lk = round.tanks[1];
  lk.a = best(lk, 4, 40, 0.7);
  const beam = pathOf(maze, lk.x + Math.cos(lk.a) * TANK.muzzle, lk.y + Math.sin(lk.a) * TANK.muzzle, lk.a, 4, 60, 0.01);
  round.beams.push({ key: 'poster', id: lk.id, pts: beam, born: 0, life: 550 });
  // the tank that is going up, mid-blast
  const dk = round.tanks[2];
  fx.explode(dk.x, dk.y, COLORS[dk.c].main, COLORS[dk.c].dark, 1.35);
  fx.update(0.1);
  // a lived-in floor: tracks leading in, scorch here and there
  tanks.forEach((t, i) => drive(fx, [t.x - Math.cos(t.a) * 2, t.y - Math.sin(t.a) * 2, t.x - Math.cos(t.a) * 0.6, t.y - Math.sin(t.a) * 0.6, t.x, t.y], 0.2 + i * 0.1));
  fx.decal(3.4, 3.1, 0.34);
  fx.decal(6.2, 4.6, 0.28);
  fx.decal(1.6, 2.7, 0.24);
  const W = { round, fx, accent: '#ff7a1a', time: 2, meId: '', tags: false, youUntil: 0, guide: false, crateSeen: new Map() };
  fx.t = 1;
  drawWorld(ctx, Sc, W);
  for (const p of paths) streak(ctx, Sc, p.pts, p.col, 0.05);
  // the title, in the top third
  const g = ctx.createLinearGradient(0, 0, 0, h * 0.5);
  g.addColorStop(0, 'rgba(7,9,15,0.9)');
  g.addColorStop(0.7, 'rgba(7,9,15,0.45)');
  g.addColorStop(1, 'rgba(7,9,15,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h * 0.5);
  skewText(ctx, 'MAZE TANK BATTLE', w / 2, h * 0.17, 168, { weight: 700, lw: 14, stroke: 'rgba(5,7,12,0.95)', shadow: 6 });
  ctx.fillStyle = '#ff7a1a';
  ctx.fillRect(w * 0.31, h * 0.275, w * 0.38, 9);
  vignette(ctx, w, h, 0.35);
}

/** Search mazes for a shot that bounces once off a wall and is about to hit a tank that can't see the shooter. */
function findRicochet() {
  let best = null;
  for (let seed = 1; seed <= 70 && !(best && best.score > 9); seed++) {
    const maze = makeMaze(seed * 977);
    const rng = mulberry32(seed);
    for (let n = 0; n < 14; n++) {
      const tc = Math.floor(rng() * COLS * ROWS);
      const sc = Math.floor(rng() * COLS * ROWS);
      const [tx, ty] = cellCenter(tc);
      const [sx, sy] = cellCenter(sc);
      if (Math.hypot(tx - sx, ty - sy) < 2.2) continue;
      // the tank must not be in plain sight of the shooter
      const d = Math.hypot(tx - sx, ty - sy);
      if (!castRects(maze.rc, maze.nrc, sx, sy, (tx - sx) / d, (ty - sy) / d, d, 0.05, HIT)) continue;
      for (let deg = 0; deg < 360; deg += 2) {
        const a = (deg * Math.PI) / 180;
        const mx = sx + Math.cos(a) * TANK.muzzle;
        const my = sy + Math.sin(a) * TANK.muzzle;
        if (insideRects(maze.rc, maze.nrc, mx, my, SHOT.r + 0.004)) continue;
        const pts = pathOf(maze, mx, my, a, 1, 9);
        if (pts.length < 6) continue;
        // the second segment must run into the tank (a tank facing across the corridor)
        const ta = (rng() - 0.5) * 1.2;
        const hitT = segObb(pts[2], pts[3], pts[4], pts[5], tx, ty, ta, TANK.hl + SHOT.r, TANK.hw + SHOT.r);
        if (hitT < 0) continue;
        const l1 = Math.hypot(pts[2] - pts[0], pts[3] - pts[1]);
        const l2 = Math.hypot(pts[4] - pts[2], pts[5] - pts[3]) * hitT;
        if (l1 < 1.2 || l2 < 1.0 || l2 > 3) continue;
        const score = Math.min(l1, 4) + Math.min(l2, 2.4) + (d > 3 ? 1 : 0);
        if (!best || score > best.score) best = { maze, tx, ty, ta, pts: [pts[0], pts[1], pts[2], pts[3], pts[2] + (pts[4] - pts[2]) * hitT, pts[3] + (pts[5] - pts[3]) * hitT], a, mx, my, l1, l2, score };
      }
    }
  }
  return best;
}

function action(ctx) {
  const [w, h] = SIZES.action;
  let f = findRicochet();
  if (!f) {
    const maze = makeMaze(9);
    f = { maze, tx: 4.5, ty: 2.5, ta: 0.3, pts: [2.5, 2.5, 4.2, 2.5], a: 0, mx: 2.5, my: 2.5, l1: 0, l2: 1.7, score: 0 };
  }
  const { maze } = f;
  const bx = f.pts[2];
  const by = f.pts[3];
  const cx = (bx + f.tx) / 2;
  const cy = (by + f.ty) / 2;
  const spanX = Math.abs(bx - f.tx) + 1.6;
  const spanY = Math.abs(by - f.ty) + 1.6;
  const scale = clamp(Math.min((w * 0.82) / spanX, (h * 0.82) / spanY), 150, 300);
  const { fx, Sc } = mkScene(11, w, h, scale, cx, cy);
  const round = newRound(maze, [
    { id: 'a', x: f.tx, y: f.ty, a: f.ta, c: 1 },
    { id: 'z', x: 0.5, y: 0.5, a: 0, c: 0, dead: true },
  ]);
  // the shot, 0.8 cells short of the tank, with its trail
  const total = f.l1 + f.l2;
  const spec = { id: 'z', n: 1, x: f.mx, y: f.my, a: f.a, k: 'N', at: 0 };
  round.spawn(spec, Math.max(0, (total - 0.8) / SHOT.speed));
  // sparks off the wall where it bounced: the wall's normal is what turns the way in into the way out
  const inx = bx - f.pts[0];
  const iny = by - f.pts[1];
  const onx = f.pts[4] - bx;
  const ony = f.pts[5] - by;
  const il = Math.hypot(inx, iny) || 1;
  const ol = Math.hypot(onx, ony) || 1;
  fx.bounce(bx, by, onx / ol - inx / il, ony / ol - iny / il);
  drive(fx, [f.tx - Math.cos(f.ta) * 1.5, f.ty - Math.sin(f.ta) * 1.5, f.tx, f.ty], 0.3);
  fx.decal(f.tx + 0.9, f.ty + 0.5, 0.26);
  fx.update(0.05);
  fx.t = 1;
  const W = { round, fx, accent: '#12c2e9', time: 2, meId: '', tags: false, youUntil: 0, guide: false, crateSeen: new Map() };
  drawWorld(ctx, Sc, W);
  streak(ctx, Sc, [f.mx, f.my, bx, by, bx + (f.pts[4] - bx) * 0.6, by + (f.pts[5] - by) * 0.6], '#ffd37a', 0.05, 0.75);
  // a flash on the wall where it bounced
  const px = Sc.ox + bx * Sc.scale;
  const py = Sc.oy + by * Sc.scale;
  const g = ctx.createRadialGradient(px, py, 0, px, py, 0.5 * Sc.scale);
  g.addColorStop(0, 'rgba(255,240,190,0.9)');
  g.addColorStop(1, 'rgba(255,240,190,0)');
  ctx.fillStyle = g;
  circle(ctx, px, py, 0.5 * Sc.scale);
  ctx.fill();
  vignette(ctx, w, h, 0.55);
}

function win(ctx) {
  const [w, h] = SIZES.win;
  const maze = makeMaze(31337);
  const scale = 270;
  const { fx, Sc } = mkScene(21, w, h, scale, COLS / 2 + 0.1, ROWS / 2 + 0.25);
  const cx = Math.floor(COLS / 2) + 0.5;
  const cy = Math.floor(ROWS / 2) + 0.5;
  const round = newRound(maze, [
    { id: 'w', x: cx, y: cy, a: -0.5, c: 0, weapon: null },
    { id: 'a', x: 1.5, y: 1.5, a: 0, c: 1, dead: true },
    { id: 'b', x: 7.5, y: 1.5, a: 0, c: 3, dead: true },
    { id: 'c', x: 7.5, y: 4.5, a: 0, c: 4, dead: true },
  ]);
  // the floor shows what happened here: scorch where the others went up, tracks, a few last sparks
  for (const t of round.tanks) if (!t.alive) fx.decal(t.x, t.y, 0.38);
  fx.decal(cx - 1.2, cy + 0.6, 0.3);
  fx.decal(cx + 1.4, cy - 0.5, 0.26);
  drive(fx, [cx - 2.4, cy + 1, cx - 1.2, cy + 0.3, cx - 0.4, cy + 0.05, cx, cy], 0.2);
  drive(fx, [cx - 0.5, cy + 2, cx - 0.2, cy + 1, cx, cy + 0.3], 0.4);
  fx.confetti(cx, cy - 1.8, 140, 3.2, 2);
  fx.update(0.55);
  fx.update(0.35);
  fx.ring(cx, cy, 0.3, 1.5, 0.9, '#ffc400', 0.05);
  fx.update(0.1);
  fx.t = 1;
  const W = { round, fx, accent: '#ffc400', time: 2, meId: 'w', tags: false, youUntil: 0, guide: false, crateSeen: new Map() };
  round.tanks[0].me = true;
  drawWorld(ctx, Sc, W);
  vignette(ctx, w, h, 0.5);
  // the points bar: the winner has reached the goal
  ui.drawHud(ctx, Sc, {
    round: 14,
    goal: 10,
    chips: [
      { c: 0, score: 10, out: false, me: true, bot: false },
      { c: 1, score: 6, out: false, me: false, bot: true },
      { c: 3, score: 4, out: false, me: false, bot: true },
      { c: 4, score: 3, out: false, me: false, bot: true },
    ],
    timeLeft: Infinity,
    out: false,
    weapon: null,
    accent: '#ffc400',
  });
}

function icon(ctx) {
  const [w, h] = SIZES.icon;
  const g = ctx.createRadialGradient(w * 0.42, h * 0.55, 20, w / 2, h / 2, w * 0.8);
  g.addColorStop(0, '#222836');
  g.addColorStop(1, '#0d0f15');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // two walls, a corner
  const wall = (x, y, ww, hh) => {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x + 8, y + 12, ww, hh);
    ctx.fillStyle = '#10121a';
    ctx.fillRect(x, y, ww, hh);
    const gg = ctx.createLinearGradient(0, y, 0, y + hh);
    gg.addColorStop(0, '#4d556c');
    gg.addColorStop(1, '#2c3245');
    ctx.fillStyle = gg;
    ctx.fillRect(x + 3, y + 3, ww - 6, hh - 6);
  };
  wall(214, 52, 270, 34);
  wall(448, 52, 34, 290);
  ctx.fillStyle = '#ff7a1a';
  ctx.fillRect(214, 52, 270, 6);
  ctx.fillRect(476, 52, 6, 290);
  // the ricochet: out of the barrel, off the top wall, off the right wall
  const a = (-55 * Math.PI) / 180;
  const ZOOM = 520;
  const TX = 190;
  const TY = 322;
  const sx = TX + Math.cos(a) * TANK.muzzle * ZOOM;
  const sy = TY + Math.sin(a) * TANK.muzzle * ZOOM;
  const t1 = (sy - 94) / -Math.sin(a);
  const p1 = [sx + Math.cos(a) * t1, 94];
  const dx = Math.cos(a);
  const dy = -Math.sin(a);
  const t2 = (446 - p1[0]) / dx;
  const p2 = [446, 94 + dy * t2];
  const dx2 = -dx;
  const t3 = 120;
  const p3 = [446 + dx2 * t3, p2[1] + dy * t3];
  const poly = [sx, sy, p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]];
  const draw = (lw, col) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(poly[0], poly[1]);
    for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
    ctx.stroke();
  };
  draw(30, 'rgba(255,170,60,0.22)');
  draw(14, 'rgba(255,200,110,0.55)');
  draw(6, '#ffffff');
  circle(ctx, p3[0], p3[1], 14);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  circle(ctx, p3[0], p3[1], 9);
  ctx.fillStyle = '#15171d';
  ctx.fill();
  // impact flashes
  for (const p of [p1, p2]) {
    const gg = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], 38);
    gg.addColorStop(0, 'rgba(255,240,190,0.95)');
    gg.addColorStop(1, 'rgba(255,200,110,0)');
    ctx.fillStyle = gg;
    circle(ctx, p[0], p[1], 38);
    ctx.fill();
  }
  // the tank, big, firing
  const Sc = { w, h, pr: 1, u: 1, scale: ZOOM, ox: TX, oy: TY, shx: 0, shy: 0, time: 0, q: 1, reduced: false };
  const round = newRound(makeMaze(1), [{ id: 'p', x: 0, y: 0, a, c: 0 }]);
  const k = round.tanks[0];
  k.vis.recoil = 0.55;
  k.vis.track = 0.02;
  drawTankSolo(ctx, Sc, k, { time: 0 });
  const fg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 62);
  fg.addColorStop(0, 'rgba(255,250,215,1)');
  fg.addColorStop(0.4, 'rgba(255,190,80,0.7)');
  fg.addColorStop(1, 'rgba(255,150,40,0)');
  ctx.fillStyle = fg;
  circle(ctx, sx, sy, 62);
  ctx.fill();
}

// ------------------------------------------------------------------------------------------------------------------ badges
function disc(ctx, size, col) {
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c * 0.8, size * 0.05, c, c, size * 0.5);
  g.addColorStop(0, shade(col, 0.22));
  g.addColorStop(1, shade(col, -0.35));
  ctx.fillStyle = g;
  circle(ctx, c, c, size * 0.46);
  ctx.fill();
  ctx.lineWidth = size * 0.04;
  ctx.strokeStyle = rgba('#000000', 0.5);
  ctx.stroke();
  ctx.lineWidth = size * 0.016;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  circle(ctx, c, c, size * 0.405);
  ctx.stroke();
}

function badge(ctx, id) {
  const S = 256;
  ctx.fillStyle = '#0f1118';
  ctx.fillRect(0, 0, S, S);
  // every symbol is drawn twice: first fat and dark (its outline), then in its colour on top
  const twice = (draw) => {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    draw(true);
    draw(false);
  };
  if (id === 'first-win') {
    disc(ctx, S, '#ff9f1c');
    twice((o) => trophy(ctx, o));
  } else if (id === 'bank-shot') {
    disc(ctx, S, '#12c2e9');
    twice((o) => zigzag(ctx, o));
  } else if (id === 'oops') {
    disc(ctx, S, '#e63946');
    twice((o) => boomerang(ctx, o));
  } else {
    disc(ctx, S, '#7a4dff');
    twice((o) => stars(ctx, o));
  }
}

function trophy(ctx, o) {
  const fill = o ? INK : '#fff3c4';
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
  // a body part: dark pass strokes fat and fills, light pass only fills
  const part = () => {
    if (o) {
      ctx.lineWidth = 18;
      ctx.stroke();
    }
    ctx.fill();
  };
  ctx.beginPath(); // the cup
  ctx.moveTo(86, 74);
  ctx.lineTo(170, 74);
  ctx.lineTo(164, 120);
  ctx.quadraticCurveTo(160, 152, 128, 156);
  ctx.quadraticCurveTo(96, 152, 92, 120);
  ctx.closePath();
  part();
  ctx.lineWidth = o ? 20 : 9; // the handles
  ctx.beginPath();
  ctx.moveTo(88, 84);
  ctx.quadraticCurveTo(54, 84, 62, 112);
  ctx.quadraticCurveTo(70, 130, 94, 128);
  ctx.moveTo(168, 84);
  ctx.quadraticCurveTo(202, 84, 194, 112);
  ctx.quadraticCurveTo(186, 130, 162, 128);
  ctx.stroke();
  ctx.beginPath(); // the stem
  ctx.rect(120, 154, 16, 28);
  part();
  ctx.beginPath(); // the base
  ctx.moveTo(92, 184);
  ctx.lineTo(164, 184);
  ctx.lineTo(172, 202);
  ctx.lineTo(84, 202);
  ctx.closePath();
  part();
  if (!o) {
    ctx.fillStyle = '#ff9f1c';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 9 : 20;
      if (i === 0) ctx.moveTo(128 + Math.cos(a) * r, 108 + Math.sin(a) * r);
      else ctx.lineTo(128 + Math.cos(a) * r, 108 + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  }
}

function zigzag(ctx, o) {
  // a bent arrow: up, down, up and away
  const pts = [
    [58, 190],
    [102, 74],
    [150, 182],
    [196, 70],
  ];
  ctx.strokeStyle = o ? INK : '#ffffff';
  ctx.lineWidth = o ? 34 : 20;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
  // the head
  ctx.fillStyle = o ? INK : '#ffffff';
  ctx.strokeStyle = o ? INK : '#ffffff';
  ctx.lineWidth = o ? 18 : 6;
  ctx.beginPath();
  ctx.moveTo(214, 52);
  ctx.lineTo(160, 70);
  ctx.lineTo(200, 108);
  ctx.closePath();
  if (o) ctx.stroke();
  ctx.fill();
}

function boomerang(ctx, o) {
  ctx.strokeStyle = o ? INK : '#fff3c4';
  ctx.lineWidth = o ? 50 : 34;
  ctx.beginPath();
  ctx.moveTo(60, 70);
  ctx.quadraticCurveTo(52, 190, 150, 196);
  ctx.quadraticCurveTo(190, 198, 204, 168);
  ctx.stroke();
  if (!o) {
    ctx.strokeStyle = '#e63946';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(60, 74);
    ctx.quadraticCurveTo(54, 186, 150, 192);
    ctx.stroke();
  }
}

function stars(ctx, o) {
  const at = [
    [128, 78, 34],
    [80, 118, 26],
    [176, 118, 26],
    [98, 176, 26],
    [158, 176, 26],
  ];
  ctx.fillStyle = o ? INK : '#ffd60a';
  ctx.strokeStyle = INK;
  ctx.lineWidth = o ? 14 : 0;
  for (const [x, y, r] of at) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 ? r * 0.45 : r;
      if (i === 0) ctx.moveTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
      else ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath();
    if (o) ctx.stroke();
    ctx.fill();
  }
}

// ------------------------------------------------------------------------------------------------------------------ entry
export async function runPoster(name, canvas) {
  const badgeId = name.startsWith('badge-') ? name.slice(6) : '';
  const size = badgeId ? [256, 256] : SIZES[name] || SIZES.cover;
  canvas.width = size[0];
  canvas.height = size[1];
  canvas.style.width = `${size[0]}px`;
  canvas.style.height = `${size[1]}px`;
  document.body.style.margin = '0';
  const ctx = canvas.getContext('2d');
  try {
    await Promise.all([document.fonts.load('700 100px Teko'), document.fonts.load('600 40px Teko')]);
    await document.fonts.ready;
  } catch {
    // the art goes ahead with the fallback face
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (badgeId) badge(ctx, BADGES.includes(badgeId) ? badgeId : 'ace');
  else if (name === 'action') action(ctx);
  else if (name === 'win') win(ctx);
  else if (name === 'icon') icon(ctx);
  else cover(ctx);
  document.body.dataset.ready = '1';
}

