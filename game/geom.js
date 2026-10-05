// Geometry for shots and tanks: exact ray casts against the walls (thick axis-aligned rectangles), mirror reflection, a swept
// test against a tank's rectangle, and pushing circles out of walls. Pure; the functions write into `out` objects so the frame
// loop allocates nothing.

export const TAU = Math.PI * 2;

export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** The shortest signed turn from angle `from` to angle `to`. */
export const angDiff = (to, from) => wrapAngle(to - from);

/**
 * Cast a circle of radius r from (ox, oy) along the unit direction (dx, dy) for `dist`. `rc` holds `n` rectangles as
 * x0, y0, x1, y1. A circle hits a rectangle when its centre reaches the rectangle grown by r, so the first face the centre
 * meets is where the circle touches. On a hit, out = { t, nx, ny } (the distance along the ray and the face's normal) and the
 * result is true. Starting inside a rectangle, or running along a face, is no hit.
 */
export function castRects(rc, n, ox, oy, dx, dy, dist, r, out) {
  const ex = ox + dx * dist;
  const ey = oy + dy * dist;
  const sx0 = (ox < ex ? ox : ex) - r;
  const sx1 = (ox < ex ? ex : ox) + r;
  const sy0 = (oy < ey ? oy : ey) - r;
  const sy1 = (oy < ey ? ey : oy) + r;
  let best = Infinity;
  let bnx = 0;
  let bny = 0;
  for (let i = 0; i < n; i++) {
    const b = i * 4;
    const X0 = rc[b] - r;
    const Y0 = rc[b + 1] - r;
    const X1 = rc[b + 2] + r;
    const Y1 = rc[b + 3] + r;
    if (X1 < sx0 || X0 > sx1 || Y1 < sy0 || Y0 > sy1) continue;
    let tmin = -Infinity;
    let tmax = Infinity;
    let nx = 0;
    let ny = 0;
    if (dx === 0) {
      if (ox <= X0 || ox >= X1) continue;
    } else {
      const t1 = (X0 - ox) / dx;
      const t2 = (X1 - ox) / dx;
      const enter = t1 < t2 ? t1 : t2;
      const exit = t1 < t2 ? t2 : t1;
      tmin = enter;
      nx = dx > 0 ? -1 : 1;
      tmax = exit;
    }
    if (dy === 0) {
      if (oy <= Y0 || oy >= Y1) continue;
    } else {
      const t1 = (Y0 - oy) / dy;
      const t2 = (Y1 - oy) / dy;
      const enter = t1 < t2 ? t1 : t2;
      const exit = t1 < t2 ? t2 : t1;
      if (enter > tmin) {
        tmin = enter;
        nx = 0;
        ny = dy > 0 ? -1 : 1;
      } else if (enter === tmin && dx !== 0) {
        // exactly into a corner: straight back
        nx = -dx;
        ny = -dy;
      }
      if (exit < tmax) tmax = exit;
    }
    if (tmax - tmin < 1e-10 || tmax <= 0 || tmin < 0 || tmin > dist) continue;
    if (tmin < best) {
      best = tmin;
      bnx = nx;
      bny = ny;
    }
  }
  if (best === Infinity) return false;
  out.t = best;
  out.nx = bnx;
  out.ny = bny;
  return true;
}

/** Is a circle of radius r at (x, y) inside (overlapping the inside of) any wall? */
export function insideRects(rc, n, x, y, r) {
  for (let i = 0; i < n; i++) {
    const b = i * 4;
    if (x > rc[b] - r + 1e-9 && x < rc[b + 2] + r - 1e-9 && y > rc[b + 1] - r + 1e-9 && y < rc[b + 3] + r - 1e-9) return true;
  }
  return false;
}

/** Push the circle p = { x, y } of radius rad out of every wall it overlaps. True if it moved. */
export function pushCircle(rc, n, p, rad) {
  let moved = false;
  for (let i = 0; i < n; i++) {
    const b = i * 4;
    const x0 = rc[b];
    const y0 = rc[b + 1];
    const x1 = rc[b + 2];
    const y1 = rc[b + 3];
    const qx = p.x < x0 ? x0 : p.x > x1 ? x1 : p.x;
    const qy = p.y < y0 ? y0 : p.y > y1 ? y1 : p.y;
    const dx = p.x - qx;
    const dy = p.y - qy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rad * rad) continue;
    moved = true;
    if (d2 > 1e-12) {
      const d = Math.sqrt(d2);
      const k = (rad - d) / d;
      p.x += dx * k;
      p.y += dy * k;
    } else {
      // the centre is inside the wall: leave by the nearest face
      const l = p.x - x0;
      const r = x1 - p.x;
      const t = p.y - y0;
      const bt = y1 - p.y;
      const m = Math.min(l, r, t, bt);
      if (m === l) p.x = x0 - rad;
      else if (m === r) p.x = x1 + rad;
      else if (m === t) p.y = y0 - rad;
      else p.y = y1 + rad;
    }
  }
  return moved;
}

/**
 * The segment (ax, ay) to (bx, by) against a tank's rectangle (centre cx, cy, heading ang, half sizes hl x hw: grow them by the
 * shot's radius first). Returns the fraction along the segment where it enters (0 if it starts inside), or -1.
 */
export function segObb(ax, ay, bx, by, cx, cy, ang, hl, hw) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const px = ax - cx;
  const py = ay - cy;
  const qx = bx - cx;
  const qy = by - cy;
  const lx0 = px * c + py * s;
  const ly0 = -px * s + py * c;
  const lx1 = qx * c + qy * s;
  const ly1 = -qx * s + qy * c;
  const ddx = lx1 - lx0;
  const ddy = ly1 - ly0;
  let t0 = 0;
  let t1 = 1;
  if (Math.abs(ddx) < 1e-12) {
    if (lx0 < -hl || lx0 > hl) return -1;
  } else {
    let a = (-hl - lx0) / ddx;
    let b = (hl - lx0) / ddx;
    if (a > b) {
      const t = a;
      a = b;
      b = t;
    }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return -1;
  }
  if (Math.abs(ddy) < 1e-12) {
    if (ly0 < -hw || ly0 > hw) return -1;
  } else {
    let a = (-hw - ly0) / ddy;
    let b = (hw - ly0) / ddy;
    if (a > b) {
      const t = a;
      a = b;
      b = t;
    }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return -1;
  }
  return t0;
}

/** Squared distance from a point to a segment. */
export function pointSegDist2(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 1e-12 ? ((px - ax) * abx + (py - ay) * aby) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + abx * t);
  const dy = py - (ay + aby * t);
  return dx * dx + dy * dy;
}

/** Mirror a direction (dx, dy) in a face with the unit normal (nx, ny): into out = [dx', dy']. */
export function reflect(dx, dy, nx, ny, out) {
  const d = dx * nx + dy * ny;
  out[0] = dx - 2 * d * nx;
  out[1] = dy - 2 * d * ny;
  return out;
}
