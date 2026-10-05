// The maze: a perfect maze (a spanning tree of cells) with 30% of the remaining inside walls taken out so there are loops,
// so there are always several ways round. Cells are 1 x 1 world units; walls are thick rectangles on the cell lines.
// Pure and seeded: every page builds the same maze from the same seed.

import { hashStr, mulberry32, shuffle } from './rng.js';
import { COLS, ROWS } from './rules.js';

export const WALL_T = 0.11; // wall thickness
export const DIRS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
]; // E, S, W, N

// h[y * cols + x]: the wall on the horizontal line y, between x and x + 1 (y = 0..rows).
// v[y * (cols + 1) + x]: the wall on the vertical line x, between y and y + 1 (x = 0..cols).
export function makeMaze(seed, cols = COLS, rows = ROWS, loops = 0.3) {
  const s = seed >>> 0;
  const rng = mulberry32(hashStr(`maze:${s}`));
  const h = new Uint8Array((rows + 1) * cols).fill(1);
  const v = new Uint8Array(rows * (cols + 1)).fill(1);
  const maze = { seed: s, cols, rows, h, v, rects: [], rc: new Float64Array(0), nrc: 0, dists: new Map() };

  const seen = new Uint8Array(cols * rows);
  const start = Math.floor(rng() * cols * rows);
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const c = stack[stack.length - 1];
    const cx = c % cols;
    const cy = (c / cols) | 0;
    const opts = [];
    for (let d = 0; d < 4; d++) {
      const nx = cx + DIRS[d][0];
      const ny = cy + DIRS[d][1];
      if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && !seen[ny * cols + nx]) opts.push(d);
    }
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const d = opts[Math.floor(rng() * opts.length)];
    setWall(maze, cx, cy, d, 0);
    const n = (cy + DIRS[d][1]) * cols + cx + DIRS[d][0];
    seen[n] = 1;
    stack.push(n);
  }

  // Loops: a share of the inside walls that are left come out.
  const inside = [];
  for (let y = 0; y < rows; y++) for (let x = 1; x < cols; x++) if (v[y * (cols + 1) + x]) inside.push([x - 1, y, 0]); // between (x-1, y) and (x, y): east of (x-1, y)
  for (let y = 1; y < rows; y++) for (let x = 0; x < cols; x++) if (h[y * cols + x]) inside.push([x, y - 1, 1]); // south of (x, y-1)
  shuffle(inside, rng);
  const take = Math.round(inside.length * loops);
  for (let i = 0; i < take; i++) setWall(maze, inside[i][0], inside[i][1], inside[i][2], 0);

  buildRects(maze);
  return maze;
}

/** Put (1) or take away (0) the wall on side `d` of cell (cx, cy). */
function setWall(maze, cx, cy, d, on) {
  const { cols } = maze;
  if (d === 0) maze.v[cy * (cols + 1) + cx + 1] = on;
  else if (d === 1) maze.h[(cy + 1) * cols + cx] = on;
  else if (d === 2) maze.v[cy * (cols + 1) + cx] = on;
  else maze.h[cy * cols + cx] = on;
}

/** Is there a passage from cell (cx, cy) in direction d? */
export function isOpen(maze, cx, cy, d) {
  const { cols } = maze;
  if (d === 0) return maze.v[cy * (cols + 1) + cx + 1] === 0;
  if (d === 1) return maze.h[(cy + 1) * cols + cx] === 0;
  if (d === 2) return maze.v[cy * (cols + 1) + cx] === 0;
  return maze.h[cy * cols + cx] === 0;
}

/** How many inside passages there are (a perfect maze has cols * rows - 1). */
export function passages(maze) {
  const { cols, rows } = maze;
  let n = 0;
  for (let y = 0; y < rows; y++) for (let x = 1; x < cols; x++) if (!maze.v[y * (cols + 1) + x]) n++;
  for (let y = 1; y < rows; y++) for (let x = 0; x < cols; x++) if (!maze.h[y * cols + x]) n++;
  return n;
}

/** Walls as rectangles: runs of wall on a line become one thick rectangle each, so the faces are long and clean. */
export function buildRects(maze) {
  const { cols, rows, h, v } = maze;
  const hw = WALL_T / 2;
  const list = [];
  for (let y = 0; y <= rows; y++) {
    let x = 0;
    while (x < cols) {
      if (!h[y * cols + x]) {
        x++;
        continue;
      }
      const x0 = x;
      while (x < cols && h[y * cols + x]) x++;
      list.push([x0 - hw, y - hw, x + hw, y + hw]);
    }
  }
  for (let x = 0; x <= cols; x++) {
    let y = 0;
    while (y < rows) {
      if (!v[y * (cols + 1) + x]) {
        y++;
        continue;
      }
      const y0 = y;
      while (y < rows && v[y * (cols + 1) + x]) y++;
      list.push([x - hw, y0 - hw, x + hw, y + hw]);
    }
  }
  maze.rects = list;
  maze.nrc = list.length;
  maze.rc = new Float64Array(list.length * 4);
  list.forEach((r, i) => maze.rc.set(r, i * 4));
}

export const cellIndex = (maze, cx, cy) => cy * maze.cols + cx;
export const cellX = (maze, c) => c % maze.cols;
export const cellY = (maze, c) => (c / maze.cols) | 0;

/** The cell a point is in (clamped to the maze). */
export function cellAt(maze, x, y) {
  const cx = Math.max(0, Math.min(maze.cols - 1, Math.floor(x)));
  const cy = Math.max(0, Math.min(maze.rows - 1, Math.floor(y)));
  return cy * maze.cols + cx;
}

/** Steps along passages from every cell to `cell` (a breadth-first search, remembered per maze): -1 where unreachable. */
export function distTo(maze, cell) {
  let d = maze.dists.get(cell);
  if (d) return d;
  const { cols, rows } = maze;
  d = new Int16Array(cols * rows).fill(-1);
  const queue = [cell];
  d[cell] = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi];
    const cx = c % cols;
    const cy = (c / cols) | 0;
    for (let k = 0; k < 4; k++) {
      if (!isOpen(maze, cx, cy, k)) continue;
      const n = (cy + DIRS[k][1]) * cols + cx + DIRS[k][0];
      if (d[n] < 0) {
        d[n] = d[c] + 1;
        queue.push(n);
      }
    }
  }
  maze.dists.set(cell, d);
  return d;
}

/** The neighbour of `from` that is one step closer to `to` (or `from` itself when there). */
export function nextCell(maze, from, to) {
  if (from === to) return from;
  const d = distTo(maze, to);
  const cx = from % maze.cols;
  const cy = (from / maze.cols) | 0;
  let best = from;
  let bd = d[from] < 0 ? Infinity : d[from];
  for (let k = 0; k < 4; k++) {
    if (!isOpen(maze, cx, cy, k)) continue;
    const n = (cy + DIRS[k][1]) * maze.cols + cx + DIRS[k][0];
    if (d[n] >= 0 && d[n] < bd) {
      bd = d[n];
      best = n;
    }
  }
  return best;
}

/** How far a straight corridor runs from a cell in direction d, in cells. */
function runLength(maze, cx, cy, d) {
  let n = 0;
  while (isOpen(maze, cx, cy, d)) {
    cx += DIRS[d][0];
    cy += DIRS[d][1];
    n++;
  }
  return n;
}

/**
 * Where `n` tanks start: cells as far from each other as can be (the next one is always the cell farthest from those chosen),
 * each facing down its longest straight corridor. [{ x, y, a, cell }]
 */
export function spawnPlan(maze, n, rng) {
  const cells = maze.cols * maze.rows;
  const chosen = [Math.floor(rng() * cells)];
  while (chosen.length < Math.min(n, cells)) {
    let best = -1;
    let ties = [];
    for (let c = 0; c < cells; c++) {
      if (chosen.includes(c)) continue;
      let m = Infinity;
      for (const o of chosen) {
        const dd = distTo(maze, o)[c];
        if (dd >= 0 && dd < m) m = dd;
      }
      if (m > best) {
        best = m;
        ties = [c];
      } else if (m === best) ties.push(c);
    }
    chosen.push(ties[Math.floor(rng() * ties.length)]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const cell = chosen[i % chosen.length];
    const cx = cell % maze.cols;
    const cy = (cell / maze.cols) | 0;
    let bd = 0;
    let bl = -1;
    for (let d = 0; d < 4; d++) {
      if (!isOpen(maze, cx, cy, d)) continue;
      const len = runLength(maze, cx, cy, d) + rng() * 0.5;
      if (len > bl) {
        bl = len;
        bd = d;
      }
    }
    out.push({ x: cx + 0.5, y: cy + 0.5, a: Math.atan2(DIRS[bd][1], DIRS[bd][0]), cell });
  }
  return out;
}
