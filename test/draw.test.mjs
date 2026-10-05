// Draws every kind of thing the renderer knows (all five crates, every shot, beams, mines, scorch, tracks, particles, tags, keys,
// every screen of ui.js) on the checking canvas: nothing may throw, nothing odd (NaN, negative radius) may reach the context, and
// every save() has its restore(). Also quality low/high and a reduced-motion page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errors, makePage } from './fakedom.mjs';

test('every drawing routine runs clean', async () => {
  const page = makePage({ w: 812, h: 375 });
  page.install();
  const { drawWorld, drawWeaponIcon } = await import('../game/draw.js');
  const ui = await import('../game/ui.js');
  const { createFx } = await import('../game/fx.js');
  const { Round } = await import('../game/round.js');
  const { makeMaze } = await import('../game/maze.js');
  const { buildRoster, COLORS } = await import('../game/rules.js');
  const { initAvatars } = await import('../game/avatars.js');
  initAvatars(async () => null);

  for (const [q, reduced] of [[1, false], [0.4, false], [0.7, true]]) {
    const ctx = page.ctx;
    const fx = createFx();
    fx.q = q;
    fx.reduced = reduced;
    const Sc = { w: 812, h: 375, pr: 2, u: 0.9, scale: 52, ox: 160, oy: 44, shx: 3, shy: -2, time: 12.3, q, reduced, cache: null };
    const maze = makeMaze(99);
    const roster = buildRoster(['me', 'you2'], 5);
    const round = new Round({ roster, seed: 99, roundNo: 1, maze });
    round.hooks = {};
    round.tanks.forEach((k, i) => {
      k.sim = true;
      k.me = i === 0;
      k.tag = i === 0 ? 'Me' : `Name${i}`;
      k.ready = i === 1;
      k.weapon = i === 2 ? { k: 'G', ammo: 12 } : i === 3 ? { k: 'M', ammo: 1 } : null;
      k.vis.recoil = 0.5;
      k.vis.pop = 0.4;
      k.vis.flash = 0.5;
      k.vis.track = 0.13;
    });
    // shots of every kind, a beam, mines (arming and armed), crates of every kind, practice targets
    const t0 = round.tanks[0];
    for (const [i, kind] of ['N', 'S', 'G', 'H'].entries()) round.spawn({ id: 'me', n: 10 + i, x: t0.x + 0.4, y: t0.y, a: i, k: kind, at: 0 }, 0.5);
    round.spawn({ id: 'me', n: 20, x: t0.x, y: t0.y, a: 1, k: 'L', at: 0 }, 0);
    round.spawn({ id: 'me', n: 21, x: 2.5, y: 2.5, a: 0, k: 'M', at: 0 }, 0);
    round.spawn({ id: 'me', n: 22, x: 3.5, y: 2.5, a: 0, k: 'M', at: 0 }, 2);
    round.setCrates([[1, 1, 1, 'L'], [2, 2, 1, 'S'], [3, 3, 1, 'G'], [4, 4, 1, 'M'], [5, 5, 1, 'H']]);
    round.addTargets([3, 20]);
    round.targets[1].hitAt = round.t - 100;
    round.step(1 / 60);
    fx.explode(4, 3, COLORS[0].main, COLORS[0].dark, 1.2);
    fx.muzzle(3, 3, 1, 1.5);
    fx.bounce(2, 2, 1, 0);
    fx.confetti(4, 2, 40);
    fx.popup('BANK SHOT', 4, 3, '#fff', 1.2);
    fx.ring(3, 3, 0.1, 1, 0.5, '#fff');
    fx.smoke(5, 3, 6);
    for (let i = 0; i < 40; i++) fx.mark(i * 0.1, 1, i * 0.1 + 0.1, 1.05);
    fx.update(0.1);
    const W = { round, fx, accent: '#ff7a1a', time: 12.3, meId: 'me', tags: true, youUntil: 14, guide: true, keys: true, crateSeen: new Map([[1, 12.2], [2, 5]]) };
    ctx.texts.length = 0;
    for (let f = 0; f < 3; f++) drawWorld(ctx, Sc, W);
    assert.equal(ctx.depth, 0);
    const chips = roster.map((e, i) => ({ c: e.c, score: i * 3, out: i === 1, me: i === 0, bot: Boolean(e.bot) }));
    for (const weapon of [null, { k: 'L', ammo: 1 }, { k: 'S', ammo: 1 }, { k: 'G', ammo: 7 }, { k: 'M', ammo: 1 }, { k: 'H', ammo: 1 }]) {
      ui.drawHud(ctx, Sc, { round: 7, goal: 10, chips, timeLeft: 8000, out: false, weapon, accent: '#12c2e9' });
    }
    ui.drawHud(ctx, Sc, { round: 7, goal: 10, chips, timeLeft: Infinity, out: true, weapon: null, accent: '#12c2e9' });
    ui.drawTitle(ctx, Sc, 3, { accent: '#ff7a1a', touch: false });
    ui.drawTitle(ctx, Sc, 3, { accent: '#ff7a1a', touch: true });
    ui.drawLobbyHud(ctx, Sc, { goal: 10, options: [5, 10, 15], isHost: true, hint: 'BANK SHOTS OFF WALLS', accent: '#12c2e9' });
    ui.drawLobbyHud(ctx, Sc, { goal: 5, options: [5, 10, 15], isHost: false, hint: 'BANK SHOTS OFF WALLS', accent: '#12c2e9' });
    ui.drawResultsCard(ctx, Sc, { top: [{ id: 'a', name: 'Ann', bot: false, color: '#f00', score: 10, me: true }, { id: 'bot1', name: 'Nova', bot: true, color: '#0f0', score: 7, me: false }], age: 1, life: 7 });
    for (const n of [3, 2, 1, 0]) ui.drawCountdown(ctx, Sc, n, 0.3);
    ui.drawCallout(ctx, Sc, 'ELIMINATED', 0.5);
    ui.drawBanner(ctx, Sc, { text: 'LAST TANK WINS', sub: 'ROUND 3', age: 0.1, dur: 1.8, accent: '#ff7a1a' });
    ui.drawBanner(ctx, Sc, { text: 'LAST TANK WINS', sub: 'ROUND 3', age: 1.0, dur: 1.8, accent: '#ff7a1a' });
    const rows = roster.map((e, i) => ({ id: e.id, c: e.c, name: e.bot ? e.n : e.id, bot: Boolean(e.bot), me: i === 0, score: 4 + i, pts: i === 2 ? 1 : 0 }));
    for (const age of [0, 0.5, 1.2, 2.4]) {
      ui.drawEnd(ctx, Sc, { rows, goal: 10, winName: 'Nova', winC: 2, draw: false, age, accent: '#ff7a1a' });
      ui.drawEnd(ctx, Sc, { rows, goal: 10, winName: '', winC: 0, draw: true, age, accent: '#ff7a1a' });
    }
    const top = rows.slice(0, 3).map((r) => ({ ...r, color: '#fff' }));
    for (const age of [0, 0.4, 1, 5]) {
      ui.drawPodium(ctx, Sc, { top, you: { label: '5th', score: 2 }, awards: { kills: { ...top[0], v: 7 }, bank: { ...top[1], v: 4 } }, age, win: false });
      ui.drawPodium(ctx, Sc, { top: top.slice(0, 2), you: null, awards: { kills: null, bank: null }, age, win: true });
    }
    ui.drawHud(ctx, Sc, { round: 2, goal: 5, chips, timeLeft: 30000, out: false, spectating: true, weapon: null, accent: '#12c2e9' });
    for (const k of 'LSGMH') drawWeaponIcon(ctx, k, 30, 30, 20, '#fff');
    assert.equal(ctx.depth, 0, 'every save() has its restore()');
  }
  assert.deepEqual(errors.map(String), []);
  assert.deepEqual(page.ctx.bad, []);
  for (const l of page.document.layers) assert.deepEqual(l.ctx.bad, []);
});
