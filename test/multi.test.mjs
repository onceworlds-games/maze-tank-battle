// Several fake pages in one fake room (see hub.mjs), running the real game code: two people and, later, a late joiner who
// watches. They play whole matches against bots: shots and deaths travel between the pages, the host changes hands in the
// middle of a round, a page reloads mid-round, a page that goes away is judged as standing still and one that leaves doesn't
// stall anything. Everyone ends in the lobby having seen the same match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errors, frame, makePage } from './fakedom.mjs';
import { Hub, owFor } from './hub.mjs';

async function boot(hub, id, tag) {
  const ow = owFor(hub, id, id);
  const page = makePage({ w: 812, h: 375, onceworlds: ow });
  const held = { api: null };
  page.window.__tankTest = (api) => (held.api = api);
  page.install();
  await import(`../game/main.js?page=${tag}`);
  return { ow, room: ow.room, page, id, get api() { return held.api; } };
}

function assertClean(pages, label) {
  assert.deepEqual(errors.map(String), [], `${label}: no exceptions`);
  for (const p of pages) assert.deepEqual(p.page.ctx.bad, [], `${label}: nothing odd handed to ${p.id}'s canvas`);
}

const step = (hub) => {
  hub.tick();
  frame();
};

/** Roughly what a person does: tap about, turn, fire. */
function play(p, n) {
  p.page.install();
  if (n % 60 === 0) p.page.key('KeyW', true);
  if (n % 90 === 0) p.page.key('KeyA', false), p.page.key('KeyD', true);
  if (n % 90 === 45) p.page.key('KeyD', false), p.page.key('KeyA', true);
  if (n % 50 === 0) p.page.key('Space', true);
  if (n % 50 === 5) p.page.key('Space', false);
}

function alivesAgree(pages, g) {
  let bad = 0;
  for (const p of pages) {
    const round = p.api.S.round;
    if (!round || p.api.S.scene !== 'match') continue;
    for (const e of g.roster) {
      const k = round.byId.get(e.id);
      if (k && k.alive === Boolean(g.out[e.id])) bad++;
    }
  }
  return bad;
}

test('two people and a late watcher play a match; the host changes mid-round', async () => {
  const hub = new Hub();
  const A = await boot(hub, 'alice', 'a');
  const B = await boot(hub, 'bob', 'b');
  const pages = [A, B];
  for (let i = 0; i < 60; i++) step(hub);
  for (const p of pages) {
    p.page.install();
    p.page.key('Space');
  }
  for (let i = 0; i < 60; i++) step(hub);
  // both drive and fire about the lobby: each sees the other's tank and shots
  for (let i = 0; i < 240; i++) {
    for (const p of pages) play(p, i);
    step(hub);
  }
  assertClean(pages, 'lobby');
  assert.ok(B.room.presenceAt('alice'), 'bob sees alice');
  assert.ok(A.room.presenceAt('bob'), 'alice sees bob');
  assert.ok(A.api.S.lobby.byId.has('bob'), 'alice has bob in her lobby');
  assert.ok(B.api.S.lobby.byId.has('alice'), 'bob has alice in his lobby');
  assert.ok(hub.sent.fire >= 2, `practice shots are sent too (${hub.sent.fire})`);
  assert.ok([...B.api.S.lobby.fired].some((k) => k.startsWith('alice.')), "bob's lobby took in alice's practice shot");

  hub.start();
  let hostSwitched = false;
  let C = null;
  let wasPlaying = false;
  let mismatches = 0;
  let checks = 0;
  const seen = new Set();
  const dead = new Set();
  let frameN = 0;
  const endAt = new Map();
  for (; frameN < 60 * 1200; frameN++) {
    const g = (hostSwitched ? B : A).room.state.g;
    const playing = hub.match.phase === 'playing' && g && g.mid === hub.match.id;
    if (playing) wasPlaying = true;
    if (playing && g.phase === 'play' && g.round === 2 && !hostSwitched) {
      hostSwitched = true;
      hub.setHost('bob');
    }
    if (playing && g.phase === 'play' && g.round === 3 && !C) {
      C = await boot(hub, 'cara', 'c');
      C.page.install();
      C.page.key('Space');
      pages.push(C);
    }
    if (playing) for (const p of pages.slice(0, 2)) play(p, frameN);
    step(hub);
    const gg = (hostSwitched ? B : A).room.state.g;
    if (gg && gg.mid === hub.match.id) {
      seen.add(`${gg.round}:${gg.phase}`);
      for (const id of Object.keys(gg.out)) dead.add(`${gg.round}:${id}`);
      if (gg.phase === 'end') {
        // a second into the points bar, every page agrees on who is out
        if (!endAt.has(gg.rid)) endAt.set(gg.rid, frameN);
        if (frameN - endAt.get(gg.rid) === 60) {
          checks++;
          mismatches += alivesAgree(pages, gg) ? 1 : 0;
        }
      }
    }
    if (wasPlaying && hub.match.phase === 'lobby') break;
  }
  assertClean(pages, 'match');
  assert.equal(hub.match.phase, 'lobby', `the match ended (frame ${frameN})`);
  assert.ok(hostSwitched);
  const finals = [...seen].filter((p) => p.endsWith(':final'));
  assert.equal(finals.length, 1, `reached the podium: ${[...seen].join(' ')}`);
  assert.ok(hub.sent.fire > 20, `shots were sent (${hub.sent.fire})`);
  assert.ok(hub.sent.dead > 3, `deaths were told (${hub.sent.dead})`);
  assert.ok(checks >= 3 && mismatches <= Math.max(1, checks * 0.15), `${mismatches} of ${checks} rounds ended with pages disagreeing about who was out`);
  // the new host wrote the record, the pages agree on the match
  const ga = A.room.state.g;
  const gb = B.room.state.g;
  assert.equal(ga.mid, gb.mid);
  assert.equal(gb.by, 'bob', 'bob kept the book after taking it over');
  assert.deepEqual(ga.scores, gb.scores);
  assert.ok(Math.max(...Object.values(ga.scores)) >= 5, 'someone got to 5');
  // the late joiner watched
  assert.equal(C.api.S.iAmIn, false);
  for (let i = 0; i < 60 * 8; i++) step(hub);
  assertClean(pages, 'back in the lobby');
  console.log(`  ${ga.round} rounds; scores ${JSON.stringify(ga.scores)}; messages ${JSON.stringify(hub.sent)}; ${mismatches}/${checks} disagreements`);
});

test('a page that reloads mid-round carries on; one that goes away stands still; one that leaves never stalls the round', async () => {
  const hub = new Hub();
  let A = await boot(hub, 'dan', 'd');
  let B = await boot(hub, 'eve', 'e');
  for (const p of [A, B]) {
    p.page.install();
    p.page.key('Space');
  }
  for (let i = 0; i < 120; i++) step(hub);
  hub.start();
  let reloaded = false;
  let awayDone = false;
  let left = false;
  let wasPlaying = false;
  let before = null;
  let frameN = 0;
  for (; frameN < 60 * 1200; frameN++) {
    const g = A.room.state.g;
    const playing = hub.match.phase === 'playing' && g && g.mid === hub.match.id;
    if (playing) wasPlaying = true;
    if (playing && g.phase === 'play' && g.round === 2 && !reloaded && A.room.matchNow() - g.t0 > 3000) {
      // eve reloads: a fresh page, the same seat
      reloaded = true;
      const k = B.api.S.myTank;
      before = k ? { x: k.x, y: k.y, alive: k.alive } : null;
      B.page.dead = true;
      B = await boot(hub, 'eve', 'e2');
      assert.equal(B.api.S.started, false);
    }
    if (playing && g.phase === 'play' && g.round === 4 && !awayDone) {
      // eve's page goes away: the seat is held, the host decides about the tank that stands there
      awayDone = true;
      B.page.dead = true;
      hub.setAway('eve', true);
    }
    if (playing && g.phase === 'play' && g.round === 6 && !left) {
      left = true;
      hub.remove('eve');
    }
    if (playing) {
      if (!B.page.dead) play(B, frameN);
      play(A, frameN);
    }
    step(hub);
    if (reloaded && B.api && B.api.S.round && before && B.api.S.scene === 'match' && B.api.S.myTank && !B.page.dead) {
      // the reloaded page is in the round again, from where the room last had it (or the start spot): never off the board
      const k = B.api.S.myTank;
      assert.ok(Number.isFinite(k.x) && k.x > 0 && k.x < 9 && k.y > 0 && k.y < 6);
    }
    if (wasPlaying && hub.match.phase === 'lobby') break;
  }
  assert.deepEqual(errors.map(String), []);
  assert.deepEqual(A.page.ctx.bad, []);
  assert.deepEqual(B.page.ctx.bad, []);
  assert.ok(reloaded && awayDone && left, `the scenario ran (reloaded ${reloaded}, away ${awayDone}, left ${left})`);
  assert.equal(hub.match.phase, 'lobby', `the match ended (frame ${frameN}) with a player gone`);
  assert.ok(A.room.state.g.round >= 6);
});
