// A fake page for running the game's browser code in node: a canvas whose context records bad calls (NaN arguments,
// negative radii that a real browser throws on), requestAnimationFrame / timers driven by a virtual clock, key and pointer
// events, and a fake Web Audio. Not a browser: it only lets main.js, draw.js, ui.js and the rest run through whole matches.

export const T = { ms: 5_000_000 };
const T0 = T.ms;

Date.now = () => T.ms;
Object.defineProperty(globalThis.performance, 'now', { value: () => T.ms - T0, configurable: true });

const timers = [];
let timerId = 1;
let current = null; // the page whose globals are installed: callbacks registered now belong to it
globalThis.setTimeout = (fn, ms = 0) => {
  const id = timerId++;
  timers.push({ id, fn, at: T.ms + ms, every: 0, page: current });
  return id;
};
globalThis.clearTimeout = (id) => {
  const i = timers.findIndex((t) => t.id === id);
  if (i >= 0) timers.splice(i, 1);
};
globalThis.setInterval = (fn, ms = 0) => {
  const id = timerId++;
  timers.push({ id, fn, at: T.ms + ms, every: Math.max(1, ms), page: current });
  return id;
};
globalThis.clearInterval = globalThis.clearTimeout;

const rafs = [];
globalThis.requestAnimationFrame = (cb) => {
  rafs.push({ cb, page: current });
  return rafs.length;
};

export const errors = [];

/** Advance the virtual clock one frame (1/60 s): due timers fire, then every requestAnimationFrame callback. */
export function frame(ms = 1000 / 60) {
  T.ms += ms;
  for (let guard = 0; guard < 1000; guard++) {
    const due = timers.filter((t) => t.at <= T.ms).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    if (due.every) due.at += due.every;
    else timers.splice(timers.indexOf(due), 1);
    if (due.page && due.page.dead) {
      if (due.every) timers.splice(timers.indexOf(due), 1);
      continue;
    }
    const keep = current;
    current = due.page;
    try {
      due.fn();
    } catch (e) {
      errors.push(e);
    }
    current = keep;
  }
  const cbs = rafs.splice(0);
  for (const { cb, page } of cbs) {
    if (page && page.dead) continue; // a page that was closed (reloaded) stops running
    const keep = current;
    current = page;
    try {
      cb(T.ms - T0);
    } catch (e) {
      errors.push(e);
    }
    current = keep;
  }
}

export function frames(n) {
  for (let i = 0; i < n; i++) frame();
}

// ---------------------------------------------------------------- a canvas context that checks what it is asked to do
const DEFAULTS = {
  globalAlpha: 1,
  lineWidth: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  miterLimit: 10,
  textAlign: 'start',
  textBaseline: 'alphabetic',
  lineDashOffset: 0,
  font: '10px sans-serif',
  fillStyle: '#000',
  strokeStyle: '#000',
  shadowBlur: 0,
  globalCompositeOperation: 'source-over',
};

export function makeCtx(label = 'ctx') {
  const state = { ...DEFAULTS };
  const bad = [];
  const counts = { calls: 0 };
  const texts = []; // every fillText of the frame, with where it landed on the screen (css px, from the transform)
  const grad = { addColorStop() {} };
  const note = (what) => {
    if (bad.length < 20) bad.push(what);
  };
  let m = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? 10);
  const methods = {
    measureText: (str) => ({ width: String(str).length * px() * 0.68 }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    getLineDash: () => [],
    isPointInPath: () => false,
    drawImage: () => {},
    save: () => {
      stack.push(m.slice());
      counts.calls++;
    },
    restore: () => {
      if (stack.length) m = stack.pop();
      counts.calls++;
    },
    setTransform: (a, b, c, d, e, f) => {
      m = [a, b, c, d, e, f];
      for (const v of [a, b, c, d, e, f]) if (!Number.isFinite(v)) note(`${label}.setTransform has ${v}`);
    },
    resetTransform: () => {
      m = [1, 0, 0, 1, 0, 0];
    },
    translate: (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) note(`${label}.translate(${x}, ${y})`);
      m = mul(m, [1, 0, 0, 1, x, y]);
    },
    scale: (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) note(`${label}.scale(${x}, ${y})`);
      m = mul(m, [x, 0, 0, y, 0, 0]);
    },
    rotate: (a) => {
      if (!Number.isFinite(a)) note(`${label}.rotate(${a})`);
      m = mul(m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]);
    },
    fillText: (str, x, y) => {
      counts.calls++;
      if (typeof str !== 'string' && typeof str !== 'number') note(`${label}.fillText of a non-string`);
      if (!Number.isFinite(x) || !Number.isFinite(y)) note(`${label}.fillText at (${x}, ${y})`);
      const k = Math.hypot(m[0], m[1]);
      texts.push({ text: String(str), x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5], size: px() * k, width: String(str).length * px() * 0.68 * k, align: state.textAlign, alpha: state.globalAlpha });
    },
  };
  const proxy = new Proxy(
    {},
    {
      get(_, p) {
        if (p === 'bad') return bad;
        if (p === 'counts') return counts;
        if (p === 'texts') return texts;
        if (p === 'depth') return stack.length;
        if (p in methods) return methods[p];
        if (p in state) return state[p];
        return (...args) => {
          counts.calls++;
          for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) note(`${label}.${String(p)}(${args.join(', ')})`);
          if (p === 'arc' && args[2] < 0) throw new Error(`${label}.arc with a negative radius: ${args.join(', ')}`);
          if (p === 'ellipse' && (args[2] < 0 || args[3] < 0)) throw new Error(`${label}.ellipse with a negative radius: ${args.join(', ')}`);
          if (p === 'arcTo' && args[4] < 0) throw new Error(`${label}.arcTo with a negative radius: ${args.join(', ')}`);
        };
      },
      set(_, p, v) {
        if (typeof v === 'number' && !Number.isFinite(v)) note(`${label}.${String(p)} = ${v}`);
        if (p === 'fillStyle' || p === 'strokeStyle') {
          if (typeof v === 'string' && /NaN|undefined|Infinity/.test(v)) note(`${label}.${String(p)} = ${v}`);
        }
        if (p === 'font' && /NaN|undefined/.test(String(v))) note(`${label}.font = ${v}`);
        state[p] = v;
        return true;
      },
    },
  );
  return proxy;
}

// ---------------------------------------------------------------- fake Web Audio
const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
export const audioStats = { contexts: 0, notes: 0 };
class FakeAudioContext {
  constructor() {
    audioStats.contexts++;
    this.state = 'running';
    this.sampleRate = 8000;
    this.destination = {};
  }
  get currentTime() {
    return (T.ms - T0) / 1000;
  }
  createGain() {
    return { gain: param(), connect() {} };
  }
  createOscillator() {
    audioStats.notes++;
    return { type: '', frequency: param(), connect() {}, start() {}, stop() {} };
  }
  createBiquadFilter() {
    return { type: '', Q: { value: 0 }, frequency: param(), connect() {} };
  }
  createBufferSource() {
    return { buffer: null, connect() {}, start() {} };
  }
  createBuffer(_c, len) {
    return { getChannelData: () => new Float32Array(len) };
  }
  resume() {
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------- one page
export function makePage({ w = 812, h = 375, search = '', onceworlds } = {}) {
  const ctx = makeCtx('page');
  const listeners = new Map();
  const bus = (target) => ({
    addEventListener(type, fn) {
      if (!target.has(type)) target.set(type, []);
      target.get(type).push(fn);
    },
  });
  const winL = new Map();
  const canvasL = new Map();
  const docL = new Map();
  const canvas = {
    width: 0,
    height: 0,
    style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: canvas.width, height: canvas.height }),
    ...bus(canvasL),
  };
  const layers = [];
  const document = {
    layers,
    createElement: (tag) => {
      if (tag !== 'canvas') return {};
      const lctx = makeCtx('layer');
      const cv = { width: 0, height: 0, style: {}, getContext: () => lctx, ctx: lctx };
      layers.push(cv);
      return cv;
    },
    getElementById: () => canvas,
    fonts: { size: 1, load: async () => {}, ready: Promise.resolve() },
    body: { dataset: {}, style: {} },
    hidden: false,
    activeElement: null,
    ...bus(docL),
  };
  const win = {
    innerWidth: w,
    innerHeight: h,
    onceworlds,
    AudioContext: FakeAudioContext,
    devicePixelRatio: 2,
    ...bus(winL),
  };
  const page = {
    canvas,
    ctx,
    document,
    window: win,
    audio: audioStats,
    dead: false,
    /** Make this page's globals the current ones (do it before importing its main.js, and before firing its events). */
    install() {
      current = page;
      globalThis.window = win;
      globalThis.document = document;
      globalThis.location = { search };
      globalThis.addEventListener = (type, fn) => bus(winL).addEventListener(type, fn);
      globalThis.devicePixelRatio = 2;
      try {
        Object.defineProperty(globalThis, 'navigator', { value: { vibrate() {} }, configurable: true });
      } catch {
        // already there
      }
      globalThis.Image = class {
        set src(v) {
          this._src = v;
        }
      };
    },
    fire(type, ev = {}, target = 'window') {
      const map = target === 'canvas' ? canvasL : target === 'document' ? docL : winL;
      const e = { preventDefault() {}, isTrusted: false, repeat: false, ...ev };
      for (const fn of map.get(type) ?? []) fn(e);
    },
    key(code, down = true) {
      page.fire(down ? 'keydown' : 'keyup', { code, key: code });
    },
    tap(x, y) {
      page.fire('pointerdown', { clientX: x, clientY: y, pointerType: 'touch' }, 'canvas');
    },
    resize(nw, nh) {
      win.innerWidth = nw;
      win.innerHeight = nh;
      page.install();
      page.fire('resize');
    },
  };
  void listeners;
  return page;
}
