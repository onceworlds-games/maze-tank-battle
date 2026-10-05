// A fake multiplayer room for the fake pages: several players share one room with a host, a match lifecycle, state, presence and
// messages that arrive after a delay (everything is copied through JSON, as it would be over the wire). Not the platform: just
// enough of the SDK's Room for the game's pages to talk to each other in node.

import { T } from './fakedom.mjs';
import { makeStubOw } from '../game/stub.js';

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const LATENCY = 45;

export class Hub {
  constructor() {
    this.players = new Map();
    this.rooms = new Map();
    this.host = null;
    this.settings = { goal: 5 };
    this.n = 0;
    this.match = { phase: 'lobby', n: 0, min: 1, id: '', seed: 1, participants: [] };
    this.seed = 1234567;
    this.sent = {};
  }

  add(id, name = id) {
    const record = { id, name, presence: null, team: 0 };
    this.players.set(id, record);
    const room = new FakeRoom(this, record);
    // a copy of the state so far
    const first = [...this.rooms.values()][0];
    if (first) room.state = clone(first.state);
    this.rooms.set(id, room);
    if (!this.host) this.host = id;
    for (const [rid, r] of this.rooms) if (rid !== id) r.emit('join', { ...record });
    return room;
  }

  /** The same player comes back on a fresh page (a reload): the old page's room is dead, the seat and presence are kept. */
  rejoin(id) {
    const record = this.players.get(id);
    const old = this.rooms.get(id);
    old.closed = true;
    old.connected = false;
    delete record.connected;
    const room = new FakeRoom(this, record);
    room.state = clone(old.state);
    // a reloaded page learns what the room has now: take the freshest copy from someone still here
    for (const [rid, r] of this.rooms) if (rid !== id && !r.closed) room.state = clone(r.state);
    this.rooms.set(id, room);
    for (const [rid, r] of this.rooms) if (rid !== id) r.emit('back', record, true);
    return room;
  }

  later(fn) {
    setTimeout(fn, LATENCY);
  }

  setHost(id) {
    // the room tells everyone in order: writes that came before arrive before this
    this.later(() => {
      this.host = id;
      for (const r of this.rooms.values()) r.emit('host', id);
    });
  }

  setMatch(match, previous) {
    this.match = match;
    for (const r of this.rooms.values()) r.emit('match', match, previous);
  }

  start() {
    this.n++;
    const previous = this.match;
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    const m = { phase: 'starting', n: this.n, min: 1, id: `m${this.n}`, seed: this.seed, participants: [...this.players.keys()], startsAt: T.ms + 3000 };
    for (const p of this.players.values()) delete p.ready;
    this.setMatch(m, previous);
    for (const r of this.rooms.values()) r.emit('starting', m);
  }

  tick() {
    const m = this.match;
    if (m.phase === 'starting' && T.ms >= m.startsAt) {
      const next = { ...m, phase: 'playing', startedAt: T.ms };
      this.setMatch(next, m);
      for (const r of this.rooms.values()) r.emit('matchstart', next);
    }
  }

  end() {
    const previous = this.match;
    if (previous.phase === 'lobby') return;
    for (const p of this.players.values()) delete p.ready;
    this.setMatch({ phase: 'lobby', n: this.n, min: 1 }, previous);
    for (const r of this.rooms.values()) r.emit('matchend', this.match, previous);
  }

  /** A player's connection drops (their seat is held) or comes back. */
  setAway(id, away) {
    const p = this.players.get(id);
    if (away) p.connected = false;
    else delete p.connected;
    for (const [rid, r] of this.rooms) if (rid !== id) r.emit(away ? 'away' : 'back', p, false);
  }

  remove(id) {
    const p = this.players.get(id);
    this.players.delete(id);
    this.rooms.delete(id);
    for (const r of this.rooms.values()) r.emit('leave', p, false);
    if (this.host === id) this.setHost([...this.players.keys()][0]);
  }
}

class FakeRoom {
  constructor(hub, me) {
    this.hub = hub;
    this.me = me;
    this.kind = 'private';
    this.hidden = null;
    this.connected = true;
    this.closed = false;
    this.state = {};
    this.listeners = new Map();
    this.samples = new Map();
    this.players = hub.players;
  }

  get host() {
    return this.hub.host;
  }
  get isHost() {
    return this.connected && this.hub.host === this.me.id;
  }
  get match() {
    return this.hub.match;
  }
  get online() {
    return [...this.players.values()].filter((p) => p.connected !== false);
  }
  get settings() {
    return this.hub.settings;
  }
  get participants() {
    return this.match.phase === 'lobby' ? [] : this.match.participants.map((id) => this.players.get(id)).filter(Boolean);
  }
  get spectating() {
    return this.match.phase !== 'lobby' && !this.match.participants.includes(this.me.id);
  }
  get running() {
    return this.match.phase === 'playing' && !this.match.paused;
  }
  get canStart() {
    return true;
  }
  isParticipant(id = this.me.id) {
    return this.match.phase !== 'lobby' && this.match.participants.includes(id);
  }
  matchNow() {
    const m = this.match;
    return m.phase === 'playing' ? Math.max(0, T.ms - m.startedAt) : 0;
  }
  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }
  emit(event, ...args) {
    for (const fn of this.listeners.get(event) ?? []) fn(...args);
  }
  setState(key, value) {
    if (this.closed) return;
    if (value === null || value === undefined) delete this.state[key];
    else this.state[key] = value;
    const copy = clone(value);
    for (const [id, r] of this.hub.rooms) {
      if (id === this.me.id) continue;
      this.hub.later(() => {
        if (copy === undefined || copy === null) delete r.state[key];
        else r.state[key] = clone(copy);
        r.emit('state', key, copy, this.me.id);
      });
    }
  }
  setPresence(d) {
    if (this.closed) return;
    this.me.presence = d;
    const at = T.ms;
    const copy = clone(d);
    for (const [id, r] of this.hub.rooms) {
      if (id === this.me.id) continue;
      this.hub.later(() => {
        const list = r.samples.get(this.me.id) ?? [];
        list.push({ at, d: clone(copy) });
        while (list.length > 8) list.shift();
        r.samples.set(this.me.id, list);
        const p = r.players.get(this.me.id);
        if (p) p.presence = copy;
      });
    }
  }
  presenceAt(id) {
    if (id === this.me.id) return this.me.presence;
    const list = this.samples.get(id);
    if (!list || !list.length) return this.players.get(id)?.presence ?? null;
    const target = T.ms - 100;
    let best = list[0];
    for (const s of list) if (s.at <= target) best = s;
    return best.d;
  }
  send(data, { to } = {}) {
    if (this.closed) return;
    this.hub.sent[data && data.t] = (this.hub.sent[data && data.t] || 0) + 1;
    const copy = clone(data);
    const from = { ...this.me };
    for (const [id, r] of this.hub.rooms) {
      if (id === this.me.id || (to && id !== to)) continue;
      this.hub.later(() => r.emit('message', clone(copy), from, T.ms, r.matchNow()));
    }
  }
  setReady(ready = true) {
    if (ready) this.me.ready = true;
    else delete this.me.ready;
  }
  setSetting(id, value) {
    if (!this.isHost || this.match.phase !== 'lobby') return;
    if (id === 'goal') this.hub.settings = { ...this.hub.settings, goal: value };
  }
  hideLobby(h = true) {
    this.hidden = h;
  }
  setOpen() {}
  endMatch() {
    if (this.isHost) this.hub.end();
  }
  startMatch() {
    if (this.isHost) this.hub.start();
  }
  clearReady() {}
  leave() {}
}

/** window.onceworlds for one page of the hub: the stand-in SDK, with this player's room. */
export function owFor(hub, id, name) {
  const ow = makeStubOw();
  const room = hub.players.has(id) ? hub.rejoin(id) : hub.add(id, name);
  ow.rooms = { async join() { return room; } };
  ow.player.get = async () => ({ id, name, guest: true });
  ow.room = room;
  return ow;
}
