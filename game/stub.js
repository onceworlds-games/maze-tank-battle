// A stand-in for the platform when the page is opened on its own (no window.onceworlds): a room with one player, who is the
// host, that runs the lobby -> countdown -> match -> lobby cycle by itself so the game can be seen and tested. It only needs
// a clock. Nothing here touches the page at import time.

const GOALS = [5, 10, 15];

export function makeStubRoom(clock = Date.now) {
  const listeners = new Map();
  const me = { id: 'me', name: 'You', presence: null, team: 0 };
  let goal = 10;
  let autoStart = 0;
  let n = 0;

  const room = {
    kind: 'solo',
    me,
    players: new Map([['me', me]]),
    host: 'me',
    connected: true,
    closed: false,
    state: {},
    match: { phase: 'lobby', n: 0, min: 1, id: '', seed: 1, participants: [] },
    get isHost() {
      return true;
    },
    get online() {
      return [...this.players.values()];
    },
    get settings() {
      return { goal };
    },
    get participants() {
      return this.match.phase === 'lobby' ? [] : this.match.participants.map((id) => this.players.get(id)).filter(Boolean);
    },
    get spectating() {
      return false;
    },
    get running() {
      return this.match.phase === 'playing' && !this.match.paused;
    },
    isParticipant(id = me.id) {
      return this.match.phase !== 'lobby' && this.match.participants.includes(id);
    },
    matchNow() {
      const m = this.match;
      return m.phase === 'playing' && m.startedAt !== undefined ? Math.max(0, clock() - m.startedAt) : 0;
    },
    on(event, fn) {
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(fn);
      return () => set.delete(fn);
    },
    emit(event, ...args) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
    setState(key, value) {
      if (value === null || value === undefined) delete this.state[key];
      else this.state[key] = value;
    },
    setPresence(d) {
      me.presence = d;
    },
    presenceAt(id) {
      return id === me.id ? me.presence : null;
    },
    send() {},
    hideLobby() {},
    setReady(ready = true) {
      if (Boolean(me.ready) === ready) return;
      if (ready) me.ready = true;
      else delete me.ready;
      this.emit('ready', me);
      autoStart = ready && this.match.phase === 'lobby' ? clock() + 1500 : 0;
    },
    setSetting(id, value) {
      if (id !== 'goal' || !GOALS.includes(value) || this.match.phase !== 'lobby') return;
      goal = value;
      this.emit('settings', { goal });
    },
    startMatch() {
      if (this.match.phase !== 'lobby') return;
      n++;
      delete me.ready;
      const previous = this.match;
      this.match = { phase: 'starting', n, min: 1, id: `stub${n}`, seed: (Math.floor(clock()) ^ (n * 2654435761)) >>> 0, participants: ['me'], startsAt: clock() + 3000 };
      this.emit('match', this.match, previous);
      this.emit('starting', this.match);
    },
    endMatch() {
      const previous = this.match;
      if (previous.phase === 'lobby') return;
      this.match = { phase: 'lobby', n, min: 1 };
      this.emit('match', this.match, previous);
      this.emit('matchend', this.match, previous);
      autoStart = clock() + 5000; // the next one starts by itself, so the cycle can be watched
    },
    clearReady() {},
    leave() {},
    /** Called every frame by the game when it runs on this stub. */
    tick() {
      const m = this.match;
      const now = clock();
      if (m.phase === 'lobby' && autoStart && now >= autoStart) {
        autoStart = 0;
        this.startMatch();
      } else if (m.phase === 'starting' && now >= m.startsAt) {
        const previous = m;
        this.match = { ...m, phase: 'playing', startedAt: now };
        this.emit('match', this.match, previous);
        this.emit('matchstart', this.match);
      }
    },
  };
  return room;
}

export function makeStubOw(clock = Date.now) {
  const store = new Map();
  const room = makeStubRoom(clock);
  return {
    mode: 'stub',
    now: clock,
    room,
    ui: { setOrientation() {}, showInvite() {}, setMenuPosition() {} },
    settings: {
      quality: 'high',
      scale: 1,
      reducedMotion: false,
      choice: 'auto',
      pixelRatio: (max = 2) => Math.min((typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1, max),
      on() {},
    },
    controls: { stick: { x: 0, y: 0 }, touch: false, set() {}, pressed: () => false },
    player: {
      async get() {
        return { id: 'me', name: 'You', guest: true };
      },
      async avatarUrl() {
        return null;
      },
    },
    save: {
      async get(k) {
        return store.has(k) ? store.get(k) : null;
      },
      async set(k, v) {
        store.set(k, v);
      },
    },
    badges: {
      async award() {
        return false;
      },
    },
    leaderboards: {
      async submit() {
        return null;
      },
    },
    rooms: {
      async join() {
        return room;
      },
    },
    on() {},
  };
}
