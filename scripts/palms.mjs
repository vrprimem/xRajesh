// Generates original palm-tree silhouettes: a tapering, slightly bent trunk with ring notches, and drooping fronds made
// of leaflets. Writes public/art/palms-left.svg and palms-right.svg, which the page background uses as masks (the
// colour comes from the theme), so the browser downloads them once instead of with every page.
//   node scripts/palms.mjs
import fs from "node:fs";

const r = (n) => Math.round(n * 10) / 10;

function trunk(base, crown, bend, w0, w1) {
  // Quadratic curve from base to crown, bent sideways by `bend`.
  const ctrl = { x: (base.x + crown.x) / 2 + bend, y: (base.y + crown.y) / 2 };
  const pt = (t) => ({
    x: (1 - t) * (1 - t) * base.x + 2 * (1 - t) * t * ctrl.x + t * t * crown.x,
    y: (1 - t) * (1 - t) * base.y + 2 * (1 - t) * t * ctrl.y + t * t * crown.y,
  });
  const left = [];
  const right = [];
  const N = 36;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = pt(t);
    const q = pt(Math.min(1, t + 0.01));
    const p0 = pt(Math.max(0, t - 0.01));
    const dx = q.x - p0.x;
    const dy = q.y - p0.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    // Ring notches: every other step the trunk is a little narrower.
    const w = (w0 + (w1 - w0) * t) * (i % 3 === 0 ? 0.86 : 1);
    left.push({ x: p.x + (nx * w) / 2, y: p.y + (ny * w) / 2 });
    right.push({ x: p.x - (nx * w) / 2, y: p.y - (ny * w) / 2 });
  }
  const pts = [...left, ...right.reverse()];
  return "M" + pts.map((p) => `${r(p.x)} ${r(p.y)}`).join("L") + "Z";
}

function frond(cx, cy, angleDeg, length, droop, width) {
  const a = (angleDeg * Math.PI) / 180;
  const pt = (t) => ({ x: cx + Math.cos(a) * length * t, y: cy + Math.sin(a) * length * t + droop * t * t });
  const upper = [];
  const lower = [];
  const N = 26;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = pt(t);
    const q = pt(Math.min(1, t + 0.01));
    const p0 = pt(Math.max(0, t - 0.01));
    const dx = q.x - p0.x;
    const dy = q.y - p0.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    // Leaflets: the outer part of the frond is serrated; it tapers to a point at both ends.
    const taper = Math.pow(Math.sin(Math.PI * Math.min(t * 1.15, 1)), 0.7);
    const serr = t > 0.18 && i % 2 === 1 ? 0.45 : 1;
    const w = width * taper * serr;
    // Leaflets hang down more than up: the lower edge is wider.
    upper.push({ x: p.x + nx * w * 0.42, y: p.y + ny * w * 0.42 });
    lower.push({ x: p.x - nx * w * 0.58, y: p.y - ny * w * 0.58 });
  }
  const pts = [...upper, ...lower.reverse()];
  return "M" + pts.map((p) => `${r(p.x)} ${r(p.y)}`).join("L") + "Z";
}

function palm({ baseX, baseY, height, bend, lean, scale }) {
  const crown = { x: baseX + lean, y: baseY - height };
  const paths = [trunk({ x: baseX, y: baseY }, crown, bend, 15 * scale, 7 * scale)];
  const fronds = [
    [-172, 120, 70, 22],
    [-150, 132, 52, 24],
    [-122, 110, 46, 22],
    [-95, 80, 40, 18],
    [-62, 112, 46, 22],
    [-30, 130, 56, 24],
    [-8, 120, 72, 22],
    [160, 96, 64, 18],
    [20, 98, 66, 18],
  ];
  for (const [ang, len, droop, w] of fronds) paths.push(frond(crown.x, crown.y, ang, len * scale, droop * scale, w * scale));
  // A few coconuts under the crown.
  for (const [dx, dy] of [[-6, 8], [5, 9], [0, 14]]) {
    const cx = crown.x + dx * scale;
    const cy = crown.y + dy * scale;
    const rr = 5 * scale;
    paths.push(`M${r(cx - rr)} ${r(cy)}a${r(rr)} ${r(rr)} 0 1 0 ${r(2 * rr)} 0a${r(rr)} ${r(rr)} 0 1 0 ${r(-2 * rr)} 0Z`);
  }
  return paths.join("");
}

// Left group: a tall palm leaning right and a shorter one behind it. ViewBox 0 0 320 520, base on the bottom edge.
const left = palm({ baseX: 70, baseY: 520, height: 400, bend: -40, lean: 70, scale: 1 }) + palm({ baseX: 210, baseY: 520, height: 260, bend: 30, lean: -30, scale: 0.72 });
// Right group: mirrored shapes but not the same trees.
const right = palm({ baseX: 250, baseY: 520, height: 430, bend: 44, lean: -80, scale: 1.05 }) + palm({ baseX: 110, baseY: 520, height: 300, bend: -26, lean: 34, scale: 0.8 });

const svg = (d) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 520"><path d="${d}"/></svg>\n`;
fs.mkdirSync("public/art", { recursive: true });
fs.writeFileSync("public/art/palms-left.svg", svg(left));
fs.writeFileSync("public/art/palms-right.svg", svg(right));
console.log("left", left.length, "right", right.length);
