// Layout lint of the busiest versions of every screen (eight players, every award, a power-up in hand, a watcher's strip), at
// several window sizes: text inside the screen, clear of the platform's buttons (top left), not on top of other text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errors, makePage } from './fakedom.mjs';

const SIZES = [
  [812, 375],
  [568, 320],
  [667, 375],
  [1280, 720],
  [1024, 768],
  [375, 667],
  [390, 844],
];

const box = (t) => {
  const w = t.width / 2;
  const h = t.size / 2;
  const x = t.x / 2;
  const y = t.y / 2;
  const left = t.align === 'left' || t.align === 'start' ? x : t.align === 'right' || t.align === 'end' ? x - w : x - w / 2;
  return { l: left, r: left + w, t: y - h / 2, b: y + h / 2, text: t.text, size: h };
};
const hit = (a, b, pad = 0) => a.l < b.r - pad && b.l < a.r - pad && a.t < b.b - pad && b.t < a.b - pad;

test('the busiest screens fit at every size', async () => {
  const page = makePage({ w: 812, h: 375 });
  page.install();
  const ui = await import('../game/ui.js');
  const { buildRoster } = await import('../game/rules.js');
  const names = ['Ann', 'Bartholomew', 'Cleo', 'Dmitri', 'Eve', 'Frank', 'Gwen', 'Hiroshi'];
  const roster = buildRoster(names.map((n) => `id-${n}`), 3);
  const rows = roster.map((e, i) => ({ id: e.id, c: e.c, name: names[i] || 'Nova', bot: false, me: i === 3, score: 9 - i, pts: i === 0 ? 1 : 0 }));
  const chips = roster.map((e, i) => ({ c: e.c, score: 10 - i, out: i % 3 === 1, me: i === 3, bot: false }));
  const top = rows.slice(0, 3).map((r) => ({ ...r, color: '#fff' }));
  for (const [w, h] of SIZES) {
    const Sc = { w, h, pr: 2, u: Math.max(0.8, Math.min(1.9, Math.min(w, h) / 430)), scale: 50, ox: 0, oy: 0, shx: 0, shy: 0, time: 3.3, q: 1, reduced: false };
    const screens = {
      title: () => ui.drawTitle(page.ctx, Sc, 2, { accent: '#ff7a1a', touch: false }),
      lobby: () => ui.drawLobbyHud(page.ctx, Sc, { goal: 10, options: [5, 10, 15], isHost: true, hint: 'BANK SHOTS OFF WALLS', accent: '#12c2e9' }),
      hud: () => ui.drawHud(page.ctx, Sc, { round: 88, goal: 15, chips, timeLeft: 7000, out: false, weapon: { k: 'G', ammo: 20 }, accent: '#ff7a1a' }),
      hudOut: () => ui.drawHud(page.ctx, Sc, { round: 88, goal: 15, chips, timeLeft: 70000, out: true, weapon: null, accent: '#ff7a1a' }),
      watcher: () => ui.drawHud(page.ctx, Sc, { round: 8, goal: 15, chips, timeLeft: 70000, out: false, spectating: true, weapon: null, accent: '#ff7a1a' }),
      banner: () => ui.drawBanner(page.ctx, Sc, { text: 'LAST TANK WINS', sub: 'ROUND 88', age: 1, dur: 1.8, accent: '#ff7a1a' }),
      end: () => ui.drawEnd(page.ctx, Sc, { rows, goal: 10, winName: 'Bartholomew', winC: 1, draw: false, age: 2, accent: '#ff7a1a' }),
      podium: () =>
        ui.drawPodium(page.ctx, Sc, { top, you: { label: '12th', score: 2 }, awards: { kills: { ...top[0], v: 27 }, bank: { ...top[1], v: 6 } }, age: 5, win: false }),
      card: () => ui.drawResultsCard(page.ctx, Sc, { top: top.map((t) => ({ ...t, name: 'Bartholomew' })), age: 1, life: 7 }),
      callout: () => ui.drawCallout(page.ctx, Sc, 'ELIMINATED', 0.6),
      count: () => ui.drawCountdown(page.ctx, Sc, 3, 0.2),
    };
    for (const [name, draw] of Object.entries(screens)) {
      page.ctx.texts.length = 0;
      draw();
      assert.equal(page.ctx.depth, 0, `${name}: save/restore`);
      const boxes = page.ctx.texts.filter((t) => t.alpha > 0.5).map(box);
      assert.ok(boxes.length > 0, `${name} has text`);
      for (const b of boxes) {
        assert.ok(b.l > -2 && b.t > -2 && b.r < w + 2 && b.b < h + 2, `${w}x${h} ${name}: "${b.text}" is off the screen (${b.l.toFixed(0)},${b.t.toFixed(0)} to ${b.r.toFixed(0)},${b.b.toFixed(0)})`);
        if (name !== 'title' && name !== 'banner' && name !== 'callout' && name !== 'count' && name !== 'end' && name !== 'podium' && name !== 'card') assert.ok(!hit(b, { l: 0, t: 0, r: 130, b: 56 }, 1), `${w}x${h} ${name}: "${b.text}" is over the platform's buttons`);
        assert.ok(b.size >= 11, `${w}x${h} ${name}: "${b.text}" is ${b.size.toFixed(1)} px`);
      }
      const big = boxes.filter((b) => b.size >= 12 && b.text.length > 1);
      for (let i = 0; i < big.length; i++) {
        for (let j = i + 1; j < big.length; j++) {
          if (big[i].text === big[j].text) continue;
          assert.ok(!hit(big[i], big[j], 3), `${w}x${h} ${name}: "${big[i].text}" overlaps "${big[j].text}"`);
        }
      }
    }
  }
  assert.deepEqual(errors.map(String), []);
  assert.deepEqual(page.ctx.bad, []);
});
