// Maze Tank Battle: boot, the frame loop and the screens.
//
// Every page runs a Round (round.js) and simulates every shot from the fire messages, so they all agree on each ricochet. Your
// own tank is simulated on your page and published as presence ({ x, y, a, w, d, r }); other people's tanks are drawn from
// presence, the bots' from the host's snapshots (or, on the host, from the host's own simulation). A tank's death is decided by
// the page the tank is on and told to everyone; the host keeps the match book (match.js) in the room's state `g`.
// Screens come from room.match.phase plus `g`: the title (the game alive behind one button), the lobby (the world, live, with
// practice targets), then rounds: a goal banner, play, the points bar, and at the end the podium.

import { createAudio } from './audio.js';
import { initAvatars } from './avatars.js';
import { WCOL, drawWorld } from './draw.js';
import { createFx } from './fx.js';
import { clamp } from './gfx.js';
import { createInput } from './input.js';
import { createNet } from './net.js';
import { runPoster } from './poster.js';
import { hashStr, mulberry32, shuffle } from './rng.js';
import { Round } from './round.js';
import { COLORS, COLS, DEFAULT_GOAL, GOAL_OPTIONS, INTRO_FIRST_MS, INTRO_MS, LOBBY_SEED, MAX_PLAYERS, ROWS, STEP, WEAPON, WEAPON_KEYS, accentFor, awards, buildRoster, matchRanking, ordinal, roundSeed } from './rules.js';
import { makeStubOw, makeStubRoom } from './stub.js';
import * as ui from './ui.js';

const params = new URLSearchParams(location.search);
const posterName = params.get('poster');
const canvas = document.getElementById('c');

async function boot() {
  const standalone = !window.onceworlds;
  const ow = window.onceworlds || makeStubOw();
  try {
    ow.ui.setOrientation('landscape');
  } catch {
    // not on the platform
  }
  // Join first, before anything heavy is built, so a reload doesn't miss its seat.
  let room;
  let offline = standalone;
  try {
    room = await ow.rooms.join({
      maxPlayers: MAX_PLAYERS,
      minPlayers: 1,
      lobby: 'bar',
      settings: [{ id: 'goal', label: 'Points to win', options: GOAL_OPTIONS, default: DEFAULT_GOAL }],
    });
  } catch (err) {
    console.error('could not join a room', err);
    room = standalone ? ow.room : makeStubRoom(() => ow.now());
    offline = true;
  }
  try {
    Promise.resolve(document.fonts?.load('700 40px Teko')).catch(() => {});
    Promise.resolve(document.fonts?.load('600 20px Teko')).catch(() => {});
  } catch {
    // fonts are only for looks
  }
  run(ow, room, room.kind === 'solo' && typeof room.tick === 'function' ? room : null, offline);
}

const r2 = (v) => Math.round(v * 100) / 100;
const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 24) || 'Player';
const QUALITY = { low: 0.4, medium: 0.7, high: 1 };
const CELLS = COLS * ROWS;

function run(ow, room, tickable, offline) {
  const ctx = canvas.getContext('2d');
  const audio = createAudio();
  const input = createInput(ow);
  const fx = createFx();
  const meId = room.me.id;
  initAvatars((id) => ow.player.avatarUrl(id, 'head'));

  const Sc = { w: 1, h: 1, pr: 1, u: 1, scale: 60, ox: 0, oy: 0, shx: 0, shy: 0, time: 0, q: 1, reduced: false, cache: null };

  const S = {
    started: false, // PLAY was tapped
    scene: 'title', // 'title' | 'lobby' | 'match'
    round: null, // the world being drawn and stepped
    demo: null,
    lobby: null,
    demoSeed: 3,
    demoDoneAt: -1,
    rid: '',
    roundMid: '',
    myTank: null,
    iAmIn: false,
    phaseKey: '',
    phaseAt: 0,
    goAt: -9,
    deadAt: -9,
    youUntil: 0,
    count: -1,
    freeze: 0,
    controls: '',
    stats: { matches: 0, wins: 0, kills: 0 },
    badged: new Set(),
    statsFor: '',
    card: null,
    cardAt: -99,
    lastCr: null,
    crateSeen: new Map(),
    snaps: [],
    lastB: null,
    wasHost: false,
    quiet: false,
    errors: 0,
    lobbySince: -1,
    lastPub: '',
    pubAt: 0,
    pubN: 0,
    podiumKey: '',
    podium: null,
    rowsKey: '',
    rows: null,
    chips: [],
    shake: { x: 0, y: 0 },
    camX: COLS / 2,
    camY: ROWS / 2,
    puffT: 0,
    hintX: -1,
    hintY: -1,
    hintMoved: false,
    hintFired: false,
    tmp: { x: 0, y: 0, a: 0, f: 0 },
  };
  const W = { round: null, fx, accent: accentFor(LOBBY_SEED), time: 0, meId, tags: false, youUntil: 0, guide: false, keys: false, crateSeen: S.crateSeen };

  // ---------------------------------------------------------------- saves and badges
  Promise.resolve()
    .then(() => ow.save.get('stats'))
    .then((s) => {
      if (s && typeof s === 'object') S.stats = { matches: fin(s.matches), wins: fin(s.wins), kills: fin(s.kills) };
    })
    .catch(() => {});

  function badge(id) {
    if (S.badged.has(id)) return;
    S.badged.add(id);
    Promise.resolve()
      .then(() => ow.badges.award(id))
      .catch(() => {});
  }

  // ---------------------------------------------------------------- the net
  const net = createNet(room, {
    fire(msg, rid) {
      const round = rid === 'lobby' ? S.lobby : S.round && S.round !== S.lobby && S.round !== S.demo && S.rid === rid ? S.round : null;
      if (round) round.remoteFire(msg);
    },
    dead(msg) {
      if (S.round && S.round !== S.lobby && S.round !== S.demo) S.round.remoteDead(msg.id, { by: msg.by, s: msg.s, b: msg.b });
    },
    boom(key) {
      if (S.round && S.round !== S.lobby && S.round !== S.demo) S.round.remoteBoom(key);
    },
    positions: () => (S.round && S.scene === 'match' ? S.round.aliveTanks().map((k) => ({ x: k.x, y: k.y })) : []),
  });

  const rosterEntry = (g, id) => (g ? g.roster.find((e) => e.id === id) : null);
  function nameOf(g, id) {
    const e = rosterEntry(g, id);
    if (e && e.bot) return cleanName(e.n);
    return cleanName(room.players.get(id)?.name);
  }

  // ---------------------------------------------------------------- what happens in the world
  function makeHooks(kind) {
    return {
      fire(spec, k, local) {
        const mine = Boolean(k) && k.id === meId;
        if (spec.k === 'L') audio.laser(mine);
        else if (spec.k === 'S') audio.shotgun(mine);
        else if (spec.k === 'G') audio.gatling(mine);
        else if (spec.k === 'H') audio.missile(mine);
        else if (spec.k === 'M') audio.mineDrop();
        else audio.fire(mine);
        if (spec.k !== 'M') fx.muzzle(spec.x, spec.y, spec.a, spec.k === 'S' ? 1.5 : spec.k === 'G' ? 0.5 : 1);
        if (mine) {
          fx.shake(spec.k === 'L' ? 0.2 : spec.k === 'S' ? 0.16 : spec.k === 'G' ? 0.03 : 0.05);
          S.hintFired = true;
        }
        if (local && kind !== 'demo') net.sendFire(spec, kind === 'lobby' ? 'lobby' : S.rid);
      },
      fizzle(k) {
        if (k.id === meId) audio.fizzle();
        fx.smoke(k.x + Math.cos(k.a) * 0.3, k.y + Math.sin(k.a) * 0.3, 2, 0.25);
      },
      bounce(s, nx, ny) {
        fx.bounce(s.x, s.y, nx, ny);
        audio.bounce(s.id === meId ? 1 : 0.55);
      },
      pop(x, y) {
        fx.sparks(x, y, 0, Math.PI, 10, 3.5, ['#c06bff', '#ff9d2e', '#ffcf40']);
        fx.ring(x, y, 0.05, 0.4, 0.25, '#c06bff', 0.03);
        audio.pop2();
      },
      expire(s) {
        fx.smoke(s.x, s.y, 2, 0.25, '#9aa0ad', 0.035);
      },
      laser(beam) {
        const p = beam.pts;
        for (let i = 2; i < p.length; i += 2) fx.ring(p[i], p[i + 1], 0.02, 0.2, 0.28, '#7defff', 0.025);
        fx.smoke(p[0], p[1], 3, 0.5, '#9fefff', 0.05);
      },
      armed() {
        audio.mineArm();
      },
      boom(m, local) {
        fx.explode(m.x, m.y, '#ff7a1a', '#7f2a0a', 1.1);
        audio.boom(0.9);
        fx.shake(0.45);
        const g = net.G();
        if (local && g && S.scene === 'match') net.sendBoom(g, m.key);
      },
      dead(k, info) {
        onTankDead(k, info);
      },
      claim(k, c) {
        onClaim(k, c);
      },
      target(t) {
        fx.sparks(t.x, t.y, 0, Math.PI, 9, 3, ['#e63946', '#ff9d2e', '#ffcf40']);
        fx.ring(t.x, t.y, 0.05, 0.4, 0.25, '#ffffff', 0.03);
        audio.target();
      },
    };
  }
  const hooks = { demo: makeHooks('demo'), lobby: makeHooks('lobby'), match: makeHooks('match') };

  function onTankDead(k, info) {
    if (S.quiet) return;
    const col = COLORS[k.c % COLORS.length];
    const mine = k.id === meId;
    fx.explode(k.x, k.y, col.main, col.dark, mine ? 1.25 : 1);
    audio.boom(mine ? 1 : 0.8);
    fx.shake(mine ? 0.75 : S.round === S.demo ? 0 : 0.3);
    if (S.round === S.demo) return;
    if (!Sc.reduced && (mine || info.by === meId)) S.freeze = 0.07;
    const g = net.G();
    if (S.scene !== 'match' || !g) return;
    if (info.local) net.sendDead(g, k.id, info);
    if (mine) {
      S.deadAt = Sc.time;
      audio.out();
      try {
        navigator.vibrate?.(60);
      } catch {
        // not on every phone
      }
      if (info.by === meId) badge('oops');
    } else if (info.by === meId) {
      if (fin(info.b) >= 3) {
        badge('bank-shot');
        fx.popup('BANK SHOT', k.x, k.y - 0.25, '#12c2e9', 1.15);
      }
    }
  }

  function onClaim(k, c) {
    fx.ring(c.x, c.y, 0.1, 0.5, 0.3, WCOL[c.kind] || '#fff', 0.03);
    if (k.id === meId) {
      audio.pickup();
      fx.popup(WEAPON[c.kind].name, k.x, k.y - 0.3, WCOL[c.kind] || '#fff', 1);
      const g = net.G();
      if (g && S.scene === 'match') net.sendPick(g, c.n);
    } else if (S.scene === 'match') net.claimFor(k.id, c.n); // (only the host's page decides about other tanks, and its call is the one that counts)
  }

  // ---------------------------------------------------------------- the three worlds
  const lobbySpot = (id) => {
    const c = hashStr(id) % CELLS;
    return { x: (c % COLS) + 0.5, y: ((c / COLS) | 0) + 0.5, a: Math.atan2(ROWS / 2 - ((c / COLS) | 0) - 0.5, COLS / 2 - (c % COLS) - 0.5) };
  };

  function ensureDemo() {
    const d = S.demo;
    if (d && S.demoDoneAt < 0) {
      // a round that is over (or has gone on too long) is followed by a new maze
      const alive = d.aliveCount();
      if (alive <= 1 || d.t > 24000) S.demoDoneAt = Sc.time;
    }
    if (!d || (S.demoDoneAt >= 0 && Sc.time - S.demoDoneAt > 1.8)) {
      S.demoSeed = (S.demoSeed * 7 + 11) >>> 0;
      const demo = new Round({ roster: buildRoster([], S.demoSeed), seed: S.demoSeed, roundNo: 1 });
      for (const k of demo.tanks) {
        k.sim = true;
        k.ai.warm = 0.6 + k.idx * 0.5;
        k.tag = '';
      }
      demo.hooks = hooks.demo;
      S.demo = demo;
      S.demoDoneAt = -1;
      fx.clear();
    }
  }

  function ensureLobby() {
    if (S.lobby) return;
    const round = new Round({ roster: [], seed: LOBBY_SEED, roundNo: 0, practice: true });
    const cells = shuffle(Array.from({ length: CELLS }, (_, i) => i), mulberry32(hashStr('targets')));
    round.addTargets(cells.slice(0, 5));
    round.hooks = hooks.lobby;
    S.lobby = round;
  }

  /** The people in the lobby's world: you, and whoever has pressed Play (their presence says so). */
  function syncLobbyTanks() {
    const round = S.lobby;
    if (!S.started) return;
    if (!round.byId.has(meId)) {
      const k = round.addTank({ id: meId, bot: false, c: hashStr(meId) % COLORS.length }, lobbySpot(meId));
      k.sim = true;
      k.vis.pop = 1;
      k.vis.mx = k.x;
      k.vis.my = k.y;
    }
    for (const p of room.online) {
      if (p.id === meId) continue;
      const pr = room.presenceAt(p.id, { angles: ['a'], snap: 2.5 });
      const ok = isObj(pr) && Number.isFinite(pr.x) && Number.isFinite(pr.y) && pr.r === '';
      const has = round.byId.has(p.id);
      if (ok && !has) {
        const k = round.addTank({ id: p.id, bot: false, c: hashStr(p.id) % COLORS.length }, { x: clamp(pr.x, 0.3, COLS - 0.3), y: clamp(pr.y, 0.3, ROWS - 0.3), a: fin(pr.a) });
        k.vis.pop = 1;
        k.vis.mx = k.x;
        k.vis.my = k.y;
      } else if (!ok && has) round.removeTank(p.id);
    }
    for (const k of round.tanks.slice()) if (k.id !== meId && !room.players.has(k.id)) round.removeTank(k.id);
    S.myTank = round.byId.get(meId) || null;
    if (S.myTank) {
      S.myTank.me = true;
      S.myTank.sim = true;
    }
  }

  function enterRound(g) {
    S.rid = g.rid;
    S.roundMid = g.mid;
    const round = new Round({ roster: g.roster, seed: roundSeed(g.seed, g.round), roundNo: g.round });
    round.hooks = hooks.match;
    S.round = round;
    S.myTank = round.byId.get(meId) || null;
    S.iAmIn = Boolean(S.myTank) && !room.spectating && room.isParticipant(meId);
    S.snaps.length = 0;
    S.lastB = null;
    S.lastCr = null;
    S.crateSeen.clear();
    S.wasHost = false;
    S.phaseKey = '';
    fx.clear();
    input.dropEdge();
    for (const k of round.tanks) {
      k.me = Boolean(S.myTank) && k === S.myTank;
      k.tag = k.bot ? cleanName(k.name) : '';
      k.vis.pop = 1;
      k.pn = -1;
      k.pnAt = Sc.time;
    }
    if (S.iAmIn) {
      S.myTank.sim = true;
      // a reload in the middle of a round: carry on from the last position the room has
      const p = room.me.presence;
      if (g.phase === 'play' && isObj(p) && p.r === g.rid && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.a)) {
        S.myTank.x = clamp(p.x, 0.3, COLS - 0.3);
        S.myTank.y = clamp(p.y, 0.3, ROWS - 0.3);
        S.myTank.a = p.a;
      }
    }
    for (const k of round.tanks) {
      k.vis.mx = k.x;
      k.vis.my = k.y;
    }
    round.t = g.phase === 'play' ? net.tPlay(g) : 0;
    S.youUntil = Sc.time + 3.2;
    // the record may already say who is out (a reload, a late look): they just aren't there, no explosions
    S.quiet = true;
    syncRecord(g);
    S.quiet = false;
  }

  /** What the match record says that this page's world must show: crates on the floor, tanks that are out. */
  function syncRecord(g) {
    const round = S.round;
    if (g.cr !== S.lastCr) {
      S.lastCr = g.cr;
      round.setCrates(g.cr);
      for (const c of round.crates) {
        if (!S.crateSeen.has(c.n)) {
          S.crateSeen.set(c.n, Sc.time);
          if (!S.quiet && g.phase === 'play') audio.pop();
        }
      }
    }
    for (const [id, rec] of Object.entries(g.out)) {
      const k = round.byId.get(id);
      if (k && k.alive && Array.isArray(rec)) round.remoteDead(id, { by: typeof rec[1] === 'string' ? rec[1] : '', b: fin(rec[3]), s: '' });
    }
  }

  // ---------------------------------------------------------------- other people's tanks
  function readPresence(k, rid, dt) {
    const p = room.presenceAt(k.id, { angles: ['a'], snap: 2.5 });
    if (!isObj(p) || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.a) || p.r !== rid) return false;
    const pl = room.players.get(k.id);
    const nx = clamp(p.x, 0, COLS);
    const ny = clamp(p.y, 0, ROWS);
    if (dt > 0.001 && dt < 0.2) {
      const away = !pl || pl.connected === false;
      const vx = away ? 0 : clamp((nx - k.x) / dt, -3, 3);
      const vy = away ? 0 : clamp((ny - k.y) / dt, -3, 3);
      k.vx += (vx - k.vx) * 0.3;
      k.vy += (vy - k.vy) * 0.3;
    }
    k.x = nx;
    k.y = ny;
    k.a = p.a;
    const w = Math.round(fin(p.w));
    k.weapon = w >= 1 && w <= WEAPON_KEYS.length ? { k: WEAPON_KEYS[w - 1], ammo: 1 } : null;
    // every update has a number: a page that stops counting (a tab in the background) is not playing any more
    const n = fin(p.n, -1);
    if (n !== k.pn) {
      k.pn = n;
      k.pnAt = Sc.time;
    }
    return true;
  }

  function readSnaps(g) {
    const b = room.state.b;
    if (!b || b === S.lastB) return;
    S.lastB = b;
    if (!isObj(b) || b.rid !== g.rid || !Number.isFinite(b.t) || !Array.isArray(b.p)) return;
    const last = S.snaps[S.snaps.length - 1];
    if (last && b.t <= last.t) return;
    S.snaps.push({ t: b.t, p: b.p });
    if (S.snaps.length > 6) S.snaps.shift();
  }

  /** Where bot number i was at play time rt, between the host's two snapshots around it. */
  function botAt(i, out, rt) {
    const s = S.snaps;
    const n = s.length;
    if (!n) return false;
    let a = s[0];
    let b = s[n - 1];
    let f = 0;
    if (rt <= a.t) b = a;
    else if (rt >= b.t) a = b;
    else {
      for (let k = n - 2; k >= 0; k--) {
        if (s[k].t <= rt) {
          a = s[k];
          b = s[k + 1];
          break;
        }
      }
      f = (rt - a.t) / Math.max(1, b.t - a.t);
    }
    const pa = a.p[i];
    const pb = b.p[i];
    if (!Array.isArray(pa) || !Array.isArray(pb) || pa.length < 4 || pb.length < 4) return false;
    for (let k = 0; k < 4; k++) if (!Number.isFinite(pa[k]) || !Number.isFinite(pb[k])) return false;
    out.x = pa[0] + (pb[0] - pa[0]) * f;
    out.y = pa[1] + (pb[1] - pa[1]) * f;
    let da = pb[2] - pa[2];
    da = ((((da + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
    out.a = pa[2] + da * f;
    out.f = pb[3] | 0;
    return true;
  }

  function refreshViews(dt, g) {
    const round = S.round;
    if (!round) return;
    if (S.scene === 'title') return;
    if (S.scene === 'lobby') {
      for (const k of round.tanks) {
        if (k.id === meId) {
          k.hidden = false;
          k.tag = cleanName(room.me.name);
          k.ready = Boolean(room.me.ready);
          continue;
        }
        const pl = room.players.get(k.id);
        readPresence(k, '', dt);
        k.tag = cleanName(pl?.name);
        k.ready = Boolean(pl?.ready);
      }
      return;
    }
    const hosting = net.hosting();
    if (hosting && !S.wasHost) {
      // this page just became the host: carry on with the bots where the last host left them
      const b = room.state.b;
      if (isObj(b) && b.rid === g.rid && Array.isArray(b.p)) round.restoreBots(b.p);
    }
    S.wasHost = hosting;
    if (!hosting) readSnaps(g);
    const rt = net.tPlay(g) - 80;
    let bi = 0;
    for (const k of round.tanks) {
      if (k.bot) {
        k.sim = hosting && k.alive;
        if (!hosting && k.alive && botAt(bi, S.tmp, rt)) {
          const nx = S.tmp.x;
          const ny = S.tmp.y;
          if (dt > 0.001 && dt < 0.2) {
            k.vx += (clamp((nx - k.x) / dt, -3, 3) - k.vx) * 0.3;
            k.vy += (clamp((ny - k.y) / dt, -3, 3) - k.vy) * 0.3;
          }
          k.x = nx;
          k.y = ny;
          k.a = S.tmp.a;
          const w = (S.tmp.f >> 1) & 7;
          k.weapon = w >= 1 && w <= WEAPON_KEYS.length ? { k: WEAPON_KEYS[w - 1], ammo: 1 } : null;
        }
        bi++;
      } else if (k === S.myTank && S.iAmIn) {
        k.sim = k.alive;
      } else {
        const pl = room.players.get(k.id);
        const away = !pl || pl.connected === false || Sc.time - k.pnAt > 3;
        // the host decides about a person whose page is away or has stopped (their tank just stands there)
        k.sim = hosting && away && k.alive;
        if (!readPresence(k, g.rid, dt)) {
          k.vx = 0;
          k.vy = 0;
        }
      }
    }
    for (const k of round.tanks) {
      if (!k.bot) k.tag = k.id === meId ? cleanName(room.me.name) : cleanName(room.players.get(k.id)?.name);
    }
  }

  // ---------------------------------------------------------------- layout
  function resize() {
    const w = Math.max(1, window.innerWidth || 800);
    const h = Math.max(1, window.innerHeight || 450);
    const pr = Math.max(0.5, Number(ow.settings.pixelRatio(2)) || 1);
    Sc.w = w;
    Sc.h = h;
    Sc.pr = pr;
    Sc.u = clamp(Math.min(w, h) / 430, 0.8, 1.9);
    canvas.width = Math.floor(w * pr);
    canvas.height = Math.floor(h * pr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  function applySettings() {
    Sc.q = QUALITY[ow.settings.quality] ?? 1;
    Sc.reduced = Boolean(ow.settings.reducedMotion);
    fx.q = Sc.q;
    fx.reduced = Sc.reduced;
  }
  resize();
  applySettings();
  addEventListener('resize', resize);
  try {
    ow.settings.on('change', () => {
      applySettings();
      resize();
    });
  } catch {
    // older platform
  }

  function fitLayout(top, bottom) {
    const availW = Sc.w - 12;
    const availH = Math.max(40, Sc.h - top - bottom - 6);
    Sc.scale = Math.max(8, Math.min(availW / (COLS + 0.4), availH / (ROWS + 0.4)));
    Sc.ox = (Sc.w - COLS * Sc.scale) / 2;
    Sc.oy = top + (availH + 6 - ROWS * Sc.scale) / 2;
  }

  function layout(dt) {
    if (S.scene === 'title') {
      // a closer view that drifts over the maze, following the action
      const fit = Math.min((Sc.w - 12) / (COLS + 0.4), (Sc.h - 12) / (ROWS + 0.4));
      Sc.scale = fit * 1.35;
      const d = S.demo;
      let tx = COLS / 2;
      let ty = ROWS / 2;
      if (d) {
        let n = 0;
        let sx = 0;
        let sy = 0;
        for (const k of d.tanks) {
          if (!k.alive) continue;
          sx += k.x;
          sy += k.y;
          n++;
        }
        if (n) {
          tx = sx / n;
          ty = sy / n;
        }
      }
      const kk = 1 - Math.exp(-1.2 * dt);
      S.camX += (tx + Math.sin(Sc.time * 0.21) * 0.6 - S.camX) * kk;
      S.camY += (ty + Math.cos(Sc.time * 0.17) * 0.4 - S.camY) * kk;
      const mw = (COLS + 0.3) * Sc.scale;
      const mh = (ROWS + 0.3) * Sc.scale;
      let ox = Sc.w / 2 - S.camX * Sc.scale;
      let oy = Sc.h / 2 - S.camY * Sc.scale;
      ox = mw <= Sc.w ? (Sc.w - COLS * Sc.scale) / 2 : clamp(ox, Sc.w - mw + 0.15 * Sc.scale, 0.15 * Sc.scale);
      oy = mh <= Sc.h ? (Sc.h - ROWS * Sc.scale) / 2 : clamp(oy, Sc.h - mh + 0.15 * Sc.scale, 0.15 * Sc.scale);
      Sc.ox = ox;
      Sc.oy = oy;
    } else if (S.scene === 'lobby') fitLayout(ui.lobbyTop(Sc), clamp(Sc.h * 0.17, 56, 96));
    else fitLayout(ui.hudHeight(Sc) + 6, 6);
  }

  // ---------------------------------------------------------------- the record and the phases of a round
  function currentRecord() {
    if (!S.started) return null;
    return room.match.phase === 'playing' ? net.G() : null;
  }

  function setScene(g) {
    const want = !S.started ? 'title' : g ? 'match' : 'lobby';
    if (want === S.scene) return;
    S.scene = want;
    S.phaseKey = '';
    input.dropEdge();
    if (want === 'lobby') {
      S.rid = '';
      S.myTank = null;
      S.iAmIn = false;
      S.quiet = false;
      fx.clear();
    }
  }

  function onPhase(g) {
    S.phaseKey = `${g.rid}|${g.phase}`;
    S.phaseAt = Sc.time;
    const round = S.round;
    if (g.phase === 'intro') {
      for (const k of round.tanks) k.vis.pop = 1;
      S.youUntil = Sc.time + 3.2;
      audio.round();
    } else if (g.phase === 'play') {
      if (net.tPlay(g) < 1500) {
        S.goAt = Sc.time;
        audio.go();
      }
      input.dropEdge();
    } else if (g.phase === 'end') {
      // what is still in the air at the end of a round is no longer anyone's business
      round.shots.length = 0;
      round.mines.length = 0;
      const w = round.byId.get(g.win);
      if (w && w.alive) {
        fx.confetti(w.x, w.y - 0.2, 34, 2.6, 4);
        fx.ring(w.x, w.y, 0.2, 1.3, 0.7, '#ffc400', 0.045);
        fx.popup('+1', w.x, w.y - 0.3, '#ffc400', 1.7);
      }
      if (g.win && g.win === meId) audio.win();
      else if (g.win) audio.point();
      else audio.lose();
      if (fin(g.st[meId]) >= 5) badge('ace');
    } else if (g.phase === 'final') {
      fx.confetti(COLS / 2, ROWS / 2 - 1, 90, 4, 4);
      audio.win();
      finishStats(g);
    }
  }

  function finishStats(g) {
    if (S.statsFor === g.mid) return;
    S.statsFor = g.mid;
    if (!S.started || !rosterEntry(g, meId)) return;
    const won = matchRanking(g.roster, g.scores, g.kills)[0] === meId && fin(g.scores[meId]) > 0;
    const stats = S.stats;
    stats.matches += 1;
    stats.kills += fin(g.kills[meId]);
    if (won) {
      stats.wins += 1;
      badge('first-win');
    }
    Promise.resolve()
      .then(() => ow.save.set('stats', { matches: stats.matches, wins: stats.wins, kills: stats.kills }))
      .catch(() => {});
    if (won) {
      Promise.resolve()
        .then(() => ow.leaderboards.submit('wins', stats.wins))
        .catch(() => {});
    }
  }

  function podiumData(g) {
    const ranking = matchRanking(g.roster, g.scores, g.kills);
    const entry = (id) => {
      const e = rosterEntry(g, id);
      return { id, name: nameOf(g, id), bot: Boolean(e && e.bot), c: e ? fin(e.c) : 0, color: COLORS[(e ? fin(e.c) : 0) % COLORS.length].main, score: fin(g.scores[id]), me: id === meId };
    };
    const aw = awards(g.roster, g.kills, g.bank);
    const named = (a) => (a ? { ...entry(a.id), v: a.v } : null);
    const place = ranking.indexOf(meId) + 1;
    return {
      top: ranking.slice(0, 3).map(entry),
      awards: { kills: named(aw.kills), bank: named(aw.bank) },
      you: S.started && place > 3 ? { label: ordinal(place), score: fin(g.scores[meId]) } : null,
      win: ranking[0] === meId && fin(g.scores[meId]) > 0,
    };
  }

  function pointRows(g) {
    return g.roster.map((e) => ({
      id: e.id,
      c: fin(e.c),
      name: nameOf(g, e.id),
      bot: Boolean(e.bot),
      me: e.id === meId,
      score: fin(g.scores[e.id]),
      pts: e.id === g.win ? 1 : 0,
    }));
  }

  // ---------------------------------------------------------------- stepping the world
  function stepMe(allowed) {
    const k = S.myTank;
    if (!k || !k.alive || !k.sim) return;
    input.drive(k.inp);
    k.inp.fire = allowed && input.fireHeld();
    k.inp.edge = allowed && input.takeEdge();
    if (!allowed) input.dropEdge();
  }

  function stepWorld(g) {
    if (S.scene === 'title') {
      if (S.demo) S.demo.step(STEP);
      return;
    }
    if (S.scene === 'lobby') {
      if (!S.lobby) return;
      stepMe(true);
      S.lobby.step(STEP);
      return;
    }
    const round = S.round;
    if (!g || !round || !room.running) return;
    if (g.phase === 'play') {
      stepMe(true);
      round.step(STEP);
    } else if (g.phase === 'end') round.step(STEP, true);
  }

  /** Things that need the new positions: tread marks, exhaust puffs, the missile's trail, the engine's hum. */
  function postStep(dt) {
    const round = S.round;
    if (!round) return;
    // the little animations of the tanks run on screen time, whether or not the world is being stepped (the intro isn't)
    for (const k of round.tanks) {
      const v = k.vis;
      if (v.recoil > 0) v.recoil = Math.max(0, v.recoil - dt * 7);
      if (v.pop > 0) v.pop = Math.max(0, v.pop - dt * 3);
      if (v.flash > 0) v.flash = Math.max(0, v.flash - dt * 6);
    }
    S.puffT += dt;
    const puff = S.puffT > 0.1;
    if (puff) S.puffT = 0;
    for (const k of round.tanks) {
      if (!k.alive || k.hidden) continue;
      const v = k.vis;
      const d = Math.hypot(k.x - v.mx, k.y - v.my);
      if (d > 1.2) {
        v.mx = k.x;
        v.my = k.y;
        v.ma = k.a;
        continue;
      }
      if (d >= 0.07) {
        const c0 = Math.cos(v.ma);
        const s0 = Math.sin(v.ma);
        const c1 = Math.cos(k.a);
        const s1 = Math.sin(k.a);
        for (const side of [-0.105, 0.105]) fx.mark(v.mx - s0 * side, v.my + c0 * side, k.x - s1 * side, k.y + c1 * side);
        v.mx = k.x;
        v.my = k.y;
        v.ma = k.a;
      }
      if (puff && Math.hypot(k.vx, k.vy) > 0.5) fx.smoke(k.x - Math.cos(k.a) * 0.24, k.y - Math.sin(k.a) * 0.24, 1, 0.12, '#aeb3bf', 0.035);
    }
    for (const s of round.shots) if (s.k === 'H' && !s.dead && fx.rand() < 0.6) fx.smoke(s.x - s.dx * 0.07, s.y - s.dy * 0.07, 1, 0.15, '#c9ccd4', 0.032);
    const me = S.myTank;
    if (S.scene === 'lobby' && me) {
      // the keys are shown until you have driven somewhere and fired
      if (S.hintX < 0) {
        S.hintX = me.x;
        S.hintY = me.y;
      } else if (Math.hypot(me.x - S.hintX, me.y - S.hintY) > 1.2) S.hintMoved = true;
    }
    audio.engine(me && me.alive && me.sim && (S.scene === 'lobby' || room.running) ? clamp(Math.hypot(me.vx, me.vy) / 1.6, 0, 1) : 0);
  }

  // ---------------------------------------------------------------- publishing, controls, music
  function publish(g) {
    if (!S.started) return;
    const k = S.myTank;
    let rid = '';
    if (S.scene === 'match') {
      if (!g || !S.iAmIn || !k) return;
      rid = S.rid;
    } else if (!k) return;
    const w = k.weapon ? WEAPON_KEYS.indexOf(k.weapon.k) + 1 : 0;
    const msg = { x: r2(k.x), y: r2(k.y), a: r2(k.a), w, d: k.alive ? 0 : 1, r: rid, n: S.pubN++ };
    const key = `${msg.x},${msg.y},${msg.a},${msg.w},${msg.d},${msg.r}`;
    const now = Sc.time;
    if (key === S.lastPub && now - S.pubAt < 1) return;
    S.lastPub = key;
    S.pubAt = now;
    room.setPresence(msg);
  }

  function setControls(g) {
    let want = '';
    if (S.started) {
      if (S.scene === 'lobby') want = 'play';
      else if (g && S.iAmIn && g.phase !== 'final') want = 'play';
    }
    if (want === S.controls) return;
    S.controls = want;
    try {
      if (want) ow.controls.set({ stick: 'analog', buttons: [{ id: 'fire', label: 'Fire', key: ' ' }] });
      else ow.controls.set(null);
    } catch {
      // controls are only on the platform
    }
  }

  function setMusic(g) {
    let level = 'menu';
    if (S.scene === 'match' && g && g.phase !== 'final') level = 'play';
    audio.setLevel(level);
  }

  // ---------------------------------------------------------------- drawing
  function hudChips(g) {
    const chips = S.chips;
    while (chips.length < g.roster.length) chips.push({ c: 0, score: 0, out: false, me: false, bot: false });
    chips.length = g.roster.length;
    g.roster.forEach((e, i) => {
      const c = chips[i];
      c.c = fin(e.c);
      c.score = fin(g.scores[e.id]);
      c.out = g.out[e.id] !== undefined;
      c.me = e.id === meId && !e.bot;
      c.bot = Boolean(e.bot);
    });
    return chips;
  }

  function drawScreens(g) {
    const t = Sc.time;
    if (S.scene === 'title') {
      ui.drawTitle(ctx, Sc, t, { accent: W.accent, touch: Boolean(ow.controls.touch) });
      return;
    }
    const m = room.match;
    if (S.scene === 'lobby') {
      ui.rects.goal.length = 0;
      if (m.phase === 'lobby') {
        const goal = GOAL_OPTIONS.includes(Number(room.settings.goal)) ? Number(room.settings.goal) : DEFAULT_GOAL;
        ui.drawLobbyHud(ctx, Sc, { goal, options: GOAL_OPTIONS, isHost: room.isHost, hint: 'BANK SHOTS OFF WALLS', accent: W.accent });
        if (S.card && t - S.cardAt < 7) ui.drawResultsCard(ctx, Sc, { top: S.card.top, age: t - S.cardAt, life: 7 });
      }
      if (m.phase === 'starting' && S.count >= 1) {
        const left = m.startsAt - ow.now();
        ui.drawCountdown(ctx, Sc, S.count, clamp((S.count * 1000 - left) / 1000, 0, 1), W.accent);
      }
      return;
    }
    ui.rects.goal.length = 0;
    if (!g) return;
    const age = t - S.phaseAt;
    if (g.phase === 'final') {
      if (S.podiumKey !== g.mid) {
        S.podiumKey = g.mid;
        S.podium = podiumData(g);
        S.card = { top: S.podium.top };
      }
      ui.drawPodium(ctx, Sc, { ...S.podium, age });
      return;
    }
    const me = S.myTank;
    ui.drawHud(ctx, Sc, {
      round: g.round,
      goal: g.goal,
      chips: hudChips(g),
      timeLeft: g.phase === 'play' ? Math.max(0, g.until - room.matchNow()) : Infinity,
      out: S.iAmIn && me ? !me.alive : false,
      weapon: S.iAmIn && me && me.alive ? me.weapon : null,
      accent: W.accent,
    });
    if (!S.iAmIn) ui.drawWatching(ctx, Sc);
    if (g.phase === 'intro') {
      ui.drawBanner(ctx, Sc, { text: 'LAST TANK WINS', sub: `ROUND ${g.round}`, age, dur: (g.round === 1 ? INTRO_FIRST_MS : INTRO_MS) / 1000, accent: W.accent });
    } else if (g.phase === 'play') {
      if (t - S.goAt < 0.8) ui.drawCountdown(ctx, Sc, 0, (t - S.goAt) / 0.8, W.accent);
      if (S.iAmIn && me && !me.alive) ui.drawCallout(ctx, Sc, 'ELIMINATED', t - S.deadAt, { color: '#ff4b4b' });
    } else if (g.phase === 'end') {
      if (S.rowsKey !== g.rid) {
        S.rowsKey = g.rid;
        S.rows = pointRows(g);
      }
      const win = rosterEntry(g, g.win);
      ui.drawEnd(ctx, Sc, { rows: S.rows, goal: g.goal, winName: g.win ? nameOf(g, g.win) : '', winC: win ? fin(win.c) : 0, draw: !g.win, age, accent: W.accent });
    }
  }

  // ---------------------------------------------------------------- the loop
  let last = performance.now();
  let acc = 0;

  function frame(ts) {
    requestAnimationFrame(frame);
    try {
      const gap = (ts - last) / 1000;
      const dt = clamp(gap, 0, 0.1);
      last = ts;
      if (gap > 0.5 && S.round) {
        // the page was asleep (a hidden tab): what was in flight is stale, and a mine has been arming all the while
        S.round.shots.length = 0;
        S.round.beams.length = 0;
        for (const m of S.round.mines) m.age += gap;
      }
      Sc.time = ts / 1000;
      if (tickable) tickable.tick();
      // Opened on its own there is no Ready strip: get ready by itself so the whole game can be seen.
      if (offline && S.started && room.match.phase === 'lobby') {
        if (S.lobbySince < 0) S.lobbySince = Sc.time;
        else if (Sc.time - S.lobbySince > 2.5 && !room.me.ready) room.setReady(true);
      } else S.lobbySince = -1;
      input.poll();
      // a page that comes up in the middle of a match it plays in (a reload) is back in it at once: its tank can't stand there unplayed
      if (!S.started && room.match.phase !== 'lobby' && room.isParticipant(meId)) pressPlay(false);

      const g = currentRecord();
      setScene(g);
      if (S.scene === 'title') {
        ensureDemo();
        S.round = S.demo;
      } else if (S.scene === 'lobby') {
        ensureLobby();
        S.round = S.lobby;
        syncLobbyTanks();
      } else {
        const stale = !S.round || S.round === S.lobby || S.round === S.demo || S.roundMid !== g.mid || (g.phase !== 'final' && g.rid !== S.rid);
        if (stale) enterRound(g);
        if (`${g.rid}|${g.phase}` !== S.phaseKey) onPhase(g);
        syncRecord(g);
      }
      const round = S.round;
      // the clock each page's world runs on: platform time in the lobby, round time in a match
      if (S.scene === 'lobby' && round) round.t = ow.now();
      else if (S.scene === 'match' && round && g.phase === 'play') {
        const tp = net.tPlay(g);
        if (Math.abs(round.t - tp) > 60) round.t = tp;
      }
      refreshViews(dt, g);

      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 6) {
        acc -= STEP;
        steps++;
        stepWorld(g);
      }
      if (steps === 6) acc = 0;
      postStep(dt);

      // the countdown
      const m = room.match;
      if (m.phase === 'starting' && Number.isFinite(m.startsAt)) {
        const left = m.startsAt - ow.now();
        const n = left > 0 ? Math.min(3, Math.ceil(left / 1000)) : 0;
        if (n !== S.count) {
          S.count = n;
          if (n >= 1 && S.started) audio.tick();
        }
      } else S.count = -1;

      if (S.scene === 'match' && g && g.phase === 'play' && round) net.publishBots(g, round, net.tPlay(g));
      if (S.freeze > 0) S.freeze = Math.max(0, S.freeze - dt);
      else fx.update(dt);
      fx.shakeOffset(S.shake, Math.min(Sc.w, Sc.h) * 0.025);
      Sc.shx = S.shake.x;
      Sc.shy = S.shake.y;
      layout(dt);
      setControls(g);
      setMusic(g);
      publish(g);

      if (S.freeze <= 0) {
        // what the world needs to know about the screen
        W.round = round;
        W.time = Sc.time;
        W.accent = round ? accentFor(round.seed) : W.accent;
        W.tags = S.scene === 'lobby' || (S.scene === 'match' && g && g.phase === 'intro');
        W.youUntil = S.youUntil;
        W.guide = S.scene === 'lobby' && room.match.phase === 'lobby';
        W.keys = W.guide && !ow.controls.touch && !(S.hintMoved && S.hintFired);
        drawWorld(ctx, Sc, W);
        drawScreens(g);
      }
    } catch (err) {
      S.errors++;
      console.error(err);
      if (S.errors <= 3) setTimeout(() => { throw err; });
    }
  }

  // ---------------------------------------------------------------- starting, tapping, the match's life
  function pressPlay(sound = true) {
    if (S.started) return;
    S.started = true;
    audio.unlock();
    if (sound) audio.click();
    input.clear();
    input.dropEdge();
    S.youUntil = Sc.time + 3;
    ensureLobby();
    try {
      room.hideLobby(false);
    } catch {
      // nothing to hide outside the platform
    }
  }

  const inRect = (r, x, y) => Boolean(r) && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

  canvas.addEventListener('pointerdown', (e) => {
    audio.unlock();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (!S.started) {
      if (inRect(ui.rects.play, x, y) || room.match.phase !== 'lobby') pressPlay();
      return;
    }
    if (S.scene === 'lobby' && room.match.phase === 'lobby' && room.isHost) {
      for (const r of ui.rects.goal) {
        if (inRect(r, x, y)) {
          audio.click();
          room.setSetting('goal', r.v);
          return;
        }
      }
    }
    if (e.pointerType !== 'touch') input.setMouse(true);
  });
  for (const type of ['pointerup', 'pointercancel']) addEventListener(type, () => input.setMouse(false));

  // iPhones start sound only from the end of a tap, so ask again when the finger lifts
  for (const type of ['pointerup', 'touchend', 'click']) addEventListener(type, () => audio.unlock(), true);

  addEventListener('keydown', (e) => {
    audio.unlock();
    if (!S.started && (e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
      e.preventDefault();
      pressPlay();
    }
  });

  room.on('starting', () => {
    S.count = -1;
    // a private server's match is closed to newcomers: let friends in to watch
    try {
      if (room.isHost && room.kind === 'private') room.setOpen?.(true);
    } catch {
      // not on the platform
    }
  });
  room.on('matchstart', () => {
    S.rid = '';
    S.roundMid = '';
    S.phaseKey = '';
    S.snaps.length = 0;
    try {
      room.hideLobby(!S.started);
    } catch {
      // not on the platform
    }
    net.adopt();
  });
  room.on('matchend', (_match, previous) => {
    try {
      room.hideLobby(!S.started);
    } catch {
      // not on the platform
    }
    if (!previous || previous.phase !== 'playing') return; // a countdown that was stopped: nothing to put away
    if (S.podium && S.podiumKey) {
      S.card = { top: S.podium.top };
      S.cardAt = Sc.time;
    }
    S.rid = '';
    S.roundMid = '';
    S.round = null;
    S.phaseKey = '';
    S.myTank = null;
    S.iAmIn = false;
    S.quiet = false;
    net.reset();
    fx.clear();
    S.lobby = null; // back in the lobby: the world there starts fresh
    input.dropEdge();
  });
  room.on('host', () => net.adopt());
  room.on('reconnect', () => net.adopt());
  room.on('matchresume', () => net.adopt());

  setInterval(() => net.tick(), 100);
  try {
    room.hideLobby(true); // the title is up: no Ready strip yet
  } catch {
    // not on the platform
  }
  net.adopt();
  requestAnimationFrame(frame);
  // a seam for the node tests (they set this before loading the page); nothing in the game uses it
  if (typeof window.__tankTest === 'function') window.__tankTest({ S, Sc, net, room, fx, audio });
}

// Everything above is declared before the page starts: run() reads it at once.
if (posterName) await runPoster(posterName, canvas);
else await boot();
