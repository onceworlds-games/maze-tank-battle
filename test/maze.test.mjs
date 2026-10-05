import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WALL_T, cellAt, distTo, isOpen, makeMaze, nextCell, passages, spawnPlan } from '../game/maze.js';
import { COLS, ROWS, TANK } from '../game/rules.js';
import { insideRects } from '../game/geom.js';
import { mulberry32 } from '../game/rng.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => i * 7919 + 3);

test('a maze is 9 x 6, the same for the same seed and different for another', () => {
  const a = makeMaze(42);
  const b = makeMaze(42);
  const c = makeMaze(43);
  assert.equal(a.cols, COLS);
  assert.equal(a.rows, ROWS);
  assert.deepEqual([...a.h], [...b.h]);
  assert.deepEqual([...a.v], [...b.v]);
  assert.deepEqual([...a.rc], [...b.rc]);
  assert.notDeepEqual([...a.h, ...a.v], [...c.h, ...c.v]);
});

test('every maze is connected, closed at the border and has loops (several routes)', () => {
  for (const seed of SEEDS) {
    const m = makeMaze(seed);
    const cells = m.cols * m.rows;
    // closed border
    for (let x = 0; x < m.cols; x++) {
      assert.equal(m.h[x], 1);
      assert.equal(m.h[m.rows * m.cols + x], 1);
    }
    for (let y = 0; y < m.rows; y++) {
      assert.equal(m.v[y * (m.cols + 1)], 1);
      assert.equal(m.v[y * (m.cols + 1) + m.cols], 1);
    }
    // every cell reachable from every other (checked from three cells)
    for (const from of [0, cells - 1, 20]) {
      const d = distTo(m, from);
      for (let c = 0; c < cells; c++) assert.ok(d[c] >= 0, `seed ${seed}: cell ${c} unreachable from ${from}`);
    }
    // a perfect maze has cells - 1 passages; 30% of the walls left come out on top of that
    const inside = (m.cols - 1) * m.rows + m.cols * (m.rows - 1);
    const left = inside - (cells - 1);
    assert.equal(passages(m), cells - 1 + Math.round(left * 0.3), `seed ${seed}`);
    assert.ok(passages(m) > cells - 1, 'there are loops');
  }
});

test('walls are thick rectangles on the cell lines and never cover a cell middle', () => {
  for (const seed of SEEDS) {
    const m = makeMaze(seed);
    assert.ok(m.nrc > 4);
    for (let cy = 0; cy < m.rows; cy++) for (let cx = 0; cx < m.cols; cx++) assert.ok(!insideRects(m.rc, m.nrc, cx + 0.5, cy + 0.5, TANK.rc), `seed ${seed}: a wall in the middle of (${cx}, ${cy})`);
    for (const [x0, y0, x1, y1] of m.rects) {
      assert.ok(x1 > x0 && y1 > y0);
      const thin = Math.min(x1 - x0, y1 - y0);
      assert.ok(Math.abs(thin - WALL_T) < 1e-9);
    }
  }
});

test('walls and passages agree: a passage means no wall rectangle across it', () => {
  const m = makeMaze(99);
  for (let cy = 0; cy < m.rows; cy++) {
    for (let cx = 0; cx < m.cols; cx++) {
      if (cx + 1 < m.cols) {
        const open = isOpen(m, cx, cy, 0);
        const blocked = m.rects.some(([x0, y0, x1, y1]) => x0 < cx + 1 && x1 > cx + 1 && y0 < cy + 0.5 && y1 > cy + 0.5);
        assert.equal(open, !blocked);
      }
      if (cy + 1 < m.rows) {
        const open = isOpen(m, cx, cy, 1);
        const blocked = m.rects.some(([x0, y0, x1, y1]) => y0 < cy + 1 && y1 > cy + 1 && x0 < cx + 0.5 && x1 > cx + 0.5);
        assert.equal(open, !blocked);
      }
    }
  }
});

test('spawns: far apart, in the middle of distinct cells, facing down a corridor', () => {
  for (const seed of SEEDS) {
    const m = makeMaze(seed);
    for (const n of [2, 4, 8]) {
      const plan = spawnPlan(m, n, mulberry32(seed));
      assert.equal(plan.length, n);
      assert.equal(new Set(plan.map((p) => p.cell)).size, n, 'distinct cells');
      let min = Infinity;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) min = Math.min(min, distTo(m, plan[i].cell)[plan[j].cell]);
      if (n === 2) assert.ok(min >= 6, `seed ${seed}: two tanks only ${min} cells apart`);
      if (n === 4) assert.ok(min >= 3, `seed ${seed}: four tanks, closest pair ${min} cells apart`);
      for (const p of plan) {
        assert.equal(p.x, (p.cell % m.cols) + 0.5);
        assert.equal(cellAt(m, p.x, p.y), p.cell);
        const dir = [Math.round(Math.cos(p.a)), Math.round(Math.sin(p.a))];
        const d = [[1, 0], [0, 1], [-1, 0], [0, -1]].findIndex((v) => v[0] === dir[0] && v[1] === dir[1]);
        assert.ok(d >= 0 && isOpen(m, p.cell % m.cols, (p.cell / m.cols) | 0, d), 'faces an opening');
      }
    }
  }
});

test('nextCell walks from any cell to any other, one step closer each time', () => {
  const m = makeMaze(5);
  const cells = m.cols * m.rows;
  for (let from = 0; from < cells; from += 5) {
    for (let to = 0; to < cells; to += 7) {
      let c = from;
      let steps = 0;
      const want = distTo(m, to)[from];
      while (c !== to) {
        const n = nextCell(m, c, to);
        assert.ok(n !== c);
        assert.equal(distTo(m, to)[n], distTo(m, to)[c] - 1);
        c = n;
        steps++;
      }
      assert.equal(steps, want);
    }
  }
});
