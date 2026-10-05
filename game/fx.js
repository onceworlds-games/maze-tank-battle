// Particles, shock rings, floating numbers, tread marks, scorch marks and the camera's trauma. Fixed pools: nothing is allocated
// while playing. World units (a cell is 1). The renderer draws what is "on"; update(dt) moves it.

import { clamp } from './gfx.js';

const MAX_PARTS = 380;
const MAX_POPUPS = 14;
const MAX_RINGS = 16;
const MAX_MARKS = 300;
const MAX_DECALS = 28;
export const MARK_LIFE = 7; // seconds a tread mark stays on the floor

// kinds
export const SPARK = 0; // a short bright line along its motion
export const SMOKE = 1; // a circle that grows and fades
export const FRAG = 2; // a chunk of hull, spinning
export const FLASH = 3; // a quick bright disc
export const FIRE = 4; // an orange ball that grows and goes dark
export const CONFETTI = 5;

const CONFETTI_COLORS = ['#ff4d5a', '#ffc400', '#7bd83a', '#2f7bff', '#c06bff', '#ff7a1a', '#12c2e9', '#ffffff'];

export function createFx() {
  const parts = Array.from({ length: MAX_PARTS }, () => ({ on: false, k: 0, x: 0, y: 0, vx: 0, vy: 0, r: 0.05, r1: 0.05, age: 0, life: 1, col: '#fff', rot: 0, vr: 0, drag: 0, g: 0 }));
  const popups = Array.from({ length: MAX_POPUPS }, () => ({ on: false, text: '', x: 0, y: 0, age: 0, life: 1, size: 1, col: '#fff', delay: 0 }));
  const rings = Array.from({ length: MAX_RINGS }, () => ({ on: false, x: 0, y: 0, r0: 0, r1: 1, age: 0, life: 1, col: '#fff', lw: 0.03 }));
  const marks = new Float32Array(MAX_MARKS * 5); // x0, y0, x1, y1, born
  const decals = [];
  let cursor = 0;
  let pCursor = 0;
  let rCursor = 0;
  let markHead = 0;
  let markCount = 0;

  const fx = {
    parts,
    popups,
    rings,
    marks,
    decals,
    trauma: 0,
    t: 0,
    q: 1, // 0.4 low, 0.7 medium, 1 high
    reduced: false,
    rand: Math.random,

    /** How many of n particles to make at the current quality. */
    count(n) {
      return Math.max(1, Math.round(n * this.q * (this.reduced ? 0.5 : 1)));
    },

    get markCount() {
      return markCount;
    },
    get markHead() {
      return markHead;
    },
    markCapNow() {
      return Math.max(60, Math.floor(MAX_MARKS * this.q));
    },

    spawn(k, x, y, vx, vy, life, r, r1, col, drag = 0, g = 0) {
      const cap = Math.max(60, Math.floor(MAX_PARTS * this.q));
      const p = parts[cursor % cap];
      cursor = (cursor + 1) % cap;
      p.on = true;
      p.k = k;
      p.x = x;
      p.y = y;
      p.vx = vx;
      p.vy = vy;
      p.age = 0;
      p.life = life;
      p.r = r;
      p.r1 = r1;
      p.col = col;
      p.drag = drag;
      p.g = g;
      p.rot = this.rand() * 6.28;
      p.vr = (this.rand() - 0.5) * 16;
      return p;
    },

    /** Sparks fanned about direction `a`. */
    sparks(x, y, a, spread, n, speed, cols = ['#ffe9a0', '#ffffff', '#ffb02e']) {
      const k = this.count(n);
      for (let i = 0; i < k; i++) {
        const d = a + (this.rand() - 0.5) * 2 * spread;
        const s = speed * (0.4 + this.rand() * 0.8);
        this.spawn(SPARK, x, y, Math.cos(d) * s, Math.sin(d) * s, 0.18 + this.rand() * 0.22, 0.012 + this.rand() * 0.01, 0, cols[Math.floor(this.rand() * cols.length)], 3.2);
      }
    },

    /** The flash and kick at the end of a barrel. */
    muzzle(x, y, a, power = 1) {
      if (!this.reduced) this.spawn(FLASH, x + Math.cos(a) * 0.04, y + Math.sin(a) * 0.04, 0, 0, 0.07, 0.05 * power, 0.14 * power, '#fff3c4');
      this.sparks(x, y, a, 0.5, 4 * power, 3.4);
      this.smoke(x, y, 2, 0.4, '#d8dbe0');
    },

    smoke(x, y, n, speed = 0.5, col = '#b7bcc6', size = 0.06) {
      const k = this.count(n);
      for (let i = 0; i < k; i++) {
        const a = this.rand() * 6.28;
        const s = speed * (0.3 + this.rand());
        this.spawn(SMOKE, x, y, Math.cos(a) * s, Math.sin(a) * s - 0.1, 0.45 + this.rand() * 0.5, size * (0.7 + this.rand() * 0.6), size * 3.2, col, 2.2);
      }
    },

    /** A shot meeting a wall: a spray along the face and a tiny ring. */
    bounce(x, y, nx, ny) {
      const a = Math.atan2(ny, nx);
      this.sparks(x + nx * 0.02, y + ny * 0.02, a, 0.9, 3, 1.8, ['#ffffff', '#cfd6e6', '#ffd37a']);
      this.ring(x + nx * 0.02, y + ny * 0.02, 0.02, 0.13, 0.16, '#ffffff', 0.012);
    },

    /** A tank blowing up: flash, fireball, shock ring, chunks of hull, smoke, sparks and a scorch mark. */
    explode(x, y, main, dark, power = 1) {
      if (!this.reduced) this.spawn(FLASH, x, y, 0, 0, 0.16, 0.12 * power, 0.55 * power, '#fff1c0');
      const fires = this.count(5);
      for (let i = 0; i < fires; i++) {
        const a = this.rand() * 6.28;
        const s = 0.3 + this.rand() * 0.9;
        this.spawn(FIRE, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.32 + this.rand() * 0.22, 0.08 * power, 0.3 * power, '#ff8a1f', 2.5);
      }
      this.ring(x, y, 0.1, 0.95 * power, 0.38, '#ffffff', 0.05);
      this.ring(x, y, 0.05, 0.6 * power, 0.28, '#ffb02e', 0.03);
      const frags = this.count(13);
      const cols = [main, dark, '#2a2d36', '#666b78'];
      for (let i = 0; i < frags; i++) {
        const a = this.rand() * 6.28;
        const s = 1.2 + this.rand() * 3.2;
        this.spawn(FRAG, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.7 + this.rand() * 0.6, 0.035 + this.rand() * 0.04, 0.02, cols[i % cols.length], 2.4);
      }
      this.smoke(x, y, 8, 0.9, '#6a6f7c', 0.1);
      this.sparks(x, y, 0, Math.PI, 14, 5.5);
      this.decal(x, y, 0.3 * power);
    },

    confetti(x, y, n, spread = 3, up = 5) {
      const k = this.count(n);
      for (let i = 0; i < k; i++) {
        const col = CONFETTI_COLORS[Math.floor(this.rand() * CONFETTI_COLORS.length)];
        this.spawn(CONFETTI, x + (this.rand() - 0.5) * 1.5, y, (this.rand() - 0.5) * 2 * spread, -(1 + this.rand() * up), 1.6 + this.rand() * 1.4, 0.05 + this.rand() * 0.04, 0.05, col, 0.8, 5);
      }
    },

    ring(x, y, r0, r1, life, col, lw = 0.03) {
      const r = rings[rCursor];
      rCursor = (rCursor + 1) % MAX_RINGS;
      r.on = true;
      r.x = x;
      r.y = y;
      r.r0 = r0;
      r.r1 = r1;
      r.age = 0;
      r.life = life;
      r.col = col;
      r.lw = lw;
    },

    popup(textStr, x, y, col = '#ffffff', size = 1, delay = 0) {
      const p = popups[pCursor];
      pCursor = (pCursor + 1) % MAX_POPUPS;
      p.on = true;
      p.text = textStr;
      p.x = x;
      p.y = y;
      p.age = 0;
      p.life = 1.1;
      p.size = size;
      p.col = col;
      p.delay = delay;
    },

    /** A piece of tread mark: the segment (x0, y0) to (x1, y1). */
    mark(x0, y0, x1, y1) {
      const cap = Math.max(60, Math.floor(MAX_MARKS * this.q));
      const i = markHead % cap;
      markHead = (i + 1) % cap;
      markCount = Math.min(cap, markCount + 1);
      const b = i * 5;
      marks[b] = x0;
      marks[b + 1] = y0;
      marks[b + 2] = x1;
      marks[b + 3] = y1;
      marks[b + 4] = this.t;
    },

    decal(x, y, r) {
      if (decals.length >= MAX_DECALS) decals.shift();
      decals.push({ x, y, r, rot: this.rand() * 6.28, seed: this.rand() });
    },

    /** Camera trauma: the shake is trauma squared, so small hits are a tremor and big ones are felt. */
    shake(amount) {
      if (this.reduced) return;
      this.trauma = clamp(this.trauma + amount, 0, 1);
    },

    /** Smooth sine offsets in pixels (never fresh random jitter). */
    shakeOffset(out, px) {
      if (this.reduced || this.trauma <= 0.001) {
        out.x = 0;
        out.y = 0;
        return out;
      }
      const s = this.trauma * this.trauma;
      const t = this.t;
      out.x = px * s * (Math.sin(t * 41) * 0.65 + Math.sin(t * 23 + 1.3) * 0.35);
      out.y = px * s * (Math.sin(t * 37 + 0.7) * 0.65 + Math.sin(t * 19 + 2.1) * 0.35);
      return out;
    },

    update(dt) {
      this.t += dt;
      this.trauma = Math.max(0, this.trauma - dt * 1.7);
      const damp = (v, d) => v * Math.exp(-d * dt);
      for (const p of parts) {
        if (!p.on) continue;
        p.age += dt;
        if (p.age >= p.life) {
          p.on = false;
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.g) p.vy += p.g * dt;
        if (p.drag) {
          p.vx = damp(p.vx, p.drag);
          p.vy = damp(p.vy, p.drag);
        }
        p.rot += p.vr * dt;
      }
      for (const r of rings) {
        if (!r.on) continue;
        r.age += dt;
        if (r.age >= r.life) r.on = false;
      }
      for (const p of popups) {
        if (!p.on) continue;
        if (p.delay > 0) {
          p.delay -= dt;
          continue;
        }
        p.age += dt;
        if (p.age >= p.life) p.on = false;
      }
    },

    clear() {
      for (const p of parts) p.on = false;
      for (const r of rings) r.on = false;
      for (const p of popups) p.on = false;
      markHead = 0;
      markCount = 0;
      decals.length = 0;
      this.trauma = 0;
    },
  };
  return fx;
}
