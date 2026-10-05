// Every screen drawn over the world: the title, the lobby's settings, the countdown, the top bar, the round banner, the points
// bar, the podium. Flat dark panels with a thin accent edge, Teko labels of one to three words, big numerals. Sc.u is the size
// unit (about 1 on a phone held sideways, about 1.7 on a laptop). Everything here only reads what it is given.

import { drawHead } from './avatars.js';
import { drawWeaponIcon, WCOL } from './draw.js';
import { COLORS, WEAPON } from './rules.js';
import { INK, circle, clamp, easeOutBack, easeOutCubic, font, glyph, lerp, rgba, rr, shade, text } from './gfx.js';

export const rects = { play: null, goal: [] };

const PANEL = 'rgba(12,14,21,0.84)';
const DIM = 'rgba(255,255,255,0.62)';

/** Text with room between the letters (headings). o.maxW: shrink it to fit that width. Returns the width. */
function tracked(ctx, str, x, y, size, o = {}) {
  let ws = [];
  let total = 0;
  let sp = 0;
  for (let pass = 0; pass < 2; pass++) {
    sp = (o.spacing ?? 0.06) * size;
    ctx.font = font(size, o.weight || 700);
    total = -sp;
    ws = [];
    for (const ch of str) {
      const w = ctx.measureText(ch).width;
      ws.push(w);
      total += w + sp;
    }
    if (!o.maxW || total <= o.maxW || total <= 0) break;
    size *= o.maxW / total;
  }
  let cx = (o.align || 'center') === 'center' ? x - total / 2 : (o.align || 'center') === 'right' ? x - total : x;
  let i = 0;
  const lw = o.lw !== undefined ? o.lw * (size / (o.size0 || size)) : undefined;
  for (const ch of str) {
    text(ctx, ch, cx + ws[i] / 2, y, size, { ...o, lw, align: 'center' });
    cx += ws[i] + sp;
    i++;
  }
  return total;
}

/** The size at which `str` fits in maxW (the given size when it already does): names come from other people and can be long. */
function fit(ctx, str, size, maxW, weight = 600) {
  ctx.font = font(size, weight);
  const w = ctx.measureText(str).width;
  return w > maxW && w > 0 ? Math.max(8, (size * maxW) / w) : size;
}

function panel(ctx, x, y, w, h, accent, edge = 'top') {
  ctx.fillStyle = PANEL;
  ctx.fillRect(x, y, w, h);
  if (accent) {
    ctx.fillStyle = accent;
    const t = Math.max(2, Math.round(h * 0.04));
    if (edge === 'top') ctx.fillRect(x, y, w, t);
    else if (edge === 'bottom') ctx.fillRect(x, y + h - t, w, t);
    else ctx.fillRect(x, y, Math.max(3, t), h);
  }
}

function shadowOverlay(ctx, Sc, a) {
  const g = ctx.createLinearGradient(0, 0, 0, Sc.h);
  g.addColorStop(0, `rgba(6,8,14,${a})`);
  g.addColorStop(0.5, `rgba(6,8,14,${a * 0.45})`);
  g.addColorStop(1, `rgba(6,8,14,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, Sc.w, Sc.h);
}

/**
 * Where a band or panel of height `bh` goes so it does not sit on the tank that matters (`avoid`: its screen y and how far around it
 * to keep clear): the middle if that is clear, else the top, else the bottom. Returns the band's top.
 */
function placeBand(Sc, bh, middleTop, avoid, topMin, bottomPad) {
  if (!avoid) return middleTop;
  const clear = (t) => t > avoid.y + avoid.r || t + bh < avoid.y - avoid.r;
  if (clear(middleTop)) return middleTop;
  const top = topMin;
  if (clear(top)) return top;
  const bottom = Sc.h - bh - bottomPad;
  return clear(bottom) ? bottom : middleTop;
}

function keycap(ctx, label, x, y, size) {
  ctx.font = font(size, 600);
  const w = ctx.measureText(label).width + size * 0.9;
  const h = size * 1.45;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  rr(ctx, x - w / 2, y - h / 2, w, h, size * 0.22);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = Math.max(1.2, size * 0.09);
  ctx.stroke();
  text(ctx, label, x, y + size * 0.03, size, { lw: 0, weight: 600 });
}

// ------------------------------------------------------------------------------------------------------------------ title
export function drawTitle(ctx, Sc, t, o = {}) {
  const u = Sc.u;
  const accent = o.accent || '#ff7a1a';
  ctx.setTransform(Sc.pr, 0, 0, Sc.pr, 0, 0);
  shadowOverlay(ctx, Sc, 0.62);
  const cx = Sc.w / 2;
  const compact = Sc.h < 330;
  const cy = Sc.h * (compact ? 0.38 : 0.4);
  const big = (compact ? 64 : 84) * u;
  // the logo, slanted
  ctx.save();
  ctx.translate(cx, cy);
  ctx.transform(1, 0, -0.14, 1, 0, 0);
  const maxW = Sc.w * 0.86;
  tracked(ctx, 'MAZE TANK', 0, -big * 0.55, big, { weight: 700, lw: big * 0.1, spacing: 0.05, maxW, size0: big });
  tracked(ctx, 'BATTLE', 0, big * 0.55, big * 1.28, { weight: 700, fill: accent, lw: big * 0.13, spacing: 0.06, maxW: maxW * 0.9, size0: big * 1.28 });
  // two bars either side, like a tank's treads
  ctx.fillStyle = accent;
  const bw = Math.min(Sc.w * 0.2, 260 * u);
  ctx.fillRect(-big * 3.3 - bw * 0.1, -big * 0.05, bw, 5 * u);
  ctx.fillRect(big * 2.3 - bw * 0.9, big * 1.0, bw, 5 * u);
  ctx.restore();
  // the one button
  const bw2 = 250 * u;
  const bh = 66 * u;
  const bx = cx - bw2 / 2;
  const by = Math.min(Sc.h - bh - 30 * u, cy + big * 1.55);
  const pulse = 1 + 0.025 * Math.sin(t * 3.2);
  ctx.save();
  ctx.translate(cx, by + bh / 2);
  ctx.scale(pulse, pulse);
  ctx.fillStyle = shade(accent, -0.45);
  ctx.fillRect(-bw2 / 2, -bh / 2 + 5 * u, bw2, bh);
  ctx.fillStyle = accent;
  ctx.fillRect(-bw2 / 2, -bh / 2, bw2, bh);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(-bw2 / 2, -bh / 2, bw2, bh * 0.08);
  // a play triangle and the word
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(-bw2 * 0.28, -bh * 0.22);
  ctx.lineTo(-bw2 * 0.28, bh * 0.22);
  ctx.lineTo(-bw2 * 0.28 + bh * 0.4, 0);
  ctx.closePath();
  ctx.fill();
  tracked(ctx, 'PLAY', bw2 * 0.04, bh * 0.02, bh * 0.66, { weight: 700, lw: 0, spacing: 0.1 });
  if (!o.touch) keycap(ctx, 'SPACE', bw2 * 0.34, 0, bh * 0.24);
  ctx.restore();
  rects.play = { x: bx, y: by - 4 * u, w: bw2, h: bh + 10 * u };
}

// ------------------------------------------------------------------------------------------------------------------ lobby
/** On a narrow screen the settings go under the platform's buttons instead of beside them. */
const lobbyBelow = (Sc) => Sc.w < 520;

/** How much room the lobby leaves at the top of the screen for its settings. */
export const lobbyTop = (Sc) => (lobbyBelow(Sc) ? Math.round(58 + 50 * Sc.u + 8) : Math.round(58 * Sc.u));

/** The setting as large values at the top: the host taps one. o: { goal, options, isHost, hint, accent, canRoom }. */
export function drawLobbyHud(ctx, Sc, o) {
  const u = Sc.u;
  const accent = o.accent || '#ff7a1a';
  ctx.setTransform(Sc.pr, 0, 0, Sc.pr, 0, 0);
  const bh = 42 * u;
  const bw = 58 * u;
  const gap = 6 * u;
  const label = 'FIRST TO';
  ctx.font = font(22 * u, 700);
  const lw = ctx.measureText(label).width;
  const total = lw + 14 * u + o.options.length * bw + (o.options.length - 1) * gap + 20 * u;
  // beside the platform's buttons when there is room, else below them
  const below = lobbyBelow(Sc);
  const x0 = below ? Math.max(8, Sc.w / 2 - total / 2) : Math.max(140, Sc.w / 2 - total / 2);
  const y0 = below ? 58 : 6 * u;
  panel(ctx, x0, y0, total, bh + 8 * u, accent, 'bottom');
  text(ctx, label, x0 + 10 * u, y0 + (bh + 8 * u) / 2 - 2 * u, 22 * u, { align: 'left', weight: 700, lw: 0 });
  rects.goal.length = 0;
  let x = x0 + 10 * u + lw + 14 * u;
  for (const v of o.options) {
    const on = v === o.goal;
    const y = y0 + 4 * u;
    ctx.fillStyle = on ? accent : 'rgba(255,255,255,0.08)';
    ctx.fillRect(x, y, bw, bh);
    if (!on) {
      ctx.strokeStyle = o.isHost ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.16)';
      ctx.lineWidth = Math.max(1.5, 1.6 * u);
      ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
    }
    text(ctx, String(v), x + bw / 2, y + bh / 2 + u, 32 * u, { weight: 700, lw: on ? 2 * u : 0, alpha: on || o.isHost ? 1 : 0.55 });
    if (o.isHost) rects.goal.push({ x, y, w: bw, h: bh, v });
    x += bw + gap;
  }
  if (o.hint) {
    ctx.font = font(19 * u, 600);
    const hw = ctx.measureText(o.hint).width;
    if (x0 + total + 16 * u + hw < Sc.w - 8) text(ctx, o.hint, x0 + total + 16 * u, y0 + (bh + 8 * u) / 2, 19 * u, { align: 'left', fill: 'rgba(255,255,255,0.8)', weight: 600 });
    else text(ctx, o.hint, Sc.w / 2, y0 + bh + 26 * u, 19 * u, { fill: 'rgba(255,255,255,0.85)', weight: 600 });
  }
}

/** The last match's top three, over the lobby for a few seconds. */
export function drawResultsCard(ctx, Sc, o) {
  const u = Sc.u;
  const a = clamp(Math.min(o.age / 0.3, (o.life - o.age) / 0.5), 0, 1);
  if (a <= 0) return;
  const w = 250 * u;
  const rowH = 34 * u;
  const h = 34 * u + o.top.length * rowH + 8 * u;
  const x = Sc.w / 2 - w / 2;
  const y = Math.max(70 * u, Sc.h * 0.2);
  ctx.globalAlpha = a;
  panel(ctx, x, y, w, h, '#ffc400');
  tracked(ctx, 'LAST MATCH', Sc.w / 2, y + 20 * u, 19 * u, { weight: 700, lw: 0, fill: DIM, spacing: 0.1 });
  o.top.forEach((p, i) => {
    const ry = y + 34 * u + i * rowH + rowH / 2;
    ctx.fillStyle = p.me ? 'rgba(255,255,255,0.12)' : 'transparent';
    ctx.fillRect(x + 4 * u, ry - rowH / 2 + 2 * u, w - 8 * u, rowH - 4 * u);
    text(ctx, String(i + 1), x + 18 * u, ry, 24 * u, { weight: 700, fill: i === 0 ? '#ffc400' : '#ffffff', lw: 0 });
    drawHead(ctx, p.id, x + 46 * u, ry, 12 * u, { bot: p.bot, name: p.name, color: p.color });
    text(ctx, p.name, x + 66 * u, ry, fit(ctx, p.name, 20 * u, w - 66 * u - 44 * u), { align: 'left', lw: 0 });
    text(ctx, String(p.score), x + w - 16 * u, ry, 24 * u, { align: 'right', weight: 700, lw: 0 });
  });
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------------------------------------------------------ countdown and callouts
/** 3, 2, 1 (n >= 1) or GO (n = 0). frac: how far into this second (0..1). */
export function drawCountdown(ctx, Sc, n, frac, accent = '#ff7a1a') {
  const u = Sc.u;
  ctx.setTransform(Sc.pr, 0, 0, Sc.pr, 0, 0);
  const label = n >= 1 ? String(n) : 'GO';
  const k = Sc.reduced ? 1 : n >= 1 ? 1 + (1 - easeOutCubic(frac * 2)) * 0.9 : 1 + easeOutCubic(frac) * 0.35;
  const alpha = n >= 1 ? 1 : clamp(1.6 - frac * 1.6, 0, 1);
  const cx = Sc.w / 2;
  const cy = Sc.h * 0.46;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.scale(k, k);
  ctx.strokeStyle = rgba(accent, 0.85);
  ctx.lineWidth = 6 * u;
  if (n >= 1) {
    circle(ctx, 0, 0, 78 * u);
    ctx.stroke();
  }
  text(ctx, label, 0, 0, (n >= 1 ? 120 : 150) * u, { weight: 700, lw: 9 * u, fill: n >= 1 ? '#ffffff' : accent });
  ctx.restore();
}

/** A word in the middle ("ELIMINATED", "DRAW"): slides in, holds, goes. */
export function drawCallout(ctx, Sc, label, age, o = {}) {
  const u = Sc.u;
  const dur = o.dur ?? 1.6;
  if (age < 0 || age > dur) return;
  const inn = easeOutBack(clamp(age / 0.2, 0, 1));
  const out = clamp((dur - age) / 0.3, 0, 1);
  ctx.setTransform(Sc.pr, 0, 0, Sc.pr, 0, 0);
  ctx.save();
  ctx.globalAlpha = out;
  ctx.translate(Sc.w / 2, Sc.h * (o.y ?? 0.34));
  ctx.scale(inn, inn);
  const size = (o.size ?? 64) * u;
  ctx.font = font(size, 700);
  const w = ctx.measureText(label).width + size * 1.4;
  ctx.fillStyle = 'rgba(10,12,18,0.78)';
  ctx.fillRect(-w / 2, -size * 0.62, w, size * 1.24);
  ctx.fillStyle = o.color || '#ff4b4b';
  ctx.fillRect(-w / 2, -size * 0.62, w, Math.max(3, size * 0.06));
  ctx.fillRect(-w / 2, size * 0.62 - Math.max(3, size * 0.06), w, Math.max(3, size * 0.06));
  tracked(ctx, label, 0, size * 0.02, size, { weight: 700, lw: 0, spacing: 0.08 });
  ctx.restore();
}

// ------------------------------------------------------------------------------------------------------------------ the top bar
/** Do the scores go in a strip of their own under the bar? A watcher's do (the platform's "Watching" note sits at the top centre), and so do many tanks on a narrow screen. */
export const hudStrip = (Sc, n, spectating = false) => spectating || n * 40 * Sc.u + 480 * Sc.u > Sc.w;

/** The height of the bar, with its strip if it has one. */
export const hudHeight = (Sc, strip = false) => Math.round((strip ? 74 : 40) * Sc.u);

/** One chip per tank, always in the same places: the colour and its symbol, the points, a line that fills up to the goal. */
function drawChips(ctx, Sc, o, x0, cw, cy, ch) {
  const u = Sc.u;
  const narrow = Sc.w < 600;
  o.chips.forEach((c, i) => {
    const x = x0 + i * (cw + 6 * u);
    const col = COLORS[c.c % COLORS.length];
    ctx.globalAlpha = c.out ? 0.45 : 1;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x, cy - ch / 2, cw, ch);
    ctx.fillStyle = col.main;
    ctx.fillRect(x, cy - ch / 2, 4 * u, ch);
    ctx.fillStyle = '#ffffff';
    glyph(ctx, c.c, x + 4 * u + 9 * u, cy - ch * 0.16, 5.5 * u);
    text(ctx, String(c.score), x + cw - 8 * u, cy - ch * 0.08, (narrow ? 22 : 25) * u, { align: 'right', weight: 700, lw: 0 });
    // progress to the goal, along the bottom of the chip
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(x + 4 * u, cy + ch / 2 - 4 * u, cw - 4 * u, 3 * u);
    ctx.fillStyle = col.main;
    ctx.fillRect(x + 4 * u, cy + ch / 2 - 4 * u, (cw - 4 * u) * clamp(c.score / Math.max(1, o.goal), 0, 1), 3 * u);
    if (c.me) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.5, 1.6 * u);
      ctx.strokeRect(x + 0.5, cy - ch / 2 + 0.5, cw - 1, ch - 1);
    }
    if (c.out) {
      // destroyed this round: a cross over its symbol
      ctx.strokeStyle = '#ff5a5a';
      ctx.lineWidth = Math.max(2, 2.4 * u);
      ctx.lineCap = 'round';
      const px = x + 4 * u + 9 * u;
      const py = cy - ch * 0.16;
      ctx.beginPath();
      ctx.moveTo(px - 7 * u, py - 7 * u);
      ctx.lineTo(px + 7 * u, py + 7 * u);
      ctx.moveTo(px + 7 * u, py - 7 * u);
      ctx.lineTo(px - 7 * u, py + 7 * u);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
}

/**
 * o: { round, goal, chips: [{ c, score, out, me, bot }], timeLeft (ms, or Infinity), out (I am destroyed), spectating, weapon, accent }
 * (leave room for it with hudHeight(Sc, hudStrip(Sc, chips.length, spectating)))
 */
export function drawHud(ctx, Sc, o) {
  const u = Sc.u;
  const h = Math.round(40 * u);
  ctx.setTransform(Sc.pr, 0, 0, Sc.pr, 0, 0);
  ctx.fillStyle = 'rgba(11,13,19,0.86)';
  ctx.fillRect(0, 0, Sc.w, h);
  ctx.fillStyle = o.accent || '#ff7a1a';
  ctx.fillRect(0, h - 2.5 * u, Sc.w, 2.5 * u);
  const left = Math.max(140, 12 * u);
  // left: the goal, and the round
  const goalLabel = `FIRST TO ${o.goal}`;
  text(ctx, goalLabel, left, h * 0.33, 17 * u, { align: 'left', weight: 700, lw: 0 });
  text(ctx, `ROUND ${o.round}`, left, h * 0.74, Math.max(11.5, 13 * u), { align: 'left', weight: 600, lw: 0, fill: DIM });
  ctx.font = font(17 * u, 700);
  const leftW = ctx.measureText(goalLabel).width;
  // right: time and the power-up in hand
  let rx = Sc.w - 12 * u;
  const showTime = Number.isFinite(o.timeLeft);
  if (showTime) {
    const s = Math.max(0, Math.ceil(o.timeLeft / 1000));
    const label = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const low = s <= 10;
    const blink = low && Math.floor(Sc.time * 3) % 2 === 0;
    text(ctx, label, rx, h * 0.52, 27 * u, { align: 'right', weight: 700, lw: 0, fill: low ? (blink ? '#ffffff' : '#ff5a5a') : '#ffffff' });
    ctx.font = font(27 * u, 700);
    rx -= ctx.measureText(label).width + 14 * u;
  }
  if (o.out) {
    ctx.fillStyle = '#ff4b4b';
    const w = 54 * u;
    ctx.fillRect(rx - w, h * 0.2, w, h * 0.6);
    text(ctx, 'OUT', rx - w / 2, h * 0.52, 20 * u, { weight: 700, lw: 0 });
    rx -= w + 8 * u;
  } else if (o.weapon) {
    const wc = WCOL[o.weapon.k] || '#fff';
    const nm = Sc.w < 520 ? '' : WEAPON[o.weapon.k].name; // (a narrow screen has room for the picture only)
    ctx.font = font(18 * u, 700);
    const w = (nm ? ctx.measureText(nm).width + 16 * u : 0) + 34 * u + (o.weapon.k === 'G' ? 30 * u : 0);
    ctx.fillStyle = rgba(wc, 0.2);
    ctx.fillRect(rx - w, h * 0.16, w, h * 0.68);
    ctx.fillStyle = wc;
    ctx.fillRect(rx - w, h * 0.16, 3 * u, h * 0.68);
    drawWeaponIcon(ctx, o.weapon.k, rx - w + 20 * u, h * 0.5, 22 * u, wc);
    if (nm) text(ctx, nm, rx - w + 36 * u, h * 0.52, 18 * u, { align: 'left', weight: 700, lw: 0 });
    if (o.weapon.k === 'G') text(ctx, String(Math.max(0, o.weapon.ammo)), rx - 10 * u, h * 0.52, 18 * u, { align: 'right', weight: 700, lw: 0, fill: wc });
    rx -= w + 8 * u;
  }
  const n = o.chips.length;
  const ch = h * 0.72;
  if (hudStrip(Sc, n, o.spectating)) {
    // a watcher: the scores in a strip of their own, clear of the platform's note at the top centre
    const cw = clamp((Sc.w - 140 - 24 * u) / Math.max(1, n) - 6 * u, 28 * u, 62 * u);
    const total = n * cw + (n - 1) * 6 * u;
    const sh = ch + 8 * u;
    const x0 = Math.max(140 + 10 * u, Sc.w / 2 - total / 2);
    ctx.fillStyle = 'rgba(11,13,19,0.86)';
    ctx.fillRect(x0 - 10 * u, h, total + 20 * u, sh);
    ctx.fillStyle = o.accent || '#ff7a1a';
    ctx.fillRect(x0 - 10 * u, h + sh - 2.5 * u, total + 20 * u, 2.5 * u);
    drawChips(ctx, Sc, o, x0, cw, h + sh / 2 - 1.5 * u, ch);
    return;
  }
  // the middle: one chip per tank
  const free = rx - (left + leftW + 16 * u);
  const cw = clamp(free / Math.max(1, n) - 6 * u, 36 * u, 62 * u);
  const total = n * cw + (n - 1) * 6 * u;
  const cx0 = clamp(Sc.w / 2 - total / 2, left + leftW + 16 * u, Math.max(left + leftW + 16 * u, rx - total));
  drawChips(ctx, Sc, o, cx0, cw, h * 0.5 - 1.5 * u, ch);
}

// ------------------------------------------------------------------------------------------------------------------ a round begins and ends
/** The goal banner: a dark band across the middle that slides in, holds and goes. */
export function drawBanner(ctx, Sc, o) {
  const u = Sc.u;
  const { age, dur } = o;
  const inn = easeOutCubic(clamp(age / 0.28, 0, 1));
  const out = clamp((dur - age) / 0.3, 0, 1);
  if (out <= 0) return;
  ctx.setTransform(Sc.pr, 0, 0, Sc.pr, 0, 0);
  const bh = 96 * u;
  const y = placeBand(Sc, bh, Sc.h * 0.4 - bh / 2, o.avoid, Math.max(62, 56 * u), 14 * u);
  const off = Sc.reduced ? 0 : (1 - inn) * -Sc.w * 0.6 + (1 - out) * Sc.w * 0.3;
  ctx.save();
  ctx.globalAlpha = Math.min(inn, out);
  ctx.translate(off, 0);
  ctx.fillStyle = 'rgba(10,12,18,0.86)';
  ctx.fillRect(0, y, Sc.w, bh);
  ctx.fillStyle = o.accent;
  ctx.fillRect(0, y, Sc.w, 4 * u);
  ctx.fillRect(0, y + bh - 4 * u, Sc.w, 4 * u);
  tracked(ctx, o.text, Sc.w / 2, y + bh * 0.42, 58 * u, { weight: 700, lw: 0, spacing: 0.1, maxW: Sc.w * 0.9 });
  tracked(ctx, o.sub, Sc.w / 2, y + bh * 0.8, 24 * u, { weight: 600, lw: 0, spacing: 0.16, fill: o.accent });
  ctx.restore();
}

/** The points bar between rounds: who won, and everyone's points against the goal. o: { rows, goal, winName, winC, draw, age, accent } */
export function drawEnd(ctx, Sc, o) {
  const u = Sc.u;
  ctx.setTransform(Sc.pr, 0, 0, Sc.pr, 0, 0);
  const n = o.rows.length;
  const rowH = Math.min(32 * u, (Sc.h - 150 * u) / Math.max(1, n));
  const w = Math.min(Sc.w * 0.86, 480 * u);
  const headH = 48 * u;
  const h = headH + n * rowH + 10 * u;
  const inn = easeOutCubic(clamp(o.age / 0.25, 0, 1));
  const x = Sc.w / 2 - w / 2;
  const y = placeBand(Sc, h, Sc.h * 0.5 - h / 2, o.avoid, 50 * u, 14 * u) + (1 - inn) * 24 * u;
  ctx.save();
  ctx.globalAlpha = inn;
  panel(ctx, x, y, w, h, o.accent);
  // who won the round
  if (o.draw) {
    tracked(ctx, 'DRAW', Sc.w / 2, y + headH / 2 + 3 * u, 36 * u, { weight: 700, lw: 0, spacing: 0.12 });
  } else {
    const col = COLORS[o.winC % COLORS.length];
    ctx.fillStyle = col.main;
    ctx.fillRect(x + 14 * u, y + headH / 2 - 15 * u, 30 * u, 30 * u);
    ctx.fillStyle = '#ffffff';
    glyph(ctx, o.winC, x + 29 * u, y + headH / 2, 10 * u);
    text(ctx, o.winName, x + 56 * u, y + headH / 2 + 2 * u, fit(ctx, o.winName, 30 * u, w - 56 * u - 70 * u, 700), { align: 'left', weight: 700, lw: 0 });
    const k = easeOutBack(clamp((o.age - 0.15) / 0.3, 0, 1));
    text(ctx, '+1', x + w - 20 * u, y + headH / 2 + 2 * u, 40 * u * k, { align: 'right', weight: 700, fill: '#ffc400', lw: 0 });
  }
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(x + 12 * u, y + headH - 2 * u, w - 24 * u, 1.5 * u);
  const barX = x + 150 * u;
  const barW = w - 150 * u - 56 * u;
  o.rows.forEach((r, i) => {
    const ry = y + headH + i * rowH + rowH / 2 + 3 * u;
    const col = COLORS[r.c % COLORS.length];
    if (r.me) {
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.fillRect(x + 6 * u, ry - rowH / 2 + 1.5 * u, w - 12 * u, rowH - 3 * u);
    }
    ctx.fillStyle = col.main;
    ctx.fillRect(x + 12 * u, ry - 9 * u, 18 * u, 18 * u);
    ctx.fillStyle = '#ffffff';
    glyph(ctx, r.c, x + 21 * u, ry, 6 * u);
    text(ctx, r.name, x + 40 * u, ry, fit(ctx, r.name, 19 * u, barX - (x + 40 * u) - 8 * u), { align: 'left', weight: 600, lw: 0 });
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(barX, ry - 5 * u, barW, 10 * u);
    // the winner's bar grows by the point just won
    const from = clamp((r.score - r.pts) / Math.max(1, o.goal), 0, 1);
    const to = clamp(r.score / Math.max(1, o.goal), 0, 1);
    const f = r.pts ? easeOutCubic(clamp((o.age - 0.3) / 0.6, 0, 1)) : 1;
    ctx.fillStyle = col.main;
    ctx.fillRect(barX, ry - 5 * u, barW * lerp(from, to, f), 10 * u);
    // the goal line
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(barX + barW - 1.5 * u, ry - 8 * u, 2 * u, 16 * u);
    const shown = r.pts && f < 1 ? r.score - r.pts : r.score;
    text(ctx, String(shown), x + w - 16 * u, ry, 26 * u, { align: 'right', weight: 700, lw: 0 });
  });
  ctx.restore();
}

// ------------------------------------------------------------------------------------------------------------------ the podium
/** o: { top: [{ id, name, bot, c, color, score, me }], you: { label, score } | null, awards: { kills, bank }, age, win (bool: I won) } */
export function drawPodium(ctx, Sc, o) {
  const u = Sc.u;
  ctx.setTransform(Sc.pr, 0, 0, Sc.pr, 0, 0);
  const a = easeOutCubic(clamp(o.age / 0.4, 0, 1));
  ctx.fillStyle = `rgba(6,8,14,${0.74 * a})`;
  ctx.fillRect(0, 0, Sc.w, Sc.h);
  const cx = Sc.w / 2;
  const compact = Sc.h < 340;
  const k = compact ? 0.8 : 1;
  ctx.globalAlpha = a;
  const ty = Math.max(66 * u, Sc.h * 0.12);
  tracked(ctx, o.win ? 'VICTORY' : 'FINAL', cx, ty, (compact ? 40 : 54) * u, { weight: 700, lw: 0, spacing: 0.16, fill: o.win ? '#ffc400' : '#ffffff', maxW: Sc.w * 0.8 });

  // the row along the bottom: the best at killing, you (when you are not up there), the best bank shot
  const items = [];
  if (!compact && Sc.w >= 520 && o.awards && o.awards.kills) items.push({ label: 'MOST KILLS', name: o.awards.kills.name, v: String(o.awards.kills.v), col: '#12c2e9' });
  if (o.you) items.push({ label: 'YOU', name: o.you.label, v: String(o.you.score), col: '#ffffff', you: true });
  if (!compact && Sc.w >= 520 && o.awards && o.awards.bank) items.push({ label: 'BEST BANK', name: o.awards.bank.name, v: `x${o.awards.bank.v}`, col: '#ff7a1a' });
  const rowH = 40 * u;
  const rowY = items.length ? Sc.h - rowH - 12 * u : Sc.h - 14 * u;

  // three blocks: second, first, third
  const slots = [
    { i: 1, dx: -1, h: 78 },
    { i: 0, dx: 0, h: 112 },
    { i: 2, dx: 1, h: 56 },
  ];
  const bw = Math.min((compact ? 118 : 150) * u, (Sc.w - 20 * u - 20 * u) / 3);
  const base = Math.min(rowY - 58 * u, ty + (compact ? 190 : 270) * u);
  slots.forEach((s, n) => {
    const p = o.top[s.i];
    if (!p) return;
    const rise = easeOutCubic(clamp((o.age - 0.25 - n * 0.12) / 0.45, 0, 1));
    const bh = s.h * u * k * rise;
    const x = cx + s.dx * (bw + 10 * u) - bw / 2;
    const col = COLORS[p.c % COLORS.length];
    ctx.globalAlpha = a;
    ctx.fillStyle = rgba(col.main, 0.92);
    ctx.fillRect(x, base - bh, bw, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x, base - bh, bw, 4 * u);
    if (p.me) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, 2.4 * u);
      ctx.strokeRect(x + 1, base - bh + 1, bw - 2, bh - 2);
    }
    text(ctx, String(s.i + 1), x + bw / 2, base - bh / 2 + 4 * u, 52 * u * k, { weight: 700, fill: 'rgba(255,255,255,0.9)', lw: 0, alpha: rise });
    const hy = base - bh - 34 * u * k;
    ctx.globalAlpha = a * rise;
    drawHead(ctx, p.id, x + bw / 2, hy, 26 * u * k, { bot: p.bot, name: p.name, color: col.main, lw: 3 * u });
    if (s.i === 0) {
      // a crown
      ctx.fillStyle = '#ffc400';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2 * u;
      const cy = hy - 34 * u * k;
      ctx.beginPath();
      ctx.moveTo(x + bw / 2 - 16 * u, cy + 10 * u);
      ctx.lineTo(x + bw / 2 - 18 * u, cy - 8 * u);
      ctx.lineTo(x + bw / 2 - 8 * u, cy);
      ctx.lineTo(x + bw / 2, cy - 12 * u);
      ctx.lineTo(x + bw / 2 + 8 * u, cy);
      ctx.lineTo(x + bw / 2 + 18 * u, cy - 8 * u);
      ctx.lineTo(x + bw / 2 + 16 * u, cy + 10 * u);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    text(ctx, p.name, x + bw / 2, base + 16 * u, fit(ctx, p.name, 22 * u, bw + 8 * u), { weight: 600 });
    text(ctx, String(p.score), x + bw / 2, base + 38 * u, 28 * u, { weight: 700, fill: '#ffc400' });
  });
  ctx.globalAlpha = a;
  if (items.length) {
    const cw = (items.length === 1 ? 190 : 176) * u;
    const total = items.length * cw + (items.length - 1) * 10 * u;
    items.forEach((q, i) => {
      const x = cx - total / 2 + i * (cw + 10 * u);
      panel(ctx, x, rowY, cw, rowH, q.col, 'left');
      text(ctx, q.label, x + 12 * u, rowY + 12 * u, 14 * u, { align: 'left', fill: DIM, weight: 600, lw: 0 });
      text(ctx, q.name, x + 12 * u, rowY + 29 * u, fit(ctx, q.name, 19 * u, cw - 24 * u - 52 * u), { align: 'left', weight: 600, lw: 0 });
      text(ctx, q.v, x + cw - 12 * u, rowY + 21 * u, 26 * u, { align: 'right', weight: 700, lw: 0, fill: q.you ? '#ffc400' : q.col });
    });
  }
  ctx.globalAlpha = 1;
}
