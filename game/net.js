// The match over the network. One state record `g` per match is written by the host's page (from its Match book); every page
// draws from it. Shots are not in state: each is a `fire` message that every page simulates from (exact reflection, same path
// everywhere). A tank's death is told by the page that decides it (see round.js) with a broadcast `dead`; the host books it.
// Follows the party template: everything a new host needs is in room state (`g`, the bots' snapshot `b`), deadlines are match
// time, and adopt() is safe to call again.
//
// messages (all checked for who may send them):
//   { t:'fire', rid, id, n, x, y, a, k, at }   a shot, laser, mine, shotgun blast, gatling round or missile (at: round ms)
//   { t:'dead', rid, id, by, s, b }            tank `id` is destroyed by `by`'s shot `s` that had bounced `b` times
//   { t:'boom', rid, k }                       the mine with key k went off
//   { t:'pick', rid, n }                       (to the host) I took crate n
// b: { rid, t (round ms), p: [[x, y, a, flags], ...] } the bots, in roster order (about 12 times a second)

import { Match } from './match.js';
import { DEFAULT_GOAL, GOAL_OPTIONS, buildRoster, clamp, num } from './rules.js';

const PHASES = new Set(['intro', 'play', 'end', 'final']);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 80) => typeof v === 'string' && v.length > 0 && v.length <= max;

/**
 * env: {
 *   fire(msg, rid)   a checked fire message to put in the world ('lobby' rid for the lobby's practice shots),
 *   dead(msg)        a checked death to apply,
 *   boom(key),
 *   positions()      [{ x, y }] of the tanks still in the round (the host keeps crates off them)
 * }
 */
export function createNet(room, env) {
  let match = null; // the host's Match for g.mid
  let lastB = -1e9;
  const deadSeen = new Map(); // `${rid}|${id}` -> performance time presence first said "destroyed"
  const flood = new Map(); // shooter id -> { t, n }

  // ---------------------------------------------------------------- the record
  let rawG = null;
  let goodG = null;
  let goodMid = '';

  function cleanG(g) {
    if (!isObj(g) || typeof g.mid !== 'string' || g.mid !== room.match.id || typeof g.by !== 'string') return null;
    if (!PHASES.has(g.phase) || typeof g.rid !== 'string') return null;
    if (!Number.isFinite(g.round) || g.round < 1 || g.round > 9999) return null;
    if (!Number.isFinite(g.goal) || g.goal < 1 || g.goal > 999) return null;
    if (!Number.isFinite(g.seed) || !Number.isFinite(g.until) || !Number.isFinite(g.t0) || !Number.isFinite(g.tEnd)) return null;
    if (!Array.isArray(g.roster) || g.roster.length < 1 || g.roster.length > 16) return null;
    for (const e of g.roster) {
      if (!isObj(e) || !str(e.id) || !Number.isFinite(e.c)) return null;
      if (e.bot && typeof e.n !== 'string') return null;
    }
    if (!isObj(g.scores) || !isObj(g.kills) || !isObj(g.bank) || !isObj(g.st) || !isObj(g.out) || !Array.isArray(g.cr)) return null;
    return g;
  }

  /** The record of this match (valid, and not left over from the last one), or null. */
  function G() {
    const raw = room.state.g;
    if (raw === rawG && goodMid === room.match.id) return goodG;
    rawG = raw;
    goodMid = room.match.id;
    goodG = cleanG(raw);
    return goodG;
  }

  const hosting = () => {
    const g = G();
    return Boolean(room.isHost && room.running && g && g.by === room.me.id && match);
  };

  /** Play time of the round (ms since GO), frozen once the round has ended. */
  function tPlay(g) {
    if (g.phase === 'intro') return 0;
    const t = room.matchNow() - g.t0;
    return clamp(t, 0, g.tEnd > 0 ? g.tEnd : Infinity);
  }

  function flush() {
    if (!match || !match.dirty) return;
    match.dirty = false;
    room.setState('g', JSON.parse(JSON.stringify(match.g)));
  }

  // ---------------------------------------------------------------- the host's page keeps the book
  const goalSetting = () => {
    const v = Number(room.settings && room.settings.goal);
    return GOAL_OPTIONS.includes(v) ? v : DEFAULT_GOAL;
  };

  function startMatch() {
    if (!room.isHost) return;
    const ids = (room.match.participants || []).filter((id) => typeof id === 'string');
    const seed = num(room.match.seed, 1) >>> 0;
    match = new Match({ mid: room.match.id, by: room.me.id, seed, goal: goalSetting(), roster: buildRoster(ids, seed), now: room.matchNow() });
    deadSeen.clear();
    flush();
  }

  /** Take the record over from the previous host: the same book, written by us from now on. */
  function takeOver() {
    const g = G();
    if (!g) return startMatch();
    match = Match.fromG(g, room.me.id);
    deadSeen.clear();
    flush();
  }

  /** Carries on as the host: from room state. Safe to call as often as you like. */
  function adopt() {
    if (!room.isHost || !room.running) return;
    const g = G();
    if (!g) return startMatch();
    if (g.by !== room.me.id || !match || match.g.mid !== g.mid) takeOver();
  }

  /** The host's ticker, every 100 ms. Only acts for the host of a running match. */
  function tick() {
    const g = G();
    // the host changed hands but the old host's last write landed after ours: ours wins again
    if (g && room.isHost && room.running && g.by !== room.me.id) return takeOver();
    if (!hosting()) return;
    const now = room.matchNow();
    const m = match;
    // someone who left is out of this round and every one after it (their points stay)
    for (const e of m.g.roster) if (!e.bot && !room.players.has(e.id)) m.leave(e.id, now);
    if (m.g.phase === 'play') {
      const perf = typeof performance !== 'undefined' ? performance.now() : Date.now();
      for (const e of m.g.roster) {
        if (e.bot || m.g.out[e.id]) continue;
        const p = room.players.get(e.id);
        if (!p) continue;
        // their page says it is destroyed but its message never came: after a second the host books it
        const pr = p.presence;
        const key = `${m.g.rid}|${e.id}`;
        if (e.id !== room.me.id && isObj(pr) && pr.r === m.g.rid && pr.d === 1) {
          if (!deadSeen.has(key)) deadSeen.set(key, perf);
          else if (perf - deadSeen.get(key) > 1200) m.dead(e.id, { by: '' }, now);
        } else deadSeen.delete(key);
      }
    }
    const sig = m.tick(now, { positions: env.positions() });
    flush();
    if (sig === 'end') room.endMatch(); // back to the lobby, ready flags cleared
  }

  // ---------------------------------------------------------------- what people tell us
  function shotAllowed(id) {
    const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let f = flood.get(id);
    if (!f || t - f.t > 1000) {
      f = { t, n: 0 };
      flood.set(id, f);
    }
    f.n++;
    return f.n <= 24;
  }

  function onFire(d, from) {
    if (!str(d.rid, 120) || !str(d.id)) return;
    if (d.rid === 'lobby') {
      if (room.match.phase !== 'lobby' || d.id !== from.id || !shotAllowed(d.id)) return;
      env.fire(d, 'lobby');
      return;
    }
    const g = G();
    if (!g || d.rid !== g.rid || (g.phase !== 'play' && g.phase !== 'end')) return;
    const e = g.roster.find((x) => x.id === d.id);
    if (!e || (e.bot ? from.id !== room.host : from.id !== d.id) || !shotAllowed(d.id)) return;
    env.fire(d, g.rid);
  }

  /** Who may say that tank `id` is destroyed: its own page, or the host (which decides for bots, for people who are away or whose page has stopped, and for leavers). */
  const mayReport = (id, from) => from.id === id || from.id === room.host;

  function onDead(d, from) {
    const g = G();
    if (!g || d.rid !== g.rid || (g.phase !== 'play' && g.phase !== 'end') || !str(d.id)) return;
    const e = g.roster.find((x) => x.id === d.id);
    if (!e || !mayReport(d.id, from)) return;
    const info = { by: typeof d.by === 'string' ? d.by : '', s: typeof d.s === 'string' && d.s.length < 60 ? d.s : '', b: clamp(Math.round(num(d.b)), 0, 99) };
    env.dead({ id: d.id, ...info });
    if (hosting()) {
      match.dead(d.id, info, room.matchNow());
      flush();
    }
  }

  function onBoom(d, from) {
    const g = G();
    if (!g || d.rid !== g.rid || (g.phase !== 'play' && g.phase !== 'end') || !str(d.k, 60)) return;
    if (from.id !== room.host && !g.roster.some((x) => x.id === from.id && !x.bot)) return;
    env.boom(d.k);
  }

  function onPick(d, from) {
    const g = G();
    if (!hosting() || !g || d.rid !== g.rid || g.phase !== 'play' || !Number.isFinite(d.n)) return;
    if (match.claim(from.id, d.n)) flush();
  }

  room.on('message', (d, from) => {
    if (!isObj(d) || !from || typeof from.id !== 'string') return;
    if (d.t === 'fire') onFire(d, from);
    else if (d.t === 'dead') onDead(d, from);
    else if (d.t === 'boom') onBoom(d, from);
    else if (d.t === 'pick') onPick(d, from);
  });

  // ---------------------------------------------------------------- what this page tells the others
  return {
    G,
    tPlay,
    adopt,
    tick,
    hosting,
    get match() {
      return match;
    },

    sendFire(spec, rid) {
      room.send({ t: 'fire', rid, id: spec.id, n: spec.n, x: spec.x, y: spec.y, a: spec.a, k: spec.k, at: spec.at });
    },

    /** A tank this page decides about is destroyed: tell everyone, and (if this is the host) book it. */
    sendDead(g, id, info) {
      room.send({ t: 'dead', rid: g.rid, id, by: info.by || '', s: info.s || '', b: info.b || 0 });
      if (hosting()) {
        match.dead(id, { by: info.by || '', b: info.b || 0 }, room.matchNow());
        flush();
      }
    },

    sendBoom(g, key) {
      room.send({ t: 'boom', rid: g.rid, k: key });
    },

    /** This page's tank took crate n (the host books it directly). */
    sendPick(g, n) {
      if (hosting()) {
        if (match.claim(room.me.id, n)) flush();
      } else room.send({ t: 'pick', rid: g.rid, n }, { to: room.host });
    },

    /** A bot picked up a crate (only the host's page runs the bots). */
    claimFor(id, n) {
      if (hosting() && match.claim(id, n)) flush();
    },

    /** The host's page publishes where the bots are, about 12 times a second. */
    publishBots(g, round, tp) {
      if (!hosting()) return;
      const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (t - lastB < 80) return;
      lastB = t;
      room.setState('b', { rid: g.rid, t: Math.round(tp), p: round.snapshotBots() });
    },

    reset() {
      match = null;
      lastB = -1e9;
      deadSeen.clear();
      flood.clear();
    },
  };
}
