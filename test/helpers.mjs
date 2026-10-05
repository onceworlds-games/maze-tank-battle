// Shared by the tests: an open box (a maze with no inside walls), a Round with every tank simulated, a quick way to run steps.
import { buildRects, makeMaze } from '../game/maze.js';
import { Round } from '../game/round.js';
import { COLS, ROWS, STEP } from '../game/rules.js';

export function openMaze(cols = COLS, rows = ROWS) {
  const m = makeMaze(1, cols, rows);
  for (let y = 1; y < rows; y++) for (let x = 0; x < cols; x++) m.h[y * cols + x] = 0;
  for (let y = 0; y < rows; y++) for (let x = 1; x < cols; x++) m.v[y * (cols + 1) + x] = 0;
  m.dists = new Map();
  buildRects(m);
  return m;
}

export function roundWith(tanks, opts = {}) {
  const r = new Round({ roster: [], seed: opts.seed ?? 7, maze: opts.maze, practice: opts.practice });
  for (const t of tanks) {
    const k = r.addTank({ id: t.id, bot: Boolean(t.bot), c: 0 }, { x: t.x, y: t.y, a: t.a ?? 0 });
    k.sim = t.sim !== false;
  }
  return r;
}

export function run(round, seconds, dt = STEP) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) round.step(dt);
}

export const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/** An open box with one vertical wall all the way down at x = 5. */
export function splitMaze() {
  const m = openMaze();
  for (let y = 0; y < m.rows; y++) m.v[y * (m.cols + 1) + 5] = 1;
  m.dists = new Map();
  buildRects(m);
  return m;
}
