// All the sound, synthesized with Web Audio (no files): a punchy sound for every action and a driving step-sequencer tune
// (130 BPM, A minor). The platform applies volume and mute to everything connected to the context's destination. Safe to
// import anywhere: nothing happens until unlock() is called from a tap.

const BPM = 130;
const STEP_S = 60 / BPM / 4; // a sixteenth
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Am F C G, one bar each: [bass root midi, chord midis]
const BARS = [
  [33, [57, 60, 64]],
  [29, [57, 60, 65]],
  [36, [55, 60, 64]],
  [31, [55, 59, 62]],
];
const LEAD = [0, -1, 7, -1, 3, -1, 5, -1, 7, -1, 12, -1, 10, -1, 7, 5]; // semitones over the chord root, -1 = rest

const LEVELS = { off: 0, menu: 0.14, play: 0.3 };

export function createAudio() {
  let ctx = null;
  let sfxGain = null;
  let musicGain = null;
  let noise = null;
  let timer = null;
  let nextTime = 0;
  let step = 0;
  let level = 'menu';
  let applied = '';
  let engine = null;
  const last = Object.create(null);

  const live = () => ctx !== null && ctx.state === 'running';
  const can = (name, ms) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - (last[name] ?? -1e9) < ms) return false;
    last[name] = now;
    return true;
  };

  /** One oscillator with a quick attack and an exponential fall; lp: an optional low-pass cutoff. */
  function tone(type, f0, f1, dur, vol, at = 0, dest = sfxGain, lp = 0) {
    if (!live()) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = g;
    if (lp > 0) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      f.Q.value = 0.8;
      osc.connect(f);
      f.connect(g);
    } else osc.connect(g);
    out.connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  /** A burst of filtered noise. */
  function burst(ftype, f0, f1, dur, vol, at = 0, dest = sfxGain, q = 0.9) {
    if (!live() || !noise) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filt = ctx.createBiquadFilter();
    filt.type = ftype;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 0.4, dur + 0.05);
  }

  // ------------------------------------------------------------ the tune
  function playStep(s, t, full) {
    const bar = BARS[(s >> 4) % 4];
    const k = s & 15;
    const [root, chord] = bar;
    const at = t - ctx.currentTime;
    const m = musicGain;
    // drums
    if (k % 4 === 0) tone('sine', 150, 42, 0.17, full ? 0.55 : 0.4, at, m);
    if (full && (k === 4 || k === 12)) {
      burst('bandpass', 1900, 1400, 0.11, 0.2, at, m, 0.7);
      tone('triangle', 240, 150, 0.08, 0.1, at, m);
    }
    if (k % 4 === 2) burst('highpass', 7500, 7500, 0.05, full ? 0.1 : 0.06, at, m, 0.5);
    if (full && k % 2 === 1) burst('highpass', 8500, 8500, 0.025, 0.035, at, m, 0.5);
    if (full && k === 15) burst('highpass', 6500, 6500, 0.14, 0.06, at, m, 0.5);
    // bass: root and its octave, pushing on the eighths
    if (k % 2 === 0) {
      const oct = k % 8 === 6 ? 12 : k % 4 === 2 ? 7 : 0;
      tone('sawtooth', hz(root + oct), hz(root + oct), 0.2, full ? 0.26 : 0.18, at, m, 420);
    }
    if (!full) {
      // menus: a pad on the chord and a soft pluck
      if (k === 0) for (const n of chord) tone('triangle', hz(n), hz(n), 0.9, 0.05, at, m, 900);
      return;
    }
    // chord stabs on the off beats
    if (k === 6 || k === 14 || k === 11) for (const n of chord) tone('square', hz(n), hz(n), 0.13, 0.04, at, m, 2400);
    // a plucked arpeggio
    if (k % 2 === 0) {
      const n = chord[(k >> 1) % 3] + 12;
      tone('triangle', hz(n), hz(n), 0.12, 0.1, at, m);
    }
    // a lead line every other bar
    if ((s >> 4) % 2 === 1 && LEAD[k] >= 0) {
      const n = root + 36 + LEAD[k];
      tone('square', hz(n), hz(n), 0.14, 0.05, at, m, 3000);
    }
  }

  function schedule() {
    if (!live()) return;
    if (nextTime < ctx.currentTime - 0.4) nextTime = ctx.currentTime + 0.05;
    while (nextTime < ctx.currentTime + 0.14) {
      playStep(step, nextTime, level === 'play');
      nextTime += STEP_S;
      step = (step + 1) % 64;
    }
  }

  const explosion = (vol = 1) => {
    burst('lowpass', 2600, 90, 0.95, 0.65 * vol);
    tone('sine', 100, 26, 0.7, 0.75 * vol);
    tone('sawtooth', 170, 40, 0.4, 0.12 * vol, 0, sfxGain, 900);
    burst('highpass', 5000, 1500, 0.3, 0.16 * vol, 0.02);
    for (let i = 0; i < 4; i++) burst('bandpass', 900 + Math.random() * 2000, 400, 0.05, 0.1 * vol, 0.12 + i * 0.07 + Math.random() * 0.05, sfxGain, 2);
  };

  const api = {
    /** Call from a tap or key: creates the context, starts the tune. True if sound can play. */
    unlock() {
      try {
        if (!ctx) {
          const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
          if (!AC) return false;
          ctx = new AC();
          sfxGain = ctx.createGain();
          sfxGain.gain.value = 0.9;
          sfxGain.connect(ctx.destination);
          musicGain = ctx.createGain();
          musicGain.gain.value = LEVELS[level];
          applied = level;
          musicGain.connect(ctx.destination);
          noise = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate)), ctx.sampleRate);
          const d = noise.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        if (!timer) {
          nextTime = ctx.currentTime + 0.1;
          timer = setInterval(schedule, 30);
        }
        return true;
      } catch {
        return false;
      }
    },

    /** 'menu' (quiet), 'play' (louder, the full tune) or 'off'. */
    setLevel(name) {
      const next = LEVELS[name] !== undefined ? name : 'menu';
      if (next === level && applied === level) return;
      level = next;
      if (ctx && musicGain) {
        musicGain.gain.setTargetAtTime(LEVELS[level], ctx.currentTime, 0.3);
        applied = level;
      }
    },

    /** The engine hum follows how fast the player's tank goes (0 to 1). */
    engine(speed) {
      if (!live()) return;
      try {
        if (!engine) {
          const osc = ctx.createOscillator();
          const f = ctx.createBiquadFilter();
          const g = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = 52;
          f.type = 'lowpass';
          f.frequency.value = 220;
          g.gain.value = 0;
          osc.connect(f);
          f.connect(g);
          g.connect(sfxGain);
          osc.start();
          engine = { osc, g, f };
        }
        const t = ctx.currentTime;
        engine.g.gain.setTargetAtTime(speed > 0.02 ? 0.022 + 0.04 * speed : 0, t, 0.08);
        engine.osc.frequency.setTargetAtTime(50 + 34 * speed, t, 0.1);
        engine.f.frequency.setTargetAtTime(200 + 260 * speed, t, 0.1);
      } catch {
        // no hum
      }
    },

    click() {
      tone('sine', 660, 660, 0.06, 0.25);
    },
    tick() {
      tone('square', 520, 520, 0.1, 0.16, 0, sfxGain, 2000);
      tone('sine', 260, 260, 0.14, 0.3);
    },
    go() {
      tone('square', 784, 784, 0.32, 0.16, 0, sfxGain, 3000);
      tone('square', 1175, 1175, 0.4, 0.14, 0.05, sfxGain, 3000);
      burst('highpass', 3000, 8000, 0.3, 0.12);
    },
    pop() {
      tone('sine', 500, 920, 0.09, 0.16);
    },
    ready() {
      tone('sine', 784, 1175, 0.16, 0.24);
    },
    fire(mine = true) {
      if (!can(mine ? 'fire' : 'fireo', 35)) return;
      const v = mine ? 1 : 0.5;
      burst('highpass', 3500, 1200, 0.07, 0.22 * v);
      tone('triangle', 560, 150, 0.11, 0.3 * v);
      tone('sine', 120, 70, 0.1, 0.25 * v);
    },
    fizzle() {
      if (!can('fizzle', 90)) return;
      tone('square', 150, 110, 0.05, 0.14, 0, sfxGain, 600);
    },
    bounce(v = 1) {
      if (!can('bounce', 28)) return;
      tone('sine', 1500, 900, 0.045, 0.1 * v);
      burst('highpass', 6000, 6000, 0.025, 0.08 * v);
    },
    shotgun(mine = true) {
      const v = mine ? 1 : 0.55;
      burst('lowpass', 3200, 260, 0.2, 0.5 * v);
      tone('sine', 150, 50, 0.16, 0.5 * v);
    },
    gatling(mine = true) {
      if (!can(mine ? 'gat' : 'gato', 45)) return;
      const v = mine ? 1 : 0.5;
      burst('bandpass', 2400, 1200, 0.045, 0.2 * v, 0, sfxGain, 1.2);
      tone('sine', 180, 90, 0.05, 0.2 * v);
    },
    laser(mine = true) {
      const v = mine ? 1 : 0.6;
      tone('sawtooth', 2200, 260, 0.38, 0.2 * v, 0, sfxGain, 5000);
      tone('square', 1100, 140, 0.3, 0.09 * v, 0, sfxGain, 3000);
      burst('highpass', 6000, 2000, 0.22, 0.14 * v);
    },
    missile(mine = true) {
      const v = mine ? 1 : 0.6;
      burst('bandpass', 300, 1800, 0.55, 0.3 * v, 0, sfxGain, 1.2);
      tone('sawtooth', 120, 260, 0.4, 0.12 * v, 0, sfxGain, 700);
    },
    mineDrop() {
      tone('sine', 220, 90, 0.12, 0.3);
      burst('lowpass', 900, 200, 0.07, 0.2);
    },
    mineArm() {
      if (!can('arm', 150)) return;
      tone('square', 1320, 1320, 0.05, 0.05, 0, sfxGain, 3000);
    },
    boom(vol = 1) {
      if (!can('boom', 60)) return;
      explosion(vol);
    },
    pop2() {
      burst('bandpass', 1400, 500, 0.12, 0.25, 0, sfxGain, 1.4);
      tone('sine', 400, 120, 0.1, 0.2);
    },
    pickup() {
      tone('triangle', 660, 660, 0.09, 0.26);
      tone('triangle', 880, 880, 0.09, 0.26, 0.07);
      tone('triangle', 1320, 1320, 0.2, 0.28, 0.14);
    },
    target() {
      tone('sine', 880, 1320, 0.1, 0.22);
      burst('highpass', 4000, 4000, 0.05, 0.12);
    },
    point() {
      tone('square', 1046, 1046, 0.07, 0.1, 0, sfxGain, 3000);
      tone('square', 1568, 1568, 0.1, 0.1, 0.06, sfxGain, 3000);
    },
    win() {
      [523, 659, 784, 1047].forEach((f, i) => tone('square', f, f, 0.2, 0.14, i * 0.11, sfxGain, 3200));
      [523, 659, 784].forEach((f) => tone('triangle', f, f, 1.0, 0.16, 0.46));
      burst('highpass', 5000, 9000, 0.5, 0.1, 0.44);
    },
    lose() {
      tone('triangle', 330, 196, 0.5, 0.2);
      tone('sine', 165, 98, 0.6, 0.2);
    },
    round() {
      tone('sawtooth', 220, 440, 0.3, 0.14, 0, sfxGain, 1600);
      burst('bandpass', 500, 2500, 0.3, 0.14, 0, sfxGain, 1);
    },
    out() {
      tone('sawtooth', 300, 70, 0.5, 0.2, 0, sfxGain, 800);
    },
  };
  return api;
}
