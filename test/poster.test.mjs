// Every store picture draws with the game's own renderer, at its exact size, with no SDK and nothing odd handed to the canvas,
// and says it is on screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errors, makePage } from './fakedom.mjs';

const WANT = {
  cover: [1280, 720],
  action: [1280, 720],
  win: [1280, 720],
  icon: [512, 512],
  'badge-first-win': [256, 256],
  'badge-bank-shot': [256, 256],
  'badge-oops': [256, 256],
  'badge-ace': [256, 256],
};

for (const [name, [w, h]] of Object.entries(WANT)) {
  test(`poster ${name}: ${w} x ${h}, drawn, ready`, async () => {
    const page = makePage({ w: 1280, h: 720, search: `?poster=${name}` }); // (no onceworlds on the page)
    page.install();
    await import(`../game/main.js?poster=${name}`);
    assert.deepEqual(errors.map(String), []);
    assert.equal(page.canvas.width, w);
    assert.equal(page.canvas.height, h);
    assert.equal(page.document.body.dataset.ready, '1');
    assert.deepEqual(page.ctx.bad, []);
    assert.ok(page.ctx.counts.calls > (name.startsWith('badge') ? 15 : 60), `drew ${page.ctx.counts.calls} things`);
    for (const l of page.document.layers) assert.deepEqual(l.ctx.bad, []);
  });
}
