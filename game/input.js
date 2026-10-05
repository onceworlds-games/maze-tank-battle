// Driving and firing, from the keyboard, the mouse and the platform's on-screen controls.
// Keys: W/S and up/down drive forward and back, A/D and left/right turn, Space (or a click) fires. On a phone the analog stick says
// where to go (the tank turns that way and drives once it faces it) and one Fire button fires; holding it holds fire.

const KEYS = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

export function createInput(ow) {
  const held = { up: false, down: false, left: false, right: false };
  let space = false;
  let mouse = false;
  let button = false;
  let edgeAt = -1e9; // when a fresh press of fire happened (performance.now)
  let lastEdge = -1e9;
  let usedKeys = false;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function press() {
    const t = now();
    if (t - lastEdge < 60) return; // the Space key and the on-screen button saying the same thing
    lastEdge = t;
    edgeAt = t;
  }

  function onKeyDown(e) {
    const dir = KEYS[e.code];
    if (dir) {
      held[dir] = true;
      usedKeys = true;
      e.preventDefault();
    } else if (e.code === 'Space') {
      space = true;
      if (!e.repeat) press();
      e.preventDefault();
    }
  }
  function onKeyUp(e) {
    const dir = KEYS[e.code];
    if (dir) held[dir] = false;
    else if (e.code === 'Space') space = false;
  }
  function clear() {
    held.up = held.down = held.left = held.right = false;
    space = false;
    mouse = false;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clear);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => document.hidden && clear());
  }

  return {
    /** The driving orders of the player, written into `inp` (the Round's tank input): turn, thr, aim, mag. The stick wins while it is held. */
    drive(inp) {
      const st = ow.controls && ow.controls.stick;
      const sx = st && Number.isFinite(st.x) ? st.x : 0;
      const sy = st && Number.isFinite(st.y) ? st.y : 0;
      const m = Math.hypot(sx, sy);
      if (m > 0.16) {
        inp.aim = Math.atan2(sy, sx);
        inp.mag = Math.min(1, (m - 0.1) / 0.7);
        inp.turn = 0;
        inp.thr = 0;
        return inp;
      }
      inp.aim = null;
      inp.mag = 0;
      inp.turn = (held.right ? 1 : 0) - (held.left ? 1 : 0);
      inp.thr = (held.up ? 1 : 0) - (held.down ? 1 : 0);
      return inp;
    },

    /** Call once a frame: notices the on-screen Fire button even if its key event was missed. */
    poll() {
      const down = Boolean(ow.controls && ow.controls.pressed && ow.controls.pressed('fire'));
      if (down && !button) press();
      button = down;
    },

    /** The mouse (or pen) went down or up on the game. */
    setMouse(down) {
      if (down && !mouse) press();
      mouse = Boolean(down);
    },

    /** Fire is being held (by key, mouse or button). */
    fireHeld() {
      return space || mouse || button;
    },

    /** A fresh press of fire happened in the last moment and has not been used: true once. */
    takeEdge() {
      if (now() - edgeAt < 140) {
        edgeAt = -1e9;
        return true;
      }
      return false;
    },

    /** Forget a press nobody used (the screen changed). */
    dropEdge() {
      edgeAt = -1e9;
    },

    get keyboard() {
      return usedKeys && !(ow.controls && ow.controls.touch);
    },
    clear,
  };
}
