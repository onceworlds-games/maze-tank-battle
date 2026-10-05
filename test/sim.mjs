// A whole match on one page the way the host's page plays it, with the pure modules only: the Match book, one Round per round,
// every tank `sim` (so every kill is decided here). Used by the tests; not a test itself.
import { Match } from '../game/match.js';
import { Round } from '../game/round.js';
import { COLS, ROWS, STEP, TANK, buildRoster, roundSeed } from '../game/rules.js';

export function makeRound(roster, matchSeed, roundNo, practice = false) {
  const round = new Round({ roster, seed: roundSeed(matchSeed, roundNo), roundNo, practice });
  for (const k of round.tanks) k.sim = true;
  return round;
}

export function playMatch(seed, { goal = 3, humans = [], maxMs = 5 * 3600 * 1000, check = true, drive } = {}) {
  const roster = buildRoster(humans, seed);
  const m = new Match({ mid: `t${seed}`, by: 'host', seed, goal, roster, now: 0 });
  let now = 0;
  let round = null;
  let rid = '';
  const stats = { rounds: 0, steps: 0, deaths: 0, selfKills: 0, draws: 0, roundMs: [], bad: [], stuckShots: 0, claims: 0, weapons: {}, bounces: 0, maxBank: 0 };
  const dead = [];
  const claims = [];
  const phases = [];
  let lastKey = '';
  for (;;) {
    const g = m.g;
    if (g.phase !== 'final' && g.rid !== rid) {
      rid = g.rid;
      if (round) stats.stuckShots += round.stuckShots;
      round = makeRound(roster, seed, g.round);
      round.hooks.dead = (k, info) => dead.push({ id: k.id, info });
      round.hooks.claim = (k, c) => claims.push({ id: k.id, n: c.n, kind: c.kind });
      round.hooks.fire = (spec) => {
        stats.weapons[spec.k] = (stats.weapons[spec.k] || 0) + 1;
      };
      stats.rounds++;
    }
    const key = `${g.round}:${g.phase}`;
    if (key !== lastKey) {
      lastKey = key;
      phases.push(key);
      if (g.phase === 'end') stats.roundMs.push(g.tEnd);
    }
    if (g.phase === 'play') {
      round.t = now - g.t0;
      round.setCrates(g.cr);
      if (drive) drive(round, g, now);
      round.step(STEP);
      for (const e of dead.splice(0)) {
        if (m.dead(e.id, e.info, now)) {
          stats.deaths++;
          if (e.info.by === e.id) stats.selfKills++;
          if (e.info.b > stats.maxBank) stats.maxBank = e.info.b;
        }
      }
      for (const c of claims.splice(0)) if (m.claim(c.id, c.n)) stats.claims++;
    } else if (g.phase === 'end' && round) {
      round.t = now - g.t0;
      round.step(STEP, true);
      dead.length = 0;
      claims.length = 0;
    }
    stats.steps++;
    if (check && round && stats.steps % 20 === 0) {
      for (const k of round.tanks) {
        if (!Number.isFinite(k.x) || !Number.isFinite(k.y) || !Number.isFinite(k.a)) stats.bad.push(`NaN tank ${k.id} round ${g.round}`);
        else if (k.x < 0.2 || k.y < 0.2 || k.x > COLS - 0.2 || k.y > ROWS - 0.2) stats.bad.push(`tank ${k.id} out of bounds (${k.x}, ${k.y})`);
      }
      for (const s of round.shots) {
        if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || s.x < 0 || s.y < 0 || s.x > COLS || s.y > ROWS) stats.bad.push(`shot ${s.key} out of the maze (${s.x}, ${s.y})`);
      }
    }
    now += STEP * 1000;
    const sig = m.tick(now, { positions: round ? round.aliveTanks().map((k) => ({ x: k.x, y: k.y })) : [] });
    if (sig === 'end') break;
    if (now > maxMs) {
      stats.bad.push('the match never ended');
      break;
    }
  }
  if (round) stats.stuckShots += round.stuckShots;
  return { m, g: m.g, stats, phases, roster };
}
