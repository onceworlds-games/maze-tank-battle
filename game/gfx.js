// Small drawing helpers shared by every screen: colours, easing, outlined text, rounded rectangles and the little symbols that
// go with each colour. Nothing here touches the page at import time.

export const TAU = Math.PI * 2;
export const FONT = "'Teko', 'Arial Narrow', 'Impact', system-ui, sans-serif";
export const INK = '#0e1016'; // the dark of every outline and panel

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInOut = (t) => {
  t = clamp(t, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
/** Overshoots past 1 and settles: a pop. */
export const easeOutBack = (t, s = 1.70158) => {
  t = clamp(t, 0, 1) - 1;
  return 1 + (s + 1) * t * t * t + s * t * t;
};

const rgbCache = new Map();
export function hexRgb(hex) {
  let c = rgbCache.get(hex);
  if (!c) {
    const n = parseInt(String(hex).slice(1), 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, c);
  }
  return c;
}

const shadeCache = new Map();
/** A lighter (amt > 0) or darker (amt < 0) copy of a #rrggbb colour. */
export function shade(hex, amt) {
  const key = hex + amt;
  let out = shadeCache.get(key);
  if (!out) {
    const [r, g, b] = hexRgb(hex);
    const t = amt < 0 ? 0 : 255;
    const k = Math.abs(amt);
    out = `rgb(${Math.round(r + (t - r) * k)},${Math.round(g + (t - g) * k)},${Math.round(b + (t - b) * k)})`;
    shadeCache.set(key, out);
  }
  return out;
}

export function rgba(hex, a) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`;
}

const fontCache = new Map();
export function font(px, weight = 600) {
  const k = Math.max(6, Math.round(px));
  const key = `${weight}:${k}`;
  let f = fontCache.get(key);
  if (!f) {
    f = `${weight} ${k}px ${FONT}`;
    fontCache.set(key, f);
  }
  return f;
}

/**
 * Clean white text with a dark outline (and an optional soft drop). o: { fill, stroke, lw, align, base, alpha, weight, shadow }.
 * Names and anything else from other players go through here: it only ever calls fillText/strokeText.
 */
export function text(ctx, str, x, y, size, o = {}) {
  if (o.alpha !== undefined && o.alpha <= 0) return;
  const prev = ctx.globalAlpha;
  if (o.alpha !== undefined) ctx.globalAlpha = prev * o.alpha;
  ctx.font = font(size, o.weight || 600);
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = o.base || 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const lw = o.lw ?? Math.max(2.5, size * 0.14);
  if (o.shadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText(str, x + o.shadow, y + o.shadow);
  }
  if (lw > 0) {
    ctx.strokeStyle = o.stroke || 'rgba(8,10,16,0.82)';
    ctx.lineWidth = lw;
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = o.fill || '#ffffff';
  ctx.fillText(str, x, y);
  ctx.globalAlpha = prev;
}

/** A rounded-rectangle path (not filled). */
export function rr(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

export function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, TAU);
}

/** The symbol of a colour (so nobody has to tell the colours apart): filled with the current fillStyle, centred, radius r. */
export function glyph(ctx, i, x, y, r) {
  ctx.beginPath();
  switch (((i % 8) + 8) % 8) {
    case 0:
      ctx.arc(x, y, r * 0.9, 0, TAU);
      break;
    case 1:
      ctx.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
      break;
    case 2:
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.95, y + r * 0.75);
      ctx.lineTo(x - r * 0.95, y + r * 0.75);
      ctx.closePath();
      break;
    case 3:
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      break;
    case 4:
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const rad = k % 2 === 0 ? r : r * 0.45;
        if (k === 0) ctx.moveTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
        else ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
      }
      ctx.closePath();
      break;
    case 5: {
      const t = r * 0.38;
      ctx.moveTo(x - t, y - r);
      ctx.lineTo(x + t, y - r);
      ctx.lineTo(x + t, y - t);
      ctx.lineTo(x + r, y - t);
      ctx.lineTo(x + r, y + t);
      ctx.lineTo(x + t, y + t);
      ctx.lineTo(x + t, y + r);
      ctx.lineTo(x - t, y + r);
      ctx.lineTo(x - t, y + t);
      ctx.lineTo(x - r, y + t);
      ctx.lineTo(x - r, y - t);
      ctx.lineTo(x - t, y - t);
      ctx.closePath();
      break;
    }
    case 6:
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        if (k === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.closePath();
      break;
    default:
      ctx.rect(x - r * 0.85, y - r * 0.8, r * 0.6, r * 1.6);
      ctx.rect(x + r * 0.25, y - r * 0.8, r * 0.6, r * 1.6);
  }
  ctx.fill();
}
