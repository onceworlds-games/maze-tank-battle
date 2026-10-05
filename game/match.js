// The host's book of the match: what round it is, who is out, the points, the crates on the floor and the phase clock. Pure: it
// takes the match clock (ms) and reports; the net layer writes `g` into room state whenever `dirty` is set, and a new host picks
// the same record up with Match.fromG.
//
// g: { mid, by, seed, goal, round, rid, phase: 'intro'|'play'|'end'|'final', until (match ms), t0 (match ms the round's play began),
//      tEnd (play ms the round ended, 0 while it runs), roster: [{ id, bot, n, c }], scores, kills, bank (best bounces on a kill), st
//      (rounds won in a row), out: { id: [n, by, playMs, bounces] } (this round's destroyed tanks, in order), lastOut (play ms of the
//      last one, -1 for none), win (the round's winner or ''), over (1 when this round decided the match),
//      cr: [[n, cellX, cellY, kind]] (crates on the floor), cn (the last crate's number), ncr (play ms the next crate comes) }

import { hashStr, mulberry32 } from './rng.js';
import { COLS, CRATE, END_MS, FINAL_MS, INTRO_FIRST_MS, INTRO_MS, MAX_ROUNDS, ROWS, ROUND_MAX_MS, SETTLE_MS, WEAPON_KEYS, clamp, num } from './rules.js';

export class Match {
  constructor({ mid, by, seed, goal, roster, now }) {
    const zero = () => Object.fromEntries(roster.map((e) => [e.id, 0]));
    this.g = {
      mid,
      by,
      seed: seed >>> 0,
      goal,
      round: 1,
      rid: `${mid}.1`,
      phase: 'intro',
      until: now + INTRO_FIRST_MS,
      t0: 0,
      tEnd: 0,
      roster,
      scores: zero(),
      kills: zero(),
      bank: {},
      st: {},
      out: {},
      lastOut: -1,
      win: '',
      over: 0,
      cr: [],
      cn: 0,
      ncr: 0,
    };
    this.dirty = true;
    this.lastEnd = -1e9;
    this.seedRng();
  }

  /** The record of a match that was already running (the host changed): carry on as `by`. */
  static fromG(g, by) {
    const m = Object.create(Match.prototype);
    m.g = JSON.parse(JSON.stringify(g));
    m.g.by = by;
    m.dirty = true;
    m.lastEnd = -1e9;
    m.seedRng();
    return m;
  }

  seedRng() {
    const g = this.g;
    this.rng = mulberry32(hashStr(`crates:${g.seed}:${g.round}:${g.cn}`));
  }

  alive() {
    return this.g.roster.filter((e) => !this.g.out[e.id]).map((e) => e.id);
  }

  playMs(now) {
    return now - this.g.t0;
  }

  /** Advance the clock to `now` (match ms). `env.positions`: [{ x, y }] of the tanks left (crates don't land on them). Returns 'end' when the match is over and the room should be told. */
  tick(now, env = {}) {
    const g = this.g;
    if (g.phase === 'intro') {
      if (now >= g.until) {
        g.phase = 'play';
        g.t0 = now;
        g.until = now + ROUND_MAX_MS;
        g.lastOut = -1;
        g.ncr = Math.round(CRATE.first[0] + this.rng() * (CRATE.first[1] - CRATE.first[0]));
        this.dirty = true;
      }
    } else if (g.phase === 'play') {
      const pt = now - g.t0;
      if (pt >= g.ncr) this.spawnCrate(pt, env);
      const alive = this.alive();
      if (alive.length <= 1) {
        if (pt - Math.max(0, g.lastOut) >= SETTLE_MS) this.finish(now, pt, alive);
      } else if (pt >= ROUND_MAX_MS) this.finish(now, pt, alive);
    } else if (g.phase === 'end') {
      if (now >= g.until) {
        if (g.over) {
          g.phase = 'final';
          g.rid = `${g.mid}.final`;
          g.until = now + FINAL_MS;
          this.dirty = true;
        } else this.nextRound(now);
      }
    } else if (g.phase === 'final') {
      if (now >= g.until && now - this.lastEnd > 2500) {
        this.lastEnd = now;
        return 'end';
      }
    }
    return '';
  }

  finish(now, pt, alive) {
    const g = this.g;
    const win = alive.length === 1 ? alive[0] : '';
    g.win = win;
    g.tEnd = Math.max(1, Math.round(pt));
    if (win) g.scores[win] = (g.scores[win] || 0) + 1;
    for (const e of g.roster) {
      if (e.id === win) g.st[e.id] = (g.st[e.id] || 0) + 1;
      else delete g.st[e.id];
    }
    g.over = (win && g.scores[win] >= g.goal) || g.round >= MAX_ROUNDS ? 1 : 0;
    g.phase = 'end';
    g.until = now + END_MS;
    g.cr = [];
    this.dirty = true;
  }

  nextRound(now) {
    const g = this.g;
    g.round += 1;
    g.rid = `${g.mid}.${g.round}`;
    g.phase = 'intro';
    g.until = now + INTRO_MS;
    g.t0 = 0;
    g.tEnd = 0;
    g.out = {};
    g.lastOut = -1;
    g.win = '';
    g.cr = [];
    this.seedRng();
    this.dirty = true;
  }

  spawnCrate(pt, env) {
    const g = this.g;
    if (g.cr.length >= CRATE.max) {
      g.ncr = Math.round(pt + 1500);
      this.dirty = true;
      return;
    }
    const taken = new Set(g.cr.map((c) => c[2] * COLS + c[1]));
    const where = env.positions || [];
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < 30; i++) {
      cx = Math.floor(this.rng() * COLS);
      cy = Math.floor(this.rng() * ROWS);
      if (taken.has(cy * COLS + cx)) continue;
      if (where.some((p) => Math.hypot(p.x - (cx + 0.5), p.y - (cy + 0.5)) < 1.4)) continue;
      break;
    }
    const kind = WEAPON_KEYS[Math.floor(this.rng() * WEAPON_KEYS.length)];
    g.cn += 1;
    g.cr = [...g.cr, [g.cn, cx, cy, kind]];
    g.ncr = Math.round(pt + CRATE.gap[0] + this.rng() * (CRATE.gap[1] - CRATE.gap[0]));
    this.dirty = true;
  }

  /** A tank is destroyed (its own page said so, or the host decided for a bot, a leaver or an away player). info: { by, b }. True if it counted. */
  dead(id, info, now) {
    const g = this.g;
    if (g.phase !== 'play' || typeof id !== 'string' || g.out[id] || !g.roster.some((e) => e.id === id)) return false;
    const pt = Math.round(clamp(now - g.t0, 0, ROUND_MAX_MS));
    const by = info && typeof info.by === 'string' && info.by !== id && g.roster.some((e) => e.id === info.by) ? info.by : '';
    const b = clamp(Math.round(num(info && info.b)), 0, 99);
    const n = Object.keys(g.out).length + 1;
    g.out = { ...g.out, [id]: [n, by, pt, b] };
    g.lastOut = pt;
    if (by) {
      g.kills = { ...g.kills, [by]: (g.kills[by] || 0) + 1 };
      if (b > (g.bank[by] || 0)) g.bank = { ...g.bank, [by]: b };
    }
    this.dirty = true;
    return true;
  }

  /** A tank took a crate: it leaves the floor. Returns the crate's kind, or '' if it was already gone. */
  claim(id, n) {
    const g = this.g;
    if (g.phase !== 'play' || typeof id !== 'string' || !g.roster.some((e) => e.id === id) || g.out[id]) return '';
    const i = g.cr.findIndex((c) => c[0] === n);
    if (i < 0) return '';
    const kind = g.cr[i][3];
    g.cr = g.cr.filter((_, j) => j !== i);
    this.dirty = true;
    return kind;
  }
}
