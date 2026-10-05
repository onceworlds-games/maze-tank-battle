// The numbers of the game and the small pure rules around them (roster, ranking, awards). No page, no SDK.

import { hashStr, mulberry32, shuffle } from './rng.js';

export const COLS = 9;
export const ROWS = 6;
export const STEP = 1 / 60; // the fixed step every page simulates with, in seconds

export const GOAL_OPTIONS = [3, 5, 10];
export const DEFAULT_GOAL = 5; // about 4-5 minutes against three bots
export const TABLE = 4; // bots fill the table up to this many tanks
export const MAX_PLAYERS = 8;

// Phase lengths in match milliseconds.
export const INTRO_FIRST_MS = 2600;
export const INTRO_MS = 1800;
export const END_MS = 2600;
export const FINAL_MS = 9000;
export const SETTLE_MS = 2000; // after the last explosion: shots still in flight get to land
export const ROUND_MAX_MS = 75000; // a round nobody wins by then is a draw
export const MAX_ROUNDS = 99; // a match always ends

// Tank: 0.42 long, 0.32 wide (cells). Walls and other tanks see it as three circles along its length.
export const TANK = {
  hl: 0.21,
  hw: 0.16,
  rc: 0.16, // circle radius
  off: 0.13, // the end circles sit this far from the middle
  muzzle: 0.31, // where a shot leaves the barrel, from the middle
  fwd: 1.6,
  back: 1.1,
  turn: 3.2, // rad/s on the keyboard
  stickTurn: 4.6, // rad/s toward the stick's direction
};

export const SHOT = { speed: 3.2, life: 9, r: 0.045, max: 5, cd: 0.18, repeat: 0.34 };

// Power-ups, by the letter that travels in messages.
export const WEAPON = {
  L: { name: 'LASER', bounces: 4, cd: 0.4, hit: 0.03 },
  S: { name: 'SHOTGUN', n: 5, spread: 0.3, speed: 4.4, life: 0.85, r: 0.04, cd: 0.4 },
  G: { name: 'GATLING', ammo: 20, gap: 0.1, speed: 3.6, life: 4.5, r: 0.04 },
  M: { name: 'MINE', arm: 1.0, trig: 0.12, blast: 0.8, cd: 0.4 },
  H: { name: 'MISSILE', speed: 1.5, turn: 1.8, home: 1.0, life: 8, r: 0.07, cd: 0.4 },
};
export const WEAPON_KEYS = 'LSGMH';
export const SHOT_KINDS = 'NLSGMH';

export const CRATE = { first: [3000, 6000], gap: [6000, 10000], max: 2, pick: 0.38 };

export const COLORS = [
  { name: 'Red', main: '#e63946', dark: '#7f1d2a', light: '#ff8a93' },
  { name: 'Blue', main: '#2f7bff', dark: '#173a8f', light: '#8dbbff' },
  { name: 'Green', main: '#22c55e', dark: '#0f6a33', light: '#86efac' },
  { name: 'Yellow', main: '#ffc400', dark: '#8f6a00', light: '#ffe680' },
  { name: 'Purple', main: '#9b5cff', dark: '#522aa3', light: '#cbaaff' },
  { name: 'Orange', main: '#ff7a1a', dark: '#9a420a', light: '#ffb77a' },
  { name: 'Cyan', main: '#12c2e9', dark: '#0a6a82', light: '#8aeaff' },
  { name: 'Pink', main: '#ff4fa3', dark: '#9a1f5d', light: '#ffa3d0' },
];

// The border of the maze changes colour from round to round.
export const ACCENTS = ['#ff7a1a', '#12c2e9', '#ffc400', '#ff4fa3', '#7bd83a', '#9b5cff'];

export const BOT_NAMES = ['Nova', 'Echo', 'Blaze', 'Pixel', 'Rook', 'Vex', 'Kai', 'Juno', 'Orbit', 'Zed', 'Mika', 'Rio', 'Ace', 'Sol'];

export const LOBBY_SEED = 20261004;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The maze's seed for a round of a match. */
export function roundSeed(matchSeed, roundNo) {
  return hashStr(`${num(matchSeed, 1) >>> 0}:${roundNo | 0}`);
}

export function accentFor(seed) {
  return ACCENTS[hashStr(`accent:${seed}`) % ACCENTS.length];
}

/** The tanks of a match: the people who play, then bots up to the table size. [{ id, bot, n?, c }] */
export function buildRoster(humanIds, seed) {
  const seen = new Set();
  const humans = [];
  for (const id of humanIds || []) {
    if (typeof id !== 'string' || !id || id.length > 80 || seen.has(id)) continue;
    seen.add(id);
    humans.push(id);
    if (humans.length >= MAX_PLAYERS) break;
  }
  const roster = humans.map((id, i) => ({ id, bot: 0, c: i }));
  const nBots = Math.max(0, TABLE - humans.length);
  const names = shuffle(BOT_NAMES.slice(), mulberry32(hashStr(`names:${num(seed, 1) >>> 0}`)));
  for (let i = 0; i < nBots; i++) roster.push({ id: `bot${i + 1}`, bot: 1, n: names[i], c: humans.length + i });
  return roster;
}

/** Everyone, best first: points, then kills, then the order they sat in. */
export function matchRanking(roster, scores, kills) {
  return roster
    .map((e, i) => ({ id: e.id, i }))
    .sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0) || (kills[b.id] || 0) - (kills[a.id] || 0) || a.i - b.i)
    .map((e) => e.id);
}

/** The two awards under the podium: most kills, and the biggest bank shot (most bounces on a kill). Null when nobody earned it. */
export function awards(roster, kills, bank) {
  const best = (map) => {
    let id = '';
    let v = 0;
    for (const e of roster) {
      const x = map[e.id] || 0;
      if (x > v) {
        v = x;
        id = e.id;
      }
    }
    return id ? { id, v } : null;
  };
  return { kills: best(kills), bank: best(bank) };
}

/** Ordinal for "You: 5th". */
export function ordinal(n) {
  const k = n % 100;
  if (k >= 11 && k <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 ? 0 : n % 10]}`;
}
