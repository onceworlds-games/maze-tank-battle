// The world, drawn: the board (cached once per maze and size), tread marks and scorch marks, crates and mines, tanks with moving
// tracks, shots with trails, laser beams, particles. World units are cells; Sc says where they land on the screen:
//   Sc = { w, h, pr, scale (px per cell), ox, oy (where world 0,0 is, px), shx, shy (shake, px), time (s), q, reduced }
//   W  = { round, fx, accent, time, meId, tags (draw name tags), youUntil (s: "you" arrow shown until), guide (lobby aim line),
//          crateSeen: Map(crate n -> time first seen) }

import { drawHead } from './avatars.js';
import { COLORS } from './rules.js';
import { castRects } from './geom.js';
import { WALL_T } from './maze.js';
import { CONFETTI, FIRE, FLASH, FRAG, MARK_LIFE, SMOKE, SPARK } from './fx.js';
import { INK, circle, clamp, easeOutBack, font, glyph, lerp, rgba, rr, shade, text } from './gfx.js';
import { mulberry32 } from './rng.js';

export const WCOL = { L: '#19d3f0', S: '#ff8a1f', G: '#ffd60a', M: '#ff4b4b', H: '#c06bff' };
const LAYER_PAD = 0.4;
const FLOOR = '#cdd1d7';
const V = { ox: 0, oy: 0, s: 1 };
const HIT = { t: 0, nx: 0, ny: 0 };
const RF = [0, 0];

// ------------------------------------------------------------------------------------------------------------------ the board
function paintFloor(c, maze, s) {
  const { cols, rows } = maze;
  // the board's shadow on the dark ground
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.55)';
  c.shadowBlur = 0.22 * s;
  c.shadowOffsetY = 0.06 * s;
  c.fillStyle = '#000';
  c.fillRect(-0.02, -0.02, cols + 0.04, rows + 0.04);
  c.restore();
  c.fillStyle = FLOOR;
  c.fillRect(0, 0, cols, rows);
  // faint checker, concrete speckle, grid
  c.fillStyle = 'rgba(40,46,60,0.045)';
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if ((x + y) & 1) c.fillRect(x, y, 1, 1);
  const rng = mulberry32(maze.seed ^ 0x9e3779b9);
  for (let i = 0; i < 320; i++) {
    const x = rng() * cols;
    const y = rng() * rows;
    const r = 0.006 + rng() * 0.014;
    c.fillStyle = rng() < 0.6 ? 'rgba(30,36,50,0.07)' : 'rgba(255,255,255,0.22)';
    c.fillRect(x, y, r, r);
  }
  c.strokeStyle = 'rgba(52,60,78,0.16)';
  c.lineWidth = 0.012;
  c.beginPath();
  for (let x = 1; x < cols; x++) {
    c.moveTo(x, 0);
    c.lineTo(x, rows);
  }
  for (let y = 1; y < rows; y++) {
    c.moveTo(0, y);
    c.lineTo(cols, y);
  }
  c.stroke();
  // small corner ticks on every cell middle
  c.strokeStyle = 'rgba(52,60,78,0.12)';
  c.lineWidth = 0.01;
  c.beginPath();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      c.moveTo(x + 0.5 - 0.035, y + 0.5);
      c.lineTo(x + 0.5 + 0.035, y + 0.5);
      c.moveTo(x + 0.5, y + 0.5 - 0.035);
      c.lineTo(x + 0.5, y + 0.5 + 0.035);
    }
  }
  c.stroke();
  // light falls off towards the edges
  const g = c.createRadialGradient(cols / 2, rows / 2, Math.min(cols, rows) * 0.25, cols / 2, rows / 2, Math.max(cols, rows) * 0.72);
  g.addColorStop(0, 'rgba(255,255,255,0.1)');
  g.addColorStop(1, 'rgba(8,10,18,0.2)');
  c.fillStyle = g;
  c.fillRect(0, 0, cols, rows);
}

function paintWalls(c, maze, accent) {
  const { cols, rows, rects } = maze;
  const hw = WALL_T / 2;
  // the coloured frame outside the border
  c.lineJoin = 'miter';
  c.strokeStyle = accent;
  c.lineWidth = 0.09;
  c.strokeRect(-hw - 0.012, -hw - 0.012, cols + WALL_T + 0.024, rows + WALL_T + 0.024);
  // drop shadow of every wall at once
  c.fillStyle = 'rgba(10,12,20,0.34)';
  c.beginPath();
  for (const [x0, y0, x1, y1] of rects) c.rect(x0 + 0.055, y0 + 0.075, x1 - x0, y1 - y0);
  c.fill();
  // dark edge, then the top face a little inside it (the bevel)
  c.fillStyle = '#10121a';
  c.beginPath();
  for (const [x0, y0, x1, y1] of rects) c.rect(x0, y0, x1 - x0, y1 - y0);
  c.fill();
  const g = c.createLinearGradient(0, 0, 0, rows);
  g.addColorStop(0, '#4b5269');
  g.addColorStop(1, '#2b3043');
  c.fillStyle = g;
  c.beginPath();
  const e = 0.014;
  for (const [x0, y0, x1, y1] of rects) c.rect(x0 + e, y0 + e, x1 - x0 - 2 * e, y1 - y0 - 2 * e);
  c.fill();
  // lit top and left edges
  c.fillStyle = 'rgba(255,255,255,0.13)';
  for (const [x0, y0, x1, y1] of rects) {
    if (x1 - x0 > y1 - y0) c.fillRect(x0 + 0.03, y0 + e, x1 - x0 - 0.06, 0.012);
    else c.fillRect(x0 + e, y0 + 0.03, 0.012, y1 - y0 - 0.06);
  }
  // the border walls carry the colour along their middle
  c.strokeStyle = accent;
  c.globalAlpha = 0.9;
  c.lineWidth = 0.022;
  c.strokeRect(0, 0, cols, rows);
  c.globalAlpha = 1;
}

const LAYER_MAX_PX = 6e6; // a board bigger than this is drawn a little softer rather than eating the phone's memory

function makeLayer(Sc, maze, paint) {
  const s = Sc.scale * Sc.pr;
  const w = Math.ceil((maze.cols + 2 * LAYER_PAD) * s);
  const h = Math.ceil((maze.rows + 2 * LAYER_PAD) * s);
  if (!(w > 0 && h > 0) || w > 16384 || h > 16384) throw new Error('layer size');
  const k = Math.min(1, Math.sqrt(LAYER_MAX_PX / (w * h)));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil(w * k));
  cv.height = Math.max(1, Math.ceil(h * k));
  const c = cv.getContext('2d');
  if (!c) throw new Error('no 2d');
  c.setTransform(s * k, 0, 0, s * k, LAYER_PAD * s * k, LAYER_PAD * s * k);
  paint(c, s * k);
  return { cv, w, h }; // w and h: the size it covers on the screen, in device pixels
}

function ensureCache(Sc, maze, accent) {
  const key = `${maze.seed}|${accent}|${Math.round(Sc.scale * 4)}|${Sc.pr}`;
  if (Sc.cache && Sc.cache.key === key) return Sc.cache;
  const cache = { key, floor: null, walls: null };
  try {
    cache.floor = makeLayer(Sc, maze, (c, s) => paintFloor(c, maze, s));
    cache.walls = makeLayer(Sc, maze, (c) => paintWalls(c, maze, accent));
  } catch {
    cache.floor = null; // painted straight on the screen every frame instead
    cache.walls = null;
  }
  Sc.cache = cache;
  return cache;
}

function blit(ctx, Sc, layer) {
  ctx.drawImage(layer.cv, V.ox - LAYER_PAD * V.s, V.oy - LAYER_PAD * V.s, layer.w / Sc.pr, layer.h / Sc.pr);
}

/** Paint a world-space routine straight on the screen (the fallback when there is no offscreen canvas). */
function direct(ctx, Sc, paint) {
  ctx.save();
  ctx.translate(V.ox, V.oy);
  ctx.scale(V.s, V.s);
  paint(ctx, V.s * Sc.pr);
  ctx.restore();
}

function drawBackdrop(ctx, Sc) {
  ctx.fillStyle = '#0f1118';
  ctx.fillRect(0, 0, Sc.w, Sc.h);
  const g = ctx.createRadialGradient(Sc.w / 2, Sc.h / 2, 0, Sc.w / 2, Sc.h / 2, Math.max(Sc.w, Sc.h) * 0.7);
  g.addColorStop(0, '#1b1f2b');
  g.addColorStop(1, '#0b0d13');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, Sc.w, Sc.h);
}

// ------------------------------------------------------------------------------------------------------------------ marks on the floor
function drawMarks(ctx, fx) {
  const n = fx.markCount;
  if (!n) return;
  const cap = fx.markCapNow();
  const marks = fx.marks;
  const start = (fx.markHead - n + cap * 4) % cap;
  const now = fx.t;
  ctx.lineCap = 'butt';
  ctx.lineWidth = 0.07 * V.s;
  for (let bucket = 0; bucket < 4; bucket++) {
    ctx.strokeStyle = `rgba(28,32,44,${0.3 - bucket * 0.07})`;
    ctx.beginPath();
    let any = false;
    for (let j = 0; j < n; j++) {
      const b = ((start + j) % cap) * 5;
      const age = (now - marks[b + 4]) / MARK_LIFE;
      if (age < 0 || age >= 1) continue;
      if (Math.min(3, Math.floor(age * 4)) !== bucket) continue;
      ctx.moveTo(V.ox + marks[b] * V.s, V.oy + marks[b + 1] * V.s);
      ctx.lineTo(V.ox + marks[b + 2] * V.s, V.oy + marks[b + 3] * V.s);
      any = true;
    }
    if (any) ctx.stroke();
  }
}

function drawDecals(ctx, fx) {
  for (const d of fx.decals) {
    const x = V.ox + d.x * V.s;
    const y = V.oy + d.y * V.s;
    const r = d.r * V.s;
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    g.addColorStop(0, 'rgba(12,12,18,0.82)');
    g.addColorStop(0.55, 'rgba(18,18,26,0.55)');
    g.addColorStop(1, 'rgba(18,18,26,0)');
    ctx.fillStyle = g;
    circle(ctx, x, y, r);
    ctx.fill();
    ctx.fillStyle = 'rgba(14,14,20,0.32)';
    for (let i = 0; i < 6; i++) {
      const a = d.rot + i * 1.047 + d.seed * 3;
      const rr2 = r * (0.55 + ((i * 37 + d.seed * 100) % 10) / 22);
      circle(ctx, x + Math.cos(a) * rr2, y + Math.sin(a) * rr2, r * (0.12 + ((i * 13) % 5) / 40));
      ctx.fill();
    }
  }
}

// ------------------------------------------------------------------------------------------------------------------ crates and mines
export function drawWeaponIcon(ctx, kind, x, y, size, col = '#ffffff') {
  const u = size / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.4, u * 0.22);
  if (kind === 'L') {
    ctx.beginPath();
    ctx.moveTo(-u * 0.8, u * 0.55);
    ctx.lineTo(-u * 0.25, -u * 0.5);
    ctx.lineTo(u * 0.25, u * 0.5);
    ctx.lineTo(u * 0.8, -u * 0.55);
    ctx.stroke();
  } else if (kind === 'S') {
    for (let i = -2; i <= 2; i++) {
      const a = -Math.PI / 2 + i * 0.4;
      ctx.beginPath();
      ctx.moveTo(0, u * 0.7);
      ctx.lineTo(Math.cos(a) * u * 0.62, u * 0.7 + Math.sin(a) * u * 1.3);
      ctx.stroke();
      circle(ctx, Math.cos(a) * u * 0.8, u * 0.7 + Math.sin(a) * u * 1.5, u * 0.14);
      ctx.fill();
    }
  } else if (kind === 'G') {
    for (let i = -1; i <= 1; i++) {
      rr(ctx, -u * 0.75, i * u * 0.5 - u * 0.14, u * 1.5, u * 0.28, u * 0.14);
      ctx.fill();
    }
  } else if (kind === 'M') {
    circle(ctx, 0, 0, u * 0.5);
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.moveTo(Math.cos(a) * u * 0.55, Math.sin(a) * u * 0.55);
      ctx.lineTo(Math.cos(a) * u * 0.92, Math.sin(a) * u * 0.92);
    }
    ctx.stroke();
  } else if (kind === 'H') {
    ctx.rotate(-Math.PI / 4);
    rr(ctx, -u * 0.7, -u * 0.2, u * 1.1, u * 0.4, u * 0.16);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(u * 0.35, -u * 0.26);
    ctx.lineTo(u * 0.95, 0);
    ctx.lineTo(u * 0.35, u * 0.26);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-u * 0.5, -u * 0.2);
    ctx.lineTo(-u * 0.78, -u * 0.55);
    ctx.lineTo(-u * 0.2, -u * 0.2);
    ctx.moveTo(-u * 0.5, u * 0.2);
    ctx.lineTo(-u * 0.78, u * 0.55);
    ctx.lineTo(-u * 0.2, u * 0.2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCrates(ctx, W) {
  const { round } = W;
  for (const c of round.crates) {
    if (round.claimed.has(c.n)) continue;
    const seen = W.crateSeen ? W.crateSeen.get(c.n) : undefined;
    const age = seen === undefined ? 9 : W.time - seen;
    const pop = age < 0.45 ? easeOutBack(age / 0.45) : 1;
    const bob = Math.sin(W.time * 3 + c.n) * 0.025;
    const x = V.ox + c.x * V.s;
    const y = V.oy + (c.y + bob) * V.s;
    const col = WCOL[c.kind] || '#fff';
    const half = 0.17 * V.s * pop;
    // a ring that pings out when it lands, and a soft glow
    if (age < 0.7) {
      ctx.strokeStyle = rgba(col, 0.8 * (1 - age / 0.7));
      ctx.lineWidth = 0.03 * V.s;
      circle(ctx, x, y, (0.2 + age * 1.1) * V.s);
      ctx.stroke();
    }
    const glow = ctx.createRadialGradient(x, y, half * 0.4, x, y, half * 2.4);
    glow.addColorStop(0, rgba(col, 0.35 + 0.1 * Math.sin(W.time * 5)));
    glow.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = glow;
    circle(ctx, x, y, half * 2.4);
    ctx.fill();
    // shadow, crate, icon
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    rr(ctx, x - half + 0.03 * V.s, y - half + 0.045 * V.s, half * 2, half * 2, half * 0.3);
    ctx.fill();
    rr(ctx, x - half, y - half, half * 2, half * 2, half * 0.3);
    ctx.fillStyle = '#1c2029';
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, 0.035 * V.s);
    ctx.strokeStyle = col;
    ctx.stroke();
    rr(ctx, x - half * 0.82, y - half * 0.82, half * 1.64, half * 1.64, half * 0.22);
    ctx.fillStyle = rgba(col, 0.2);
    ctx.fill();
    drawWeaponIcon(ctx, c.kind, x, y, half * 1.5, col);
  }
}

function drawMines(ctx, W) {
  for (const m of W.round.mines) {
    if (m.dead) continue;
    const x = V.ox + m.x * V.s;
    const y = V.oy + m.y * V.s;
    const r = 0.085 * V.s;
    if (!m.armed) {
      // arming: a light blinks
      const on = Math.floor(m.age * 8) % 2 === 0;
      ctx.globalAlpha = 0.9;
      circle(ctx, x, y, r);
      ctx.fillStyle = '#20232c';
      ctx.fill();
      circle(ctx, x, y, r * 0.35);
      ctx.fillStyle = on ? '#ff3b3b' : '#4a1d1d';
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      // armed: barely there
      ctx.globalAlpha = 0.22;
      circle(ctx, x, y, r);
      ctx.fillStyle = '#20232c';
      ctx.fill();
      ctx.strokeStyle = '#0c0e13';
      ctx.lineWidth = Math.max(1, 0.012 * V.s);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

// ------------------------------------------------------------------------------------------------------------------ shots and beams
function drawShot(ctx, s, W) {
  const n = s.tn;
  const x = V.ox + s.x * V.s;
  const y = V.oy + s.y * V.s;
  const kind = s.k;
  const col = kind === 'S' ? '#ff9f2e' : kind === 'G' ? '#ffd60a' : kind === 'H' ? '#c06bff' : '#15171d';
  // fade out in the last half second
  const fade = clamp((s.life - s.age) / 0.5, 0, 1);
  if (fade <= 0) return;
  ctx.globalAlpha = fade;
  if (n > 1) {
    const T = s.tx.length;
    const first = (s.th - n + T * 2) % T;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = kind === 'N' ? 'rgba(20,24,36,0.2)' : rgba(col, 0.28);
    ctx.lineWidth = s.r * 2.1 * V.s;
    ctx.beginPath();
    ctx.moveTo(V.ox + s.tx[first] * V.s, V.oy + s.ty[first] * V.s);
    for (let j = 1; j < n; j++) {
      const i = (first + j) % T;
      ctx.lineTo(V.ox + s.tx[i] * V.s, V.oy + s.ty[i] * V.s);
    }
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.strokeStyle = kind === 'N' ? 'rgba(20,24,36,0.34)' : rgba(col, 0.5);
    ctx.lineWidth = s.r * 1.2 * V.s;
    ctx.beginPath();
    const from = Math.max(0, n - 5);
    const i0 = (first + from) % T;
    ctx.moveTo(V.ox + s.tx[i0] * V.s, V.oy + s.ty[i0] * V.s);
    for (let j = from + 1; j < n; j++) {
      const i = (first + j) % T;
      ctx.lineTo(V.ox + s.tx[i] * V.s, V.oy + s.ty[i] * V.s);
    }
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  if (kind === 'H') {
    const a = Math.atan2(s.dy, s.dx);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.scale(V.s, V.s);
    const flick = 0.7 + 0.3 * Math.sin(W.time * 60);
    ctx.fillStyle = `rgba(255,170,40,${0.85 * flick})`;
    ctx.beginPath();
    ctx.moveTo(-0.06, -0.025);
    ctx.lineTo(-0.06 - 0.13 * flick, 0);
    ctx.lineTo(-0.06, 0.025);
    ctx.fill();
    rr(ctx, -0.07, -0.03, 0.13, 0.06, 0.02);
    ctx.fillStyle = '#e9ecf3';
    ctx.fill();
    ctx.lineWidth = 0.012;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = '#c06bff';
    ctx.beginPath();
    ctx.moveTo(0.05, -0.03);
    ctx.lineTo(0.1, 0);
    ctx.lineTo(0.05, 0.03);
    ctx.fill();
    ctx.fillStyle = '#c06bff';
    ctx.fillRect(-0.07, -0.05, 0.035, 0.02);
    ctx.fillRect(-0.07, 0.03, 0.035, 0.02);
    ctx.restore();
  } else {
    circle(ctx, x, y, s.r * V.s);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.lineWidth = Math.max(1, 0.011 * V.s);
    ctx.strokeStyle = kind === 'N' ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.8)';
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawBeams(ctx, round) {
  for (const b of round.beams) {
    const age = (round.t - b.born) / b.life;
    if (age < 0 || age >= 1) continue;
    const a = 1 - age;
    const pts = b.pts;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [w, col, al] of [
      [0.13, '#19d3f0', 0.2],
      [0.06, '#7defff', 0.55],
      [0.022, '#ffffff', 0.95],
    ]) {
      ctx.strokeStyle = rgba(col, al * a);
      ctx.lineWidth = w * V.s * (0.6 + 0.4 * a);
      ctx.beginPath();
      ctx.moveTo(V.ox + pts[0] * V.s, V.oy + pts[1] * V.s);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(V.ox + pts[i] * V.s, V.oy + pts[i + 1] * V.s);
      ctx.stroke();
    }
    ctx.fillStyle = rgba('#ffffff', 0.9 * a);
    for (let i = 2; i < pts.length; i += 2) {
      circle(ctx, V.ox + pts[i] * V.s, V.oy + pts[i + 1] * V.s, 0.05 * V.s * (1 + age));
      ctx.fill();
    }
  }
}

/** A faint line along the barrel with two bounces: only in the lobby, where it teaches the one thing the game is about. */
function drawGuide(ctx, round, k, time) {
  let x = k.x + Math.cos(k.a) * 0.31;
  let y = k.y + Math.sin(k.a) * 0.31;
  let dx = Math.cos(k.a);
  let dy = Math.sin(k.a);
  ctx.save();
  ctx.setLineDash([0.05 * V.s, 0.07 * V.s]);
  ctx.lineDashOffset = -time * 0.5 * V.s;
  ctx.lineWidth = Math.max(1.5, 0.02 * V.s);
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const wall = castRects(round.rc, round.nrc, x, y, dx, dy, 14, 0.045, HIT);
    const len = wall ? HIT.t : 14;
    const ex = x + dx * len;
    const ey = y + dy * len;
    ctx.strokeStyle = `rgba(255,255,255,${0.62 - i * 0.2})`;
    ctx.beginPath();
    ctx.moveTo(V.ox + x * V.s, V.oy + y * V.s);
    ctx.lineTo(V.ox + ex * V.s, V.oy + ey * V.s);
    ctx.stroke();
    if (!wall) break;
    const nx = HIT.nx;
    const ny = HIT.ny;
    const d = dx * nx + dy * ny;
    RF[0] = dx - 2 * d * nx;
    RF[1] = dy - 2 * d * ny;
    dx = RF[0];
    dy = RF[1];
    x = ex + nx * 1e-6;
    y = ey + ny * 1e-6;
  }
  ctx.restore();
}

// ------------------------------------------------------------------------------------------------------------------ tanks
function tankShadow(ctx, k) {
  const x = V.ox + (k.x + 0.045) * V.s;
  const y = V.oy + (k.y + 0.065) * V.s;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(k.a);
  ctx.scale(V.s, V.s);
  ctx.fillStyle = 'rgba(8,10,18,0.3)';
  rr(ctx, -0.22, -0.17, 0.44, 0.34, 0.05);
  ctx.fill();
  ctx.restore();
}

function drawTank(ctx, k, W) {
  const col = COLORS[k.c % COLORS.length];
  const v = k.vis;
  const x = V.ox + k.x * V.s;
  const y = V.oy + k.y * V.s;
  const sc = v.pop > 0 ? 0.5 + 0.5 * easeOutBack(1 - v.pop) : 1;
  if (k.me) {
    // a ring that is always there: this one is yours
    const pulse = 0.55 + 0.25 * Math.sin(W.time * 4);
    ctx.strokeStyle = `rgba(255,255,255,${pulse})`;
    ctx.lineWidth = Math.max(1.5, 0.028 * V.s);
    circle(ctx, x, y, 0.36 * V.s);
    ctx.stroke();
    ctx.strokeStyle = rgba(col.main, 0.9);
    ctx.lineWidth = Math.max(1, 0.012 * V.s);
    circle(ctx, x, y, 0.385 * V.s);
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(k.a);
  ctx.scale(V.s * sc, V.s * sc);
  // power-up glow
  if (k.weapon) {
    const wc = WCOL[k.weapon.k] || '#fff';
    ctx.strokeStyle = rgba(wc, 0.55 + 0.3 * Math.sin(W.time * 8));
    ctx.lineWidth = 0.03;
    rr(ctx, -0.26, -0.21, 0.52, 0.42, 0.09);
    ctx.stroke();
  }
  // treads with links that run with the ground
  for (const sy of [-1, 1]) {
    rr(ctx, -0.215, sy * 0.105 - 0.058, 0.43, 0.116, 0.04);
    ctx.fillStyle = '#171a21';
    ctx.fill();
    ctx.strokeStyle = '#2d323e';
    ctx.lineWidth = 0.012;
    ctx.beginPath();
    const ph = ((v.track % 0.06) + 0.06) % 0.06;
    for (let i = -4; i <= 4; i++) {
      const lx = i * 0.06 + ph;
      if (lx < -0.195 || lx > 0.195) continue;
      ctx.moveTo(lx, sy * 0.105 - 0.05);
      ctx.lineTo(lx, sy * 0.105 + 0.05);
    }
    ctx.stroke();
  }
  // hull
  rr(ctx, -0.178, -0.1, 0.356, 0.2, 0.05);
  ctx.fillStyle = col.main;
  ctx.fill();
  ctx.lineWidth = 0.02;
  ctx.strokeStyle = col.dark;
  ctx.stroke();
  rr(ctx, -0.16, -0.083, 0.32, 0.055, 0.025);
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fill();
  rr(ctx, -0.16, 0.03, 0.32, 0.05, 0.025);
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.fill();
  // rear vents
  ctx.strokeStyle = col.dark;
  ctx.lineWidth = 0.014;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    ctx.moveTo(-0.15, -0.045 + i * 0.045);
    ctx.lineTo(-0.1, -0.045 + i * 0.045);
  }
  ctx.stroke();
  if (k.weapon) {
    ctx.fillStyle = WCOL[k.weapon.k] || '#fff';
    circle(ctx, -0.125, 0, 0.026);
    ctx.fill();
  }
  // barrel (kicks back when it fires), then the turret over it
  const kick = v.recoil * 0.045;
  rr(ctx, 0.03 - kick, -0.024, 0.27, 0.048, 0.014);
  ctx.fillStyle = '#2b2f3a';
  ctx.fill();
  ctx.strokeStyle = '#0f1218';
  ctx.lineWidth = 0.012;
  ctx.stroke();
  rr(ctx, 0.04 - kick, -0.012, 0.22, 0.012, 0.005);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fill();
  rr(ctx, 0.27 - kick, -0.033, 0.045, 0.066, 0.012);
  ctx.fillStyle = col.dark;
  ctx.fill();
  circle(ctx, 0, 0, 0.092);
  ctx.fillStyle = shade(col.main, 0.12);
  ctx.fill();
  ctx.lineWidth = 0.02;
  ctx.strokeStyle = col.dark;
  ctx.stroke();
  circle(ctx, 0, 0, 0.058);
  ctx.fillStyle = col.dark;
  ctx.fill();
  ctx.rotate(-k.a); // the symbol stays upright
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  glyph(ctx, k.c, 0, 0, 0.034);
  ctx.restore();
  if (v.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${0.7 * v.flash})`;
    circle(ctx, x, y, 0.22 * V.s);
    ctx.fill();
  }
}

/** A name tag above a tank: the avatar head, the name, and a tick when they are ready. */
function drawTag(ctx, k, Sc) {
  if (!k.tag) return;
  const u = Sc.u;
  const size = 15 * u;
  const x = V.ox + k.x * V.s;
  const y = V.oy + (k.y - 0.42) * V.s - 6 * u;
  const col = COLORS[k.c % COLORS.length];
  ctx.font = font(size, 600);
  const tw = ctx.measureText(k.tag).width;
  const head = size * 0.62;
  const wTotal = head * 2 + 6 * u + tw + 10 * u + (k.ready ? size * 1.0 : 0);
  const h = size * 1.35;
  const x0 = x - wTotal / 2;
  ctx.fillStyle = 'rgba(12,14,20,0.8)';
  ctx.fillRect(x0, y - h / 2, wTotal, h);
  ctx.fillStyle = col.main;
  ctx.fillRect(x0, y - h / 2, 3 * u, h);
  drawHead(ctx, k.id, x0 + 3 * u + 3 * u + head, y, head, { bot: k.bot, name: k.tag, color: col.main, lw: 1.2 });
  ctx.font = font(size, 600);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(k.tag, x0 + 3 * u + 6 * u + head * 2 + 3 * u, y + size * 0.04);
  if (k.ready) {
    ctx.strokeStyle = '#46e07a';
    ctx.lineWidth = Math.max(2, size * 0.16);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const cx = x0 + wTotal - size * 0.62;
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.25, y);
    ctx.lineTo(cx - size * 0.05, y + size * 0.22);
    ctx.lineTo(cx + size * 0.3, y - size * 0.2);
    ctx.stroke();
  }
}

/** The arrow over your own tank when a round starts. */
function drawYou(ctx, k, Sc, W) {
  const t = W.youUntil - W.time;
  if (t <= 0) return;
  const u = Sc.u;
  const a = Math.min(1, t * 2);
  const x = V.ox + k.x * V.s;
  const y = V.oy + (k.y - 0.5) * V.s - 8 * u + Math.sin(W.time * 7) * 3 * u;
  ctx.globalAlpha = a;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(8,10,16,0.85)';
  ctx.lineWidth = 3 * u;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y + 9 * u);
  ctx.lineTo(x - 9 * u, y - 5 * u);
  ctx.lineTo(x + 9 * u, y - 5 * u);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  text(ctx, 'YOU', x, y - 16 * u, 17 * u, { weight: 700 });
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------------------------------------------------------ particles
function drawParticles(ctx, fx) {
  // ordinary ones first
  for (const p of fx.parts) {
    if (!p.on || p.k === FLASH || p.k === FIRE) continue;
    const u = p.age / p.life;
    const x = V.ox + p.x * V.s;
    const y = V.oy + p.y * V.s;
    if (p.k === SPARK) {
      ctx.strokeStyle = p.col;
      ctx.globalAlpha = 1 - u;
      ctx.lineWidth = Math.max(1, p.r * V.s);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - p.vx * 0.035 * V.s, y - p.vy * 0.035 * V.s);
      ctx.stroke();
    } else if (p.k === SMOKE) {
      ctx.globalAlpha = 0.5 * (1 - u) * (1 - u * 0.4);
      ctx.fillStyle = p.col;
      circle(ctx, x, y, lerp(p.r, p.r1, u) * V.s);
      ctx.fill();
    } else if (p.k === FRAG) {
      ctx.globalAlpha = u > 0.7 ? (1 - u) / 0.3 : 1;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.col;
      const r = lerp(p.r, p.r1, u) * V.s;
      ctx.fillRect(-r, -r * 0.6, r * 2, r * 1.2);
      ctx.restore();
    } else if (p.k === CONFETTI) {
      ctx.globalAlpha = u > 0.75 ? (1 - u) / 0.25 : 1;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.rot * 2));
      ctx.fillStyle = p.col;
      const r = p.r * V.s;
      ctx.fillRect(-r, -r * 0.55, r * 2, r * 1.1);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  // glows add up
  ctx.globalCompositeOperation = 'lighter';
  for (const p of fx.parts) {
    if (!p.on || (p.k !== FLASH && p.k !== FIRE)) continue;
    const u = p.age / p.life;
    ctx.globalAlpha = p.k === FLASH ? Math.pow(1 - u, 1.5) : 0.75 * (1 - u);
    ctx.fillStyle = p.col;
    circle(ctx, V.ox + p.x * V.s, V.oy + p.y * V.s, lerp(p.r, p.r1, Math.sqrt(u)) * V.s);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  for (const r of fx.rings) {
    if (!r.on) continue;
    const u = r.age / r.life;
    ctx.globalAlpha = 1 - u;
    ctx.strokeStyle = r.col;
    ctx.lineWidth = Math.max(1, r.lw * V.s * (1 - u * 0.6));
    circle(ctx, V.ox + r.x * V.s, V.oy + r.y * V.s, lerp(r.r0, r.r1, 1 - Math.pow(1 - u, 2)) * V.s);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawPopups(ctx, fx, Sc) {
  for (const p of fx.popups) {
    if (!p.on || p.delay > 0) continue;
    const u = p.age / p.life;
    const pop = u < 0.15 ? easeOutBack(u / 0.15) : 1;
    text(ctx, p.text, V.ox + p.x * V.s, V.oy + (p.y - 0.15 - u * 0.55) * V.s, 24 * Sc.u * p.size * pop, { fill: p.col, alpha: u > 0.7 ? (1 - u) / 0.3 : 1, weight: 700 });
  }
}

/** One tank drawn alone (the store art's icon): its shadow and body at Sc's scale, world 0,0 at Sc.ox, Sc.oy. */
export function drawTankSolo(ctx, Sc, k, W) {
  V.ox = Sc.ox;
  V.oy = Sc.oy;
  V.s = Sc.scale;
  tankShadow(ctx, k);
  drawTank(ctx, k, W);
}

// ------------------------------------------------------------------------------------------------------------------ the whole world
export function drawWorld(ctx, Sc, W) {
  ctx.setTransform(Sc.pr, 0, 0, Sc.pr, 0, 0);
  drawBackdrop(ctx, Sc);
  const { round, fx } = W;
  if (!round) return;
  V.ox = Sc.ox + Sc.shx;
  V.oy = Sc.oy + Sc.shy;
  V.s = Sc.scale;
  const cache = ensureCache(Sc, round.maze, W.accent);
  if (cache.floor) blit(ctx, Sc, cache.floor);
  else direct(ctx, Sc, (c, s) => paintFloor(c, round.maze, s));
  drawDecals(ctx, fx);
  drawMarks(ctx, fx);
  drawCrates(ctx, W);
  drawMines(ctx, W);
  if (cache.walls) blit(ctx, Sc, cache.walls);
  else direct(ctx, Sc, (c) => paintWalls(c, round.maze, W.accent));
  const tanks = round.tanks;
  for (const k of tanks) if (k.alive && !k.hidden) tankShadow(ctx, k);
  if (W.guide) for (const k of tanks) if (k.me && k.alive) drawGuide(ctx, round, k, W.time);
  for (const k of tanks) if (k.alive && !k.hidden) drawTank(ctx, k, W);
  for (const s of round.shots) if (!s.dead) drawShot(ctx, s, W);
  drawBeams(ctx, round);
  drawParticles(ctx, fx);
  if (W.tags) for (const k of tanks) if (k.alive && !k.hidden) drawTag(ctx, k, Sc);
  for (const k of tanks) if (k.me && k.alive && !k.hidden) drawYou(ctx, k, Sc, W);
  // practice targets
  for (const g of round.targets) drawTarget(ctx, g, W);
  drawPopups(ctx, fx, Sc);
}

function drawTarget(ctx, g, W) {
  const x = V.ox + g.x * V.s;
  const y = V.oy + g.y * V.s;
  if (g.hitAt >= 0) {
    const age = (W.round.t - g.hitAt) / 1000;
    if (age < 0.5) {
      ctx.globalAlpha = 1 - age / 0.5;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.03 * V.s;
      circle(ctx, x, y, (0.2 + age * 0.5) * V.s);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    return;
  }
  const r = g.r * V.s;
  ctx.fillStyle = 'rgba(8,10,18,0.25)';
  circle(ctx, x + 0.025 * V.s, y + 0.035 * V.s, r);
  ctx.fill();
  const rings = ['#f4f6fb', '#e63946', '#f4f6fb', '#e63946'];
  for (let i = 0; i < 4; i++) {
    circle(ctx, x, y, r * (1 - i * 0.24));
    ctx.fillStyle = rings[i];
    ctx.fill();
  }
  ctx.lineWidth = Math.max(1, 0.012 * V.s);
  ctx.strokeStyle = INK;
  circle(ctx, x, y, r);
  ctx.stroke();
}

