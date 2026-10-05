// A player's head: the platform avatar once it has loaded, else a plain disc in their colour with their initial (always for
// bots). Images are loaded once per id and cached; a failed or missing avatar just keeps the disc.

import { circle, font } from './gfx.js';

const cache = new Map(); // id -> { img, ok }
let lookup = null;

/** `getUrl(id)` resolves with an avatar URL or null (ow.player.avatarUrl(id, 'head')). Never call it for bots. */
export function initAvatars(getUrl) {
  lookup = typeof getUrl === 'function' ? getUrl : null;
}

/** The loaded avatar image for a player, or null (and the load is started the first time). */
export function headImage(id) {
  let e = cache.get(id);
  if (!e) {
    e = { img: null, ok: false };
    cache.set(id, e);
    if (lookup && typeof Image !== 'undefined') {
      Promise.resolve()
        .then(() => lookup(id))
        .then((url) => {
          if (!url || typeof url !== 'string') return;
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            e.ok = true;
          };
          img.onerror = () => {
            e.ok = false;
          };
          e.img = img;
          img.src = url;
        })
        .catch(() => {});
    }
  }
  return e.ok ? e.img : null;
}

/**
 * A head centred on (x, y), radius r in pixels. o: { bot, name, color (the disc's colour), ring (outline colour), lw }.
 * With a loaded avatar it sits in a round window; until then (and for bots) a disc with the first letter of the name.
 */
export function drawHead(ctx, id, x, y, r, o = {}) {
  const img = o.bot ? null : headImage(id);
  const lw = o.lw ?? Math.max(1.5, r * 0.14);
  if (img) {
    ctx.save();
    circle(ctx, x, y, r);
    ctx.fillStyle = '#dfe6f2';
    ctx.fill();
    ctx.clip();
    try {
      ctx.drawImage(img, x - r * 1.08, y - r * 1.08, r * 2.16, r * 2.16);
    } catch {
      // a broken image never stops the frame
    }
    ctx.restore();
  } else {
    circle(ctx, x, y, r);
    ctx.fillStyle = o.color || '#5b6275';
    ctx.fill();
    const initial = String(o.name || '?').trim().slice(0, 1).toUpperCase() || '?';
    ctx.font = font(r * 1.35, 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(initial, x, y + r * 0.06);
  }
  circle(ctx, x, y, r);
  ctx.lineWidth = lw;
  ctx.strokeStyle = o.ring || 'rgba(8,10,16,0.85)';
  ctx.stroke();
}
