// Layout lint: at several screen sizes, every screen of a match is sampled and its text is checked: inside the screen, clear of the
// platform's buttons (top left 130x56), not on top of other text. Text positions come from the fake canvas's transform tracking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errors, frame, makePage } from './fakedom.mjs';
import { makeStubOw } from '../game/stub.js';
import { BOT_NAMES, WEAPON } from '../game/rules.js';

const SIZES = [
  [812, 375],
  [667, 375],
  [568, 320],
  [844, 390],
  [1280, 720],
  [1024, 768],
  [375, 667],
  [390, 844],
];
const NAMES = new Set([...BOT_NAMES, 'You', 'YOU', 'BANK SHOT', '+1', ...Object.values(WEAPON).map((w) => w.name)]);

const box = (t, pr) => {
  const w = t.width / pr;
  const h = t.size / pr;
  const x = t.x / pr;
  const y = t.y / pr;
  const left = t.align === 'left' || t.align === 'start' ? x : t.align === 'right' || t.align === 'end' ? x - w : x - w / 2;
  return { l: left, r: left + w, t: y - h / 2, b: y + h / 2, text: t.text, size: h };
};
const hit = (a, b, pad = 0) => a.l < b.r - pad && b.l < a.r - pad && a.t < b.b - pad && b.t < a.b - pad;

async function run(w, h, tag) {
  const ow = makeStubOw();
  const room = ow.room;
  const page = makePage({ w, h, onceworlds: ow });
  page.install();
  await import(`../game/main.js?layout=${tag}`);
  const samples = [];
  const take = (label) => {
    page.ctx.texts.length = 0;
    frame();
    assert.equal(page.ctx.depth, 0, `${label}: every save() has its restore()`);
    samples.push({ label, boxes: page.ctx.texts.filter((t) => t.alpha > 0.5 && !NAMES.has(t.text)).map((t) => box(t, 2)) });
  };
  for (let i = 0; i < 40; i++) frame();
  take('title');
  page.key('Space');
  for (let i = 0; i < 40; i++) frame();
  take('lobby');
  room.setSetting('goal', 5);
  room.setReady(true);
  const done = new Set();
  let n = 0;
  while (n++ < 60 * 1500) {
    // a person who drives about and fires
    if (n % 70 === 0) page.key('KeyA', false), page.key('KeyD', true);
    if (n % 70 === 35) page.key('KeyD', false), page.key('KeyA', true);
    if (n % 55 === 0) page.key('Space', true);
    if (n % 55 === 6) page.key('Space', false);
    frame();
    const g = room.state.g;
    if (room.match.phase === 'starting' && !done.has('count')) {
      const left = room.match.startsAt - Date.now();
      if (left < 2300 && left > 2100) {
        done.add('count');
        take('countdown');
      }
    }
    if (room.match.phase === 'playing' && g && g.mid === room.match.id) {
      const tp = room.matchNow() - g.t0;
      if (g.phase === 'intro' && !done.has('intro') && room.matchNow() > 700) (done.add('intro'), take('intro'));
      if (g.phase === 'play' && !done.has('go') && tp > 100 && tp < 400) (done.add('go'), take('go'));
      if (g.phase === 'play' && !done.has('play') && tp > 1500) (done.add('play'), take('play'));
      if (g.phase === 'end' && !done.has('end') && room.matchNow() > g.until - 1500) (done.add('end'), take('end'));
      if (g.phase === 'final' && !done.has('final') && room.matchNow() > g.until - 3500) (done.add('final'), take('final'));
    }
    if (done.has('final') && room.match.phase === 'lobby') {
      for (let i = 0; i < 60; i++) frame();
      take('results card');
      break;
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(page.ctx.bad, []);
  return samples;
}

for (const [w, h] of SIZES) {
  test(`every screen's text fits at ${w}x${h}`, async () => {
    const samples = await run(w, h, `${w}x${h}`);
    const labels = samples.map((s) => s.label);
    for (const need of ['title', 'lobby', 'countdown', 'intro', 'go', 'play', 'end', 'final', 'results card']) assert.ok(labels.includes(need), `sampled ${need} (${labels.join(', ')})`);
    for (const s of samples) {
      assert.ok(s.boxes.length > 0, `${s.label} has text`);
      for (const b of s.boxes) {
        assert.ok(b.l > -2 && b.t > -2 && b.r < w + 2 && b.b < h + 2, `${w}x${h} ${s.label}: "${b.text}" is off the screen (${b.l.toFixed(0)},${b.t.toFixed(0)} to ${b.r.toFixed(0)},${b.b.toFixed(0)})`);
        assert.ok(!hit(b, { l: 0, t: 0, r: 130, b: 56 }, 1), `${w}x${h} ${s.label}: "${b.text}" is over the platform's buttons`);
        assert.ok(b.size >= 11, `${w}x${h} ${s.label}: "${b.text}" is only ${b.size.toFixed(1)} px tall`);
      }
      // text that is not part of the scene must not sit on other text (letters of the logo are drawn one by one and touch)
      if (['final', 'intro', 'go', 'end', 'countdown', 'play', 'lobby', 'results card'].includes(s.label)) {
        const boxes = s.boxes.filter((b) => b.size >= 12 && b.text.length > 1);
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            if (boxes[i].text === boxes[j].text) continue; // a shadowed word is drawn twice
            assert.ok(!hit(boxes[i], boxes[j], 3), `${w}x${h} ${s.label}: "${boxes[i].text}" overlaps "${boxes[j].text}"`);
          }
        }
      }
      // the platform's Ready strip sits along the bottom of the lobby
      if (s.label === 'lobby') for (const b of s.boxes) assert.ok(b.b < h - 56, `${w}x${h} lobby: "${b.text}" is in the strip at the bottom`);
    }
  });
}
