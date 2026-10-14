// Suit glyphs (24x24 viewBox) shared by DOM cards and the canvas celebration.
export const SUIT_PATHS = [
  // spades
  'M12 2C9.2 5.8 3 9.4 3 14.1c0 2.7 2.1 4.7 4.7 4.7 1.4 0 2.6-.5 3.4-1.4-.3 1.8-1 3.1-2.3 4.6h6.4c-1.3-1.5-2-2.8-2.3-4.6.8.9 2 1.4 3.4 1.4 2.6 0 4.7-2 4.7-4.7C21 9.4 14.8 5.8 12 2z',
  // hearts
  'M12 21.4l-1.4-1.3C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.6 11.6L12 21.4z',
  // diamonds
  'M12 1.8l8 10.2-8 10.2-8-10.2z',
  // clubs
  'M12 2.2a4.4 4.4 0 0 0-4.2 5.7 4.4 4.4 0 1 0 2.9 7.3c-.3 2.6-1.1 4.5-2.6 6.6h7.8c-1.5-2.1-2.3-4-2.6-6.6a4.4 4.4 0 1 0 2.9-7.3A4.4 4.4 0 0 0 12 2.2z',
];

const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const paths = SUIT_PATHS.map(p => (typeof Path2D !== 'undefined' ? new Path2D(p) : null));

function drawSuit(ctx, s, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.fill(paths[s]);
  ctx.restore();
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function sprite(suit, rank, cw, ch, dpr) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(cw * dpr);
  c.height = Math.ceil(ch * dpr);
  const x = c.getContext('2d');
  x.scale(dpr, dpr);
  x.fillStyle = '#fdfdfb';
  x.strokeStyle = 'rgba(0,0,0,0.3)';
  x.lineWidth = 1;
  rrect(x, 0.5, 0.5, cw - 1, ch - 1, cw * 0.08);
  x.fill();
  x.stroke();

  const color = suit === 1 || suit === 2 ? '#c8283a' : '#1b1f24';
  x.fillStyle = color;
  x.strokeStyle = color;
  x.textBaseline = 'top';
  x.font = `700 ${cw * 0.22}px system-ui, sans-serif`;
  const label = RANKS[rank];
  const tw = x.measureText(label).width;
  const cx = cw * 0.07 + Math.max(tw, cw * 0.16) / 2;
  x.textAlign = 'center';
  x.fillText(label, cx, ch * 0.05);
  drawSuit(x, suit, cx - cw * 0.08, ch * 0.05 + cw * 0.23, cw * 0.16);
  drawSuit(x, suit, cw - cw * 0.07 - cw * 0.16, ch * 0.07, cw * 0.16);

  if (rank > 10) {
    const bw = cw * 0.56, bh = ch * 0.52;
    const bx = (cw - bw) / 2, by = ch * 0.6 - bh / 2;
    x.lineWidth = 1.5;
    rrect(x, bx, by, bw, bh, cw * 0.05);
    x.stroke();
    x.font = `800 ${cw * 0.3}px system-ui, sans-serif`;
    x.textBaseline = 'middle';
    x.fillText(label, cw / 2, ch * 0.6 - cw * 0.08);
    drawSuit(x, suit, cw / 2 - cw * 0.08, ch * 0.6 + cw * 0.08, cw * 0.16);
  } else {
    const s = cw * 0.42;
    drawSuit(x, suit, cw / 2 - s / 2, ch * 0.6 - s / 2, s);
  }
  return c;
}

let raf = null;

export function stopCascade() {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  const canvas = document.getElementById('winCanvas');
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * Classic bouncing-card cascade.
 * items: [{ suit, rank, x, y, onLaunch }] in viewport coordinates.
 */
export function startCascade(items, cw, ch) {
  stopCascade();
  const canvas = document.getElementById('winCanvas');
  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth, H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const active = [];
  let next = 0;
  let lastLaunch = -Infinity;
  let last = performance.now();

  function launch() {
    const it = items[next++];
    if (it.onLaunch) it.onLaunch();
    const dir = Math.random() < 0.5 ? -1 : 1;
    active.push({
      x: it.x, y: it.y,
      vx: dir * (2.5 + Math.random() * 4.5),
      vy: -(1 + Math.random() * 7),
      img: sprite(it.suit, it.rank, cw, ch, dpr),
    });
  }

  function frame(t) {
    const dt = Math.min(2, (t - last) / 16.67);
    last = t;
    if (next < items.length && t - lastLaunch > 210) {
      launch();
      lastLaunch = t;
    }
    for (const p of active) {
      // sub-step so trails stay continuous
      const steps = 2;
      for (let s = 0; s < steps; s++) {
        const d = dt / steps;
        p.vy += 0.5 * d;
        p.x += p.vx * d;
        p.y += p.vy * d;
        if (p.y + ch > H) {
          p.y = H - ch;
          p.vy = -p.vy * 0.74;
          if (Math.abs(p.vy) < 3) p.vy = -(6 + Math.random() * 5);
        }
        ctx.drawImage(p.img, p.x, p.y, cw, ch);
      }
    }
    for (let i = active.length - 1; i >= 0; i--) {
      const p = active[i];
      if (p.x < -cw - 4 || p.x > W + 4) active.splice(i, 1);
    }
    if (next >= items.length && active.length === 0) { raf = null; return; }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
}
