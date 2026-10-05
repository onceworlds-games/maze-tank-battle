// Runs the real main.js (draw.js, ui.js, net.js, ...) on a fake page, on the stand-in room, through the title, the lobby and a
// whole match with a person who drives and fires. Fails on any exception, any NaN handed to the canvas, or a phase that never ends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errors, frames, frame, makePage, audioStats } from './fakedom.mjs';
import { makeStubOw } from '../game/stub.js';

test('title, lobby and a whole match on one page', async () => {
  const ow = makeStubOw();
  const room = ow.room;
  const page = makePage({ w: 812, h: 375, onceworlds: ow });
  page.install();
  await import('../game/main.js');
  assert.deepEqual(errors, []);
  frames(90); // the title
  assert.ok(page.ctx.counts.calls > 800, 'the title drew something');
  assert.deepEqual(page.ctx.bad, []);
  assert.ok(page.document.layers.length >= 2, 'the board was drawn into layers');
  page.key('Space'); // PLAY
  frames(10);
  assert.equal(audioStats.contexts, 1, 'sound started from the tap');
  // drive and fire in the lobby (practice)
  page.key('KeyW');
  page.key('KeyD');
  frames(60);
  page.key('KeyD', false);
  for (let i = 0; i < 6; i++) {
    page.key('Space');
    frames(14);
    page.key('Space', false);
  }
  frames(60);
  assert.equal(room.match.phase, 'lobby');
  // tap the 5 in "first to": the host changes the setting
  frames(2);
  const ui = await import('../game/ui.js');
  const five = ui.rects.goal.find((r) => r.v === 5);
  assert.ok(five, 'the goal buttons are there for the host');
  page.tap(five.x + 5, five.y + 5);
  frames(3);
  assert.equal(room.settings.goal, 5);
  assert.deepEqual(errors, []);
  assert.deepEqual(page.ctx.bad, [], 'nothing odd was handed to the canvas in the lobby');
  room.setReady(true); // the platform's Ready strip
  const seen = [];
  let wasPlaying = false;
  let n = 0;
  for (; n < 60 * 1500; n++) {
    // a person who drives, turns about and fires
    if (n % 70 === 0) page.key('KeyA', false), page.key('KeyD', true);
    if (n % 70 === 35) page.key('KeyD', false), page.key('KeyA', true);
    if (n % 55 === 0) page.key('Space', true);
    if (n % 55 === 6) page.key('Space', false);
    frame();
    const g = room.state.g;
    if (room.match.phase === 'playing' && g && g.mid === room.match.id) {
      wasPlaying = true;
      const key = `${g.phase}`;
      if (!seen.includes(key)) seen.push(key);
    }
    if (wasPlaying && room.match.phase === 'lobby') break;
  }
  assert.deepEqual(errors.map(String), []);
  assert.deepEqual(page.ctx.bad, [], 'nothing odd was handed to the canvas in the match');
  assert.ok(wasPlaying, 'the match started');
  assert.equal(room.match.phase, 'lobby', `the match ended itself (after ${n} frames)`);
  assert.deepEqual(seen, ['intro', 'play', 'end', 'final']);
  const g = room.state.g;
  assert.ok(Math.max(...Object.values(g.scores)) >= 5, 'someone reached the goal');
  console.log(`  ${g.round} rounds, scores ${JSON.stringify(g.scores)}, ${page.ctx.counts.calls} canvas calls`);
  frames(60 * 8); // the lobby again, with the results card
  assert.deepEqual(errors.map(String), []);
  assert.deepEqual(page.ctx.bad, []);
});
