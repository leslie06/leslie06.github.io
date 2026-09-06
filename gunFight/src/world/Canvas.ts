import * as THREE from 'three';
import { Rng } from '../core/Rng';

/**
 * Procedural canvas textures: shop sign atlas (Arabic / Cyrillic), striped awning canvas, scattered
 * paper, bullet pock decal sheet. All deterministic (seeded Rng), all generated once at build.
 */
function grunge(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng, amount: number, holes = true): void {
  // dust/stain blotches
  for (let i = 0; i < amount * 40; i++) {
    const x = rng.range(0, w), y = rng.range(0, h), r = rng.range(w * 0.02, w * 0.12);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = rng.range(0.05, 0.22);
    g.addColorStop(0, `rgba(40,30,20,${a})`); g.addColorStop(1, 'rgba(40,30,20,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // streaks from the top edge
  for (let i = 0; i < amount * 25; i++) {
    const x = rng.range(0, w), len = rng.range(h * 0.2, h * 0.9);
    const g = ctx.createLinearGradient(x, 0, x, len);
    g.addColorStop(0, `rgba(30,25,20,${rng.range(0.1, 0.3)})`); g.addColorStop(1, 'rgba(30,25,20,0)');
    ctx.fillStyle = g; ctx.fillRect(x, 0, rng.range(1, 4), len);
  }
  // scratches / peel
  ctx.strokeStyle = 'rgba(225,220,205,0.35)'; ctx.lineWidth = 1;
  for (let i = 0; i < amount * 20; i++) { ctx.beginPath(); const x = rng.range(0, w), y = rng.range(0, h); ctx.moveTo(x, y); ctx.lineTo(x + rng.range(-30, 30), y + rng.range(-8, 8)); ctx.stroke(); }
  // Bullet holes. Off for anything that is *tiled* (the distant-facade atlas): a hole drawn once in a 512 px
  // cell that is then stamped 4x3 times across a 20 m wall reads as a printed glyph repeated at every panel
  // corner — round 3 called exactly that, an "8 glyph at each panel corner", a UV/atlas debug map.
  for (let i = 0; holes && i < amount * 4; i++) {
    const x = rng.range(w * 0.05, w * 0.95), y = rng.range(h * 0.1, h * 0.9), r = rng.range(3, 7);
    ctx.fillStyle = 'rgba(200,195,180,0.9)'; ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0a0a0a'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}

export interface SignSlot { u0: number; v0: number; u1: number; v1: number; aspect: number }
export interface SignAtlas { texture: THREE.CanvasTexture; slots: SignSlot[] }

const SIGNS: { text: string; bg: string; fg: string; sub?: string; font: string }[] = [
  { text: 'صيدلية', sub: 'PHARMACY', bg: '#1d6b3f', fg: '#f2efe4', font: 'bold 150px "Geeza Pro", "Noto Naskh Arabic", "Arial", sans-serif' },
  { text: 'بقالة الأمل', sub: 'MINI MARKET', bg: '#b3352a', fg: '#f7f2e0', font: 'bold 140px "Geeza Pro", "Noto Naskh Arabic", "Arial", sans-serif' },
  { text: 'АПТЕКА', bg: '#e6e2d3', fg: '#1f3d6b', font: 'bold 170px "Helvetica Neue", Arial, sans-serif' },
  { text: 'РЕМОНТ ШИН', sub: 'ВУЛКАНИЗАЦИЯ', bg: '#2a3a55', fg: '#f4d35e', font: 'bold 130px "Helvetica Neue", Arial, sans-serif' },
  { text: 'مطعم النور', sub: 'RESTAURANT', bg: '#d8a520', fg: '#3a2a10', font: 'bold 140px "Geeza Pro", "Noto Naskh Arabic", "Arial", sans-serif' },
  { text: 'ورشة', sub: 'AUTO SERVICE', bg: '#4a4f57', fg: '#e8e2d0', font: 'bold 160px "Geeza Pro", "Noto Naskh Arabic", "Arial", sans-serif' },
  { text: 'МАГАЗИН', sub: 'ПРОДУКТЫ 24', bg: '#c8c2b2', fg: '#8a2320', font: 'bold 150px "Helvetica Neue", Arial, sans-serif' },
  { text: 'هاتف • انترنت', bg: '#1f6f9c', fg: '#ffffff', font: 'bold 120px "Geeza Pro", "Noto Naskh Arabic", "Arial", sans-serif' },
];

export function makeSignAtlas(rng: Rng): SignAtlas {
  const W = 2048, H = 2048, cols = 2, rows = 4;
  const cw = W / cols, ch = H / rows;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const slots: SignSlot[] = [];
  SIGNS.forEach((s, i) => {
    const cx = (i % cols) * cw, cy = Math.floor(i / cols) * ch;
    ctx.save(); ctx.translate(cx, cy);
    ctx.fillStyle = s.bg; ctx.fillRect(0, 0, cw, ch);
    // faded panel look: subtle horizontal banding + border
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; for (let y = 0; y < ch; y += 24) ctx.fillRect(0, y, cw, 6);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 18; ctx.strokeRect(9, 9, cw - 18, ch - 18);
    ctx.fillStyle = s.fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = s.font;
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 5;
    ctx.fillText(s.text, cw / 2, s.sub ? ch * 0.42 : ch * 0.5, cw * 0.9);
    if (s.sub) { ctx.font = 'bold 72px "Helvetica Neue", Arial, sans-serif'; ctx.fillText(s.sub, cw / 2, ch * 0.78, cw * 0.85); }
    ctx.shadowColor = 'transparent';
    grunge(ctx, cw, ch, rng, 1.2);
    ctx.restore();
    slots.push({ u0: cx / W, v0: 1 - (cy + ch) / H, u1: (cx + cw) / W, v1: 1 - cy / H, aspect: cw / ch });
  });
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  return { texture, slots };
}

/** Striped, sun-faded awning canvas. */
export function makeAwningTexture(rng: Rng, colorA: string, colorB: string): THREE.CanvasTexture {
  const W = 1024, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const stripe = 96;
  for (let x = 0; x < W; x += stripe) { ctx.fillStyle = (x / stripe) % 2 === 0 ? colorA : colorB; ctx.fillRect(x, 0, stripe, H); }
  // low-frequency weave shading only (a 4 px thread grid aliases into moiré at distance)
  for (let i = 0; i < 260; i++) { ctx.fillStyle = `rgba(${rng.int(20, 60)},${rng.int(15, 40)},${rng.int(10, 30)},${rng.range(0.03, 0.09)})`; ctx.fillRect(rng.range(0, W), rng.range(0, H), rng.range(30, 160), rng.range(2, 6)); }
  grunge(ctx, W, H, rng, 2.5);
  // sun fade: canvas is brightest along the wall (v=1) and dirtiest at the outer hem (v=0)
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(60,50,40,0.28)'); g.addColorStop(1, 'rgba(255,245,220,0.22)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // frayed outer hem + shrapnel holes (alpha)
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.moveTo(0, 0);
  for (let x = 0; x <= W; x += 12) ctx.lineTo(x, rng.range(4, 26) + (Math.sin(x * 0.05) + 1) * 8);
  ctx.lineTo(W, 0); ctx.closePath(); ctx.fillStyle = '#000'; ctx.fill();
  for (let i = 0; i < 14; i++) { ctx.beginPath(); ctx.arc(rng.range(0, W), rng.range(30, H), rng.range(3, 12), 0, Math.PI * 2); ctx.fill(); }
  ctx.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

/** Sheet of 4 paper scraps (alpha) for scattered litter. */
export function makePaperTexture(rng: Rng): THREE.CanvasTexture {
  const W = 512, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  for (let i = 0; i < 4; i++) {
    const ox = (i % 2) * 256, oy = Math.floor(i / 2) * 256;
    ctx.save(); ctx.translate(ox, oy);
    ctx.beginPath();
    // torn outline
    const pts = 14;
    for (let k = 0; k < pts; k++) {
      const a = (k / pts) * Math.PI * 2;
      const r = 100 + rng.range(-18, 12);
      const x = 128 + Math.cos(a) * r * 1.0, y = 128 + Math.sin(a) * r * 1.2;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = ['#e8e2d2', '#d9d2bd', '#efe9d8', '#cfc7b1'][i]; ctx.fill();
    ctx.clip();
    ctx.fillStyle = 'rgba(40,40,40,0.75)';
    for (let y = 50; y < 220; y += 14) { const len = rng.range(80, 170); ctx.fillRect(48, y, len, 3); }
    if (i === 1) { ctx.fillStyle = 'rgba(120,20,20,0.7)'; ctx.fillRect(60, 40, 130, 10); }
    grunge(ctx, 256, 256, rng, 0.6);
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Bullet pock cluster sheet: 2x2 atlas, alpha in A. */
export function makePockTexture(rng: Rng): THREE.CanvasTexture {
  const W = 512, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  for (let i = 0; i < 4; i++) {
    const ox = (i % 2) * 256, oy = Math.floor(i / 2) * 256;
    const n = 3 + i * 2;
    for (let k = 0; k < n; k++) {
      const x = ox + 128 + rng.range(-80, 80), y = oy + 128 + rng.range(-80, 80), r = rng.range(4, 8);
      // chipped plaster ring (lighter), crater (dark), spall
      const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 2.2);
      g.addColorStop(0, 'rgba(12,10,8,1.0)'); g.addColorStop(0.42, 'rgba(45,40,36,0.9)'); g.addColorStop(0.5, 'rgba(205,200,188,0.55)'); g.addColorStop(0.75, 'rgba(190,185,172,0.2)'); g.addColorStop(1, 'rgba(190,185,172,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, Math.PI * 2); ctx.fill();
      for (let s = 0; s < 4; s++) { const a = rng.range(0, Math.PI * 2), l = rng.range(r, r * 2.2); ctx.strokeStyle = 'rgba(30,25,20,0.35)'; ctx.lineWidth = rng.range(0.4, 1.0); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke(); }
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Faded road-paint stripe texture (alpha) for lane markings and crosswalks. */
export function makePaintTexture(rng: Rng): THREE.CanvasTexture {
  const W = 256, H = 64;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(235,230,215,0.85)'; ctx.fillRect(0, 8, W, H - 16);
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(0,0,0,${rng.range(0.2, 0.9)})`; ctx.fillRect(rng.range(0, W), rng.range(0, H), rng.range(1, 6), rng.range(1, 4)); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Distant-building facade: plaster tone with a grid of dark windows (one 4.2 m tile = 2 windows × 1 storey). */
export function makeFacadeTexture(rng: Rng): THREE.CanvasTexture {
  const W = 512, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#a89f92'; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 1500; i++) { ctx.fillStyle = `rgba(${rng.int(40, 90)},${rng.int(35, 80)},${rng.int(30, 70)},${rng.range(0.03, 0.1)})`; ctx.fillRect(rng.range(0, W), rng.range(0, H), rng.range(4, 40), rng.range(4, 40)); }
  // storey band (slab line) + two windows per tile
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, H * 0.86, W, H * 0.04);
  for (const cx of [W * 0.27, W * 0.73]) {
    const ww = W * 0.22, wh = H * 0.36, x = cx - ww / 2, y = H * 0.3;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - 6, y - 6, ww + 12, wh + 12);
    ctx.fillStyle = rng.next() < 0.3 ? '#1a1a1c' : '#2a2c30'; ctx.fillRect(x, y, ww, wh);
    ctx.fillStyle = 'rgba(200,200,205,0.25)'; ctx.fillRect(x + 4, y + 4, ww * 0.4, wh * 0.3);
    if (rng.next() < 0.5) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x - 12, y + wh - 8, ww + 24, 10); }
  }
  grunge(ctx, W, H, rng, 1.0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}


// ------------------------------------------------------------------------------------------ decal atlas
export const DECAL = { pocks3: 0, pocks6: 1, pocks10: 2, shell: 3, streak: 4, soot: 5, grime: 6, crack: 7, dust: 8, track: 9, oil: 10, drip: 11, boots: 12, ripple: 13 } as const;
export type DecalSlot = (typeof DECAL)[keyof typeof DECAL];
/** uv rect of a decal slot in the 4x4 atlas: [u0, v0, u1, v1] */
export function decalUv(slot: number): [number, number, number, number] {
  const c = slot % 4, r = Math.floor(slot / 4);
  return [c / 4, 1 - (r + 1) / 4, (c + 1) / 4, 1 - r / 4];
}

function drawPocks(ctx: CanvasRenderingContext2D, rng: Rng, n: number, spread: number): void {
  for (let k = 0; k < n; k++) {
    const x = 128 + rng.gauss() * spread, y = 128 + rng.gauss() * spread, r = rng.range(4, 9);
    // chipped plaster halo (light), crater (dark), spall lines
    const halo = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 2.4);
    halo.addColorStop(0, 'rgba(206,199,186,0.3)'); halo.addColorStop(0.45, 'rgba(198,191,178,0.16)'); halo.addColorStop(1, 'rgba(196,190,178,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, Math.PI * 2); ctx.fill();
    // a few chipped flakes rather than a clean ring
    for (let f = 0; f < 3; f++) { const a = rng.range(0, 6.3), d2 = rng.range(r * 0.9, r * 2.0); ctx.fillStyle = `rgba(210,203,190,${rng.range(0.15, 0.4)})`; ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * d2, y + Math.sin(a) * d2, rng.range(1.5, 4), rng.range(1.5, 4), a, 0, Math.PI * 2); ctx.fill(); }
    const g = ctx.createRadialGradient(x - r * 0.25, y - r * 0.25, 0, x, y, r);
    g.addColorStop(0, 'rgba(10,9,8,0.95)'); g.addColorStop(0.5, 'rgba(38,34,30,0.85)'); g.addColorStop(0.82, 'rgba(86,79,71,0.45)'); g.addColorStop(1, 'rgba(96,90,82,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    for (let s2 = 0; s2 < 5; s2++) { const a = rng.range(0, Math.PI * 2), l = rng.range(r * 1.2, r * 2.8); ctx.strokeStyle = `rgba(30,25,20,${rng.range(0.2, 0.45)})`; ctx.lineWidth = rng.range(0.5, 1.4); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke(); }
  }
}

/**
 * 4x4 decal sheet (alpha in A), 256 px per slot. See DECAL for the slot map. Slots are authored so that
 * "up" in the texture is +y on a wall; ground decals are rotated by the placer.
 */
export function makeDecalAtlas(rng: Rng): THREE.CanvasTexture {
  const W = 1024, H = 1024, S = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  const at = (slot: number, fn: () => void) => { ctx.save(); ctx.translate((slot % 4) * S, Math.floor(slot / 4) * S); ctx.beginPath(); ctx.rect(0, 0, S, S); ctx.clip(); fn(); ctx.restore(); };
  at(DECAL.pocks3, () => drawPocks(ctx, rng, 3, 30));
  at(DECAL.pocks6, () => drawPocks(ctx, rng, 6, 42));
  at(DECAL.pocks10, () => drawPocks(ctx, rng, 11, 48));
  at(DECAL.shell, () => {
    // shell hole: chipped ring + dark crater + radial cracks
    const cx = 128, cy = 128;
    const ring = ctx.createRadialGradient(cx, cy, 40, cx, cy, 110);
    ring.addColorStop(0, 'rgba(210,203,190,0.85)'); ring.addColorStop(0.45, 'rgba(200,193,180,0.45)'); ring.addColorStop(1, 'rgba(200,193,180,0)');
    ctx.fillStyle = ring; ctx.beginPath(); ctx.arc(cx, cy, 110, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    for (let k = 0; k < 22; k++) { const a = (k / 22) * Math.PI * 2, r = 46 + rng.range(-10, 12); const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.closePath();
    const crater = ctx.createRadialGradient(cx - 8, cy - 8, 4, cx, cy, 56);
    crater.addColorStop(0, 'rgba(5,4,4,1)'); crater.addColorStop(0.6, 'rgba(28,25,22,0.95)'); crater.addColorStop(1, 'rgba(60,55,50,0.6)');
    ctx.fillStyle = crater; ctx.fill();
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * Math.PI * 2 + rng.range(-0.2, 0.2); let r = 44, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      ctx.beginPath(); ctx.moveTo(x, y);
      const len = rng.range(50, 90);
      for (let step = 0; step < 6; step++) { r += len / 6; const aa = a + rng.range(-0.25, 0.25); x = cx + Math.cos(aa) * r; y = cy + Math.sin(aa) * r; ctx.lineTo(x, y); }
      ctx.strokeStyle = `rgba(20,16,14,${rng.range(0.45, 0.8)})`; ctx.lineWidth = rng.range(1.5, 3.2); ctx.stroke();
    }
    drawPocks(ctx, rng, 5, 70);
  });
  at(DECAL.streak, () => {
    // rain/rust streaks running down from a sill: dense at the top, breaking into separate runs
    const top = ctx.createLinearGradient(0, 0, 0, 50); top.addColorStop(0, 'rgba(35,28,22,0.55)'); top.addColorStop(1, 'rgba(35,28,22,0)');
    ctx.fillStyle = top; ctx.fillRect(0, 0, S, 50);
    for (let i = 0; i < 16; i++) {
      const x = rng.range(8, S - 8), w = rng.range(2, 9), len = rng.range(70, 250), a = rng.range(0.25, 0.55);
      const g = ctx.createLinearGradient(0, 0, 0, len); g.addColorStop(0, `rgba(40,32,26,${a})`); g.addColorStop(0.6, `rgba(50,40,32,${a * 0.5})`); g.addColorStop(1, 'rgba(50,40,32,0)');
      ctx.fillStyle = g; ctx.fillRect(x, 0, w, len);
    }
  });
  at(DECAL.soot, () => {
    // burn fan above an opening: opaque at the bottom centre, fading up and out
    const g = ctx.createRadialGradient(128, 250, 10, 128, 210, 165);
    g.addColorStop(0, 'rgba(14,12,10,0.5)'); g.addColorStop(0.4, 'rgba(20,17,14,0.28)'); g.addColorStop(1, 'rgba(26,22,18,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) { const x = 128 + rng.gauss() * 52, y = 60 + rng.range(0, 190); ctx.fillStyle = `rgba(16,13,11,${rng.range(0.03, 0.1)})`; ctx.beginPath(); ctx.ellipse(x, y, rng.range(10, 40), rng.range(20, 60), 0, 0, Math.PI * 2); ctx.fill(); }
  });
  at(DECAL.grime, () => {
    // wall-base grime: opaque at the bottom edge, mottled fade upward, splash speckles
    const g = ctx.createLinearGradient(0, S, 0, 0); g.addColorStop(0, 'rgba(48,39,30,0.5)'); g.addColorStop(0.3, 'rgba(52,42,33,0.26)'); g.addColorStop(1, 'rgba(60,50,40,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 90; i++) { const y = S - Math.abs(rng.gauss()) * 70; ctx.fillStyle = `rgba(40,32,25,${rng.range(0.08, 0.3)})`; ctx.beginPath(); ctx.ellipse(rng.range(0, S), y, rng.range(6, 40), rng.range(4, 14), 0, 0, Math.PI * 2); ctx.fill(); }
    for (let i = 0; i < 300; i++) ctx.fillRect(rng.range(0, S), S - Math.abs(rng.gauss()) * 90, rng.range(1, 3), rng.range(1, 3));
  });
  at(DECAL.crack, () => {
    const trunk = (x: number, y: number, ang: number, len: number, w: number, depth: number) => {
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) { ang += rng.range(-0.5, 0.5); x += Math.cos(ang) * len / 8; y += Math.sin(ang) * len / 8; ctx.lineTo(x, y); if (depth > 0 && rng.next() < 0.3) trunk(x, y, ang + rng.pick([-1, 1]) * rng.range(0.5, 1.2), len * 0.45, w * 0.6, depth - 1); }
      ctx.strokeStyle = `rgba(18,15,13,${0.75 * w / 3})`; ctx.lineWidth = w; ctx.stroke();
    };
    trunk(128 + rng.range(-20, 20), 4, Math.PI / 2 + rng.range(-0.3, 0.3), 240, 3, 2);
  });
  at(DECAL.dust, () => {
    const g = ctx.createRadialGradient(128, 128, 5, 128, 128, 120);
    g.addColorStop(0, 'rgba(205,195,175,0.55)'); g.addColorStop(0.5, 'rgba(200,190,170,0.3)'); g.addColorStop(1, 'rgba(200,190,170,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    // One warm hue modulated by value. Independent R/G/B ranges made every third speck a saturated pink or
    // mint fleck, which is the "pastel confetti litter" scattered over the road in world_intersection.
    for (let i = 0; i < 500; i++) {
      const r = Math.abs(rng.gauss()) * 55, a = rng.range(0, 6.3), v = rng.range(0.62, 1.0);
      ctx.fillStyle = `rgba(${Math.round(214 * v)},${Math.round(203 * v)},${Math.round(182 * v)},${rng.range(0.3, 0.9)})`;
      ctx.fillRect(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, rng.range(1, 3), rng.range(1, 3));
    }
  });
  at(DECAL.track, () => {
    // tyre tracks: two bands with tread dashes, along v
    for (const x of [62, 154]) {
      const g = ctx.createLinearGradient(x, 0, x + 40, 0); g.addColorStop(0, 'rgba(30,26,22,0)'); g.addColorStop(0.3, 'rgba(30,26,22,0.4)'); g.addColorStop(0.7, 'rgba(30,26,22,0.4)'); g.addColorStop(1, 'rgba(30,26,22,0)');
      ctx.fillStyle = g; ctx.fillRect(x, 0, 40, S);
      ctx.fillStyle = 'rgba(30,26,22,0.35)'; for (let y = 0; y < S; y += 14) ctx.fillRect(x + 6, y, 28, 7);
    }
  });
  at(DECAL.oil, () => {
    ctx.beginPath();
    for (let k = 0; k < 18; k++) { const a = (k / 18) * Math.PI * 2, r = 70 + rng.range(-30, 30); const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r * 0.8; if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.closePath();
    const g = ctx.createRadialGradient(128, 128, 5, 128, 128, 100); g.addColorStop(0, 'rgba(8,8,9,0.9)'); g.addColorStop(0.7, 'rgba(12,12,14,0.75)'); g.addColorStop(1, 'rgba(15,15,18,0)');
    ctx.fillStyle = g; ctx.fill();
  });
  at(DECAL.drip, () => {
    // single long rust drip (under AC units / brackets)
    for (let i = 0; i < 5; i++) { const x = 100 + rng.range(0, 56), w = rng.range(4, 14), len = rng.range(120, 256); const g = ctx.createLinearGradient(0, 0, 0, len); g.addColorStop(0, 'rgba(110,60,30,0.7)'); g.addColorStop(1, 'rgba(90,50,25,0)'); ctx.fillStyle = g; ctx.fillRect(x, 0, w, len); }
  });
  at(DECAL.boots, () => {
    // a trail of lugged boot prints climbing the tile (placed as a long strip along a path)
    for (let i = 0; i < 5; i++) {
      const y = 18 + i * 50 + rng.range(-6, 6);
      const x = 128 + (i % 2 ? 1 : -1) * rng.range(14, 26);
      const a = rng.range(-0.16, 0.16);
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      const dark = `rgba(46,38,30,${rng.range(0.42, 0.62)})`;
      // heel
      ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(0, 14, 11, 12, 0, 0, Math.PI * 2); ctx.fill();
      // forefoot
      ctx.beginPath(); ctx.ellipse(0, -10, 13, 18, 0, 0, Math.PI * 2); ctx.fill();
      // lugs: bright ridges where the sole pressed the dust aside
      ctx.fillStyle = `rgba(214,206,190,${rng.range(0.2, 0.34)})`;
      for (let k = 0; k < 6; k++) ctx.fillRect(-11, -26 + k * 6, 22, 2.4);
      for (let k = 0; k < 3; k++) ctx.fillRect(-9, 8 + k * 6, 18, 2.2);
      ctx.restore();
    }
  });
  at(DECAL.ripple, () => {
    // wind ripples in loose sand: shallow parallel crests, each with a lit and a shaded side
    for (let i = 0; i < 26; i++) {
      const y = i * 10 + rng.range(-3, 3);
      ctx.beginPath();
      for (let x = -10; x <= S + 10; x += 16) { const yy = y + Math.sin(x * 0.035 + i) * 5 + rng.range(-2, 2); if (x <= -10) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
      ctx.strokeStyle = `rgba(96,84,66,${rng.range(0.10, 0.2)})`; ctx.lineWidth = rng.range(2, 4); ctx.stroke();
      ctx.translate(0, -2.5);
      ctx.strokeStyle = `rgba(236,226,206,${rng.range(0.08, 0.16)})`; ctx.lineWidth = rng.range(1.5, 3); ctx.stroke();
      ctx.translate(0, 2.5);
    }
  });

  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------------------------------------ distant facades
/**
 * 4x4 atlas of distant-building facade cells (512 px each, one cell = one storey x one window bay ≈ 3.4 m).
 * Rows are facade styles; columns are: 0 window, 1 broken window, 2 blank wall, 3 ground floor.
 * Row 3 is special: 12 dark roof, 13 light roof, 14 brick blank, 15 brick window.
 */
export const FACADE_STYLES = 3;
export const FACADE_CELL = { window: 0, broken: 1, blank: 2, ground: 3 } as const;
export const FACADE_ROOF_DARK = 12, FACADE_ROOF_LIGHT = 13, FACADE_BRICK_BLANK = 14, FACADE_BRICK_WINDOW = 15;
export function facadeUv(cell: number): [number, number, number, number] {
  const c = cell % 4, r = Math.floor(cell / 4);
  const pad = 0.004;
  return [c / 4 + pad, 1 - (r + 1) / 4 + pad, (c + 1) / 4 - pad, 1 - r / 4 - pad];
}

export function makeFacadeAtlas(rng: Rng): THREE.CanvasTexture {
  const W = 2048, S = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = W;
  const ctx = c.getContext('2d')!;
  const at = (cell: number, fn: () => void) => { ctx.save(); ctx.translate((cell % 4) * S, Math.floor(cell / 4) * S); ctx.beginPath(); ctx.rect(0, 0, S, S); ctx.clip(); fn(); ctx.restore(); };
  const wallBase = (color: string, tone: number, seams: 'panel' | 'plaster' | 'none') => {
    ctx.fillStyle = color; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 700; i++) { const v = rng.range(0.35, 1.0); ctx.fillStyle = `rgba(${Math.round(66 * v)},${Math.round(57 * v)},${Math.round(47 * v)},${rng.range(0.02, 0.08) * tone})`; ctx.fillRect(rng.range(0, S), rng.range(0, S), rng.range(3, 60), rng.range(3, 60)); }
    for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(255,250,240,${rng.range(0.02, 0.06)})`; ctx.fillRect(rng.range(0, S), rng.range(0, S), rng.range(3, 40), rng.range(3, 40)); }
    if (seams === 'panel') { ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(0, S * 0.5 - 2, S, 4); ctx.fillRect(S * 0.5 - 2, 0, 4, S); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(0, S * 0.5 + 2, S, 2); }
    // storey line: slab shadow band at the bottom of every cell, light top edge
    ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fillRect(0, S - 16, S, 16);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, S - 34, S, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(0, 0, S, 6);
    // streaks from the top (rain), dust at the bottom
    for (let i = 0; i < 12; i++) { const x = rng.range(0, S), len = rng.range(S * 0.2, S * 0.9); const g = ctx.createLinearGradient(x, 0, x, len); g.addColorStop(0, `rgba(30,25,20,${rng.range(0.08, 0.22)})`); g.addColorStop(1, 'rgba(30,25,20,0)'); ctx.fillStyle = g; ctx.fillRect(x, 0, rng.range(2, 10), len); }
  };
  const window = (x: number, y: number, w: number, h: number, kind: 'pane' | 'broken' | 'glass', frame: string) => {
    // reveal shadow (recess) → frame → pane with a sky reflection gradient → sill
    ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(x - 12, y - 12, w + 24, h + 24);
    ctx.fillStyle = frame; ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
    if (kind === 'broken') {
      ctx.fillStyle = '#0c0c0e'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(200,196,186,0.5)'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w * 0.3, y); ctx.lineTo(x + w * 0.1, y + h * 0.4); ctx.closePath(); ctx.fill();
      const soot = ctx.createLinearGradient(0, y - 90, 0, y); soot.addColorStop(0, 'rgba(10,8,6,0)'); soot.addColorStop(1, 'rgba(10,8,6,0.75)'); ctx.fillStyle = soot; ctx.fillRect(x - 30, y - 90, w + 60, 90);
    } else {
      const g = ctx.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, kind === 'glass' ? '#5e6a74' : '#2a2e34'); g.addColorStop(0.5, kind === 'glass' ? '#3a4249' : '#1c1f24'); g.addColorStop(1, kind === 'glass' ? '#6f7a82' : '#30343a');
      ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(x + 4, y + 4, w * 0.42, h * 0.3);
      ctx.fillStyle = frame; ctx.fillRect(x + w / 2 - 3, y, 6, h); if (h > 140) ctx.fillRect(x, y + h * 0.42, w, 6);
      if (rng.next() < 0.35) { ctx.fillStyle = rng.pick(['rgba(150,136,106,0.8)', 'rgba(120,72,56,0.75)', 'rgba(168,166,158,0.75)']); ctx.fillRect(x + 2, y + 2, w * rng.range(0.25, 0.5), h - 4); }
    }
    ctx.fillStyle = 'rgba(235,230,220,0.9)'; ctx.fillRect(x - 14, y + h + 4, w + 28, 12);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - 14, y + h + 16, w + 28, 10);
    const drip = ctx.createLinearGradient(0, y + h + 20, 0, y + h + 110); drip.addColorStop(0, 'rgba(40,32,26,0.35)'); drip.addColorStop(1, 'rgba(40,32,26,0)'); ctx.fillStyle = drip; ctx.fillRect(x - 6, y + h + 20, w + 12, 90);
  };
  const balcony = (x: number, y: number, w: number, h: number) => {
    // slab + railing over the lower part of the bay, dark shadow under the slab
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x - 30, y + h * 0.55, w + 60, 26);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 24, y + h * 0.1, w + 48, h * 0.45);
    ctx.fillStyle = '#c8c0b0'; ctx.fillRect(x - 30, y + h * 0.5, w + 60, 12);
    ctx.fillStyle = '#3a3a3c'; for (let bx = x - 24; bx <= x + w + 24; bx += 12) ctx.fillRect(bx, y + h * 0.1, 3, h * 0.42);
    ctx.fillRect(x - 26, y + h * 0.1, w + 52, 4);
    if (rng.next() < 0.6) { ctx.fillStyle = rng.pick(['#a86d5a', '#6b7f8f', '#b8a888']); ctx.fillRect(x + rng.range(0, w * 0.4), y + h * 0.15, w * 0.35, h * 0.3); }
  };
  const shopfront = (base: string, frame: string, awning: boolean) => {
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(40, 120, S - 80, S - 160);
    ctx.fillStyle = frame; ctx.fillRect(36, 116, S - 72, 12);
    // shutter (horizontal ribs) or dark open interior
    if (rng.next() < 0.6) { for (let y = 130; y < S - 44; y += 14) { ctx.fillStyle = (y / 14) % 2 ? '#7e8288' : '#6b6f75'; ctx.fillRect(44, y, S - 88, 14); } }
    else { ctx.fillStyle = '#0e0d0c'; ctx.fillRect(44, 128, S - 88, S - 172); }
    ctx.fillStyle = rng.pick(['#7a2a24', '#1d5a3a', '#2a3a55', '#c9a12a']); ctx.fillRect(28, 60, S - 56, 56);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; for (let i = 0; i < 5; i++) ctx.fillRect(48 + i * 90, 78, rng.range(30, 70), 18);
    if (awning) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 100, S, 40); ctx.fillStyle = '#b8352b'; ctx.fillRect(20, 96, S - 40, 26); ctx.fillStyle = '#e8e0cc'; for (let x = 20; x < S - 40; x += 60) ctx.fillRect(x, 96, 30, 26); }
    void base;
  };
  // style 0: soviet concrete panel block
  const s0 = '#a19a8e', f0 = '#d8d3c8';
  at(0, () => { wallBase(s0, 1, 'panel'); window(120, 120, 272, 250, 'pane', f0); });
  at(1, () => { wallBase(s0, 1, 'panel'); window(120, 120, 272, 250, 'broken', f0); });
  at(2, () => { wallBase(s0, 1, 'panel'); });
  at(3, () => { wallBase(s0, 1, 'panel'); shopfront(s0, '#55534f', false); });
  // style 1: middle-eastern plaster with shutters / balconies
  const s1 = '#cbb798', f1 = '#4a5a58';
  at(4, () => { wallBase(s1, 1.1, 'plaster'); window(150, 110, 212, 270, 'pane', f1); });
  at(5, () => { wallBase(s1, 1.1, 'plaster'); window(150, 110, 212, 270, 'pane', f1); balcony(150, 110, 212, 270); });
  at(6, () => { wallBase(s1, 1.1, 'plaster'); });
  at(7, () => { wallBase(s1, 1.1, 'plaster'); shopfront(s1, '#4a5a58', true); });
  // style 2: office / hotel tower — ribbon glazing over dark spandrels
  const s2 = '#767a80', f2 = '#2b2e33';
  at(8, () => { wallBase(s2, 0.8, 'none'); window(20, 90, 472, 300, 'glass', f2); ctx.fillStyle = f2; for (let x = 20; x < 492; x += 118) ctx.fillRect(x, 90, 8, 300); });
  at(9, () => { wallBase(s2, 0.8, 'none'); window(20, 90, 472, 300, 'broken', f2); });
  at(10, () => { wallBase(s2, 0.8, 'none'); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 200, S, 60); });
  at(11, () => { wallBase(s2, 0.8, 'none'); window(20, 60, 472, 380, 'glass', f2); ctx.fillStyle = f2; for (let x = 20; x < 492; x += 118) ctx.fillRect(x, 60, 8, 380); });
  // roofs
  at(FACADE_ROOF_DARK, () => { ctx.fillStyle = '#4c4a46'; ctx.fillRect(0, 0, S, S); for (let i = 0; i < 2500; i++) { const v = rng.range(0.42, 1.0); ctx.fillStyle = `rgba(${Math.round(112 * v)},${Math.round(106 * v)},${Math.round(96 * v)},${rng.range(0.1, 0.5)})`; ctx.fillRect(rng.range(0, S), rng.range(0, S), rng.range(1, 5), rng.range(1, 5)); } for (let i = 0; i < 8; i++) { const g = ctx.createRadialGradient(rng.range(0, S), rng.range(0, S), 0, S / 2, S / 2, rng.range(60, 200)); g.addColorStop(0, 'rgba(20,20,22,0.35)'); g.addColorStop(1, 'rgba(20,20,22,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, S, S); } });
  at(FACADE_ROOF_LIGHT, () => { ctx.fillStyle = '#8d867a'; ctx.fillRect(0, 0, S, S); for (let i = 0; i < 1800; i++) { const v = rng.range(0.45, 1.0); ctx.fillStyle = `rgba(${Math.round(134 * v)},${Math.round(124 * v)},${Math.round(114 * v)},${rng.range(0.08, 0.35)})`; ctx.fillRect(rng.range(0, S), rng.range(0, S), rng.range(2, 12), rng.range(2, 12)); } grunge(ctx, S, S, rng, 1.5, false); });
  // brick
  /**
   * Brick course for the distant blocks.
   *
   * The old course was 40 px wide in a 512 px cell (512/40 = 12.8), so the right-hand column was cut mid-brick
   * and every cell boundary showed as a hard vertical line — that grid, plus grunge's repeated bullet holes at
   * the same spot in every stamped cell, is what round 3 read as "a 4x3 quad grid with an 8 glyph printed at
   * each panel corner". 32 px divides 512 exactly, so the pattern is now seamless across cells in both axes.
   */
  const brick = () => {
    ctx.fillStyle = '#8a4a38'; ctx.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 16) for (let x = ((y / 16) % 2) * 16 - 16; x < S; x += 32) { const v = rng.range(0.78, 1.12); ctx.fillStyle = `rgb(${Math.round(148 * v)},${Math.round(74 * v)},${Math.round(55 * v)})`; ctx.fillRect(x + 1, y + 1, 30, 14); }
    grunge(ctx, S, S, rng, 1.2, false);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, S - 14, S, 14);
  };
  at(FACADE_BRICK_BLANK, () => { brick(); });
  at(FACADE_BRICK_WINDOW, () => { brick(); window(140, 100, 232, 250, rng.next() < 0.5 ? 'pane' : 'broken', '#d0c8b8'); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/**
 * Cracked automotive glass (one 512² tile, alpha = pane opacity).
 *
 * A wreck's windshield is not a hole and not a mirror: it is a milky laminated pane held together by its
 * interlayer, with a radial impact star, a spider web of secondary cracks and a few missing corners. Used by
 * the vehicle wrecks so the windshield frame reads as glass instead of a black void.
 */
export function makeGlassCrackTexture(rng: Rng): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const ctx = c.getContext('2d')!;
  // base pane: faintly milky, dirtier toward the edges
  ctx.fillStyle = 'rgba(226,232,236,0.30)'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 220; i++) { ctx.fillStyle = `rgba(${rng.int(150, 200)},${rng.int(150, 200)},${rng.int(140, 190)},${rng.range(0.02, 0.09)})`; ctx.fillRect(rng.range(0, S), rng.range(0, S), rng.range(8, 70), rng.range(8, 70)); }
  const edge = ctx.createRadialGradient(S / 2, S / 2, S * 0.25, S / 2, S / 2, S * 0.72);
  edge.addColorStop(0, 'rgba(120,120,110,0)'); edge.addColorStop(1, 'rgba(120,120,110,0.35)');
  ctx.fillStyle = edge; ctx.fillRect(0, 0, S, S);
  // impact stars: radial spokes with concentric web rings
  ctx.lineCap = 'round';
  for (let s = 0; s < 2; s++) {
    const ox = rng.range(S * 0.25, S * 0.75), oy = rng.range(S * 0.25, S * 0.75);
    const spokes = rng.int(9, 16), reach = rng.range(S * 0.28, S * 0.55);
    const ends: [number, number][] = [];
    for (let k = 0; k < spokes; k++) {
      const a = (k / spokes) * Math.PI * 2 + rng.range(-0.14, 0.14);
      const len = reach * rng.range(0.55, 1.25);
      ctx.beginPath(); ctx.moveTo(ox, oy);
      let px = ox, py = oy;
      const steps = 5;
      for (let t = 1; t <= steps; t++) { px = ox + Math.cos(a) * len * (t / steps) + rng.range(-6, 6); py = oy + Math.sin(a) * len * (t / steps) + rng.range(-6, 6); ctx.lineTo(px, py); }
      ends.push([px, py]);
      ctx.strokeStyle = `rgba(255,255,255,${rng.range(0.5, 0.9)})`; ctx.lineWidth = rng.range(1.2, 3.2); ctx.stroke();
      ctx.strokeStyle = 'rgba(40,44,48,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    }
    for (let ring = 1; ring <= 3; ring++) {
      const f = ring / 4;
      ctx.beginPath();
      for (let k = 0; k <= ends.length; k++) { const [ex, ey] = ends[k % ends.length]; const x = ox + (ex - ox) * f + rng.range(-4, 4), y = oy + (ey - oy) * f + rng.range(-4, 4); if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.strokeStyle = `rgba(255,255,255,${rng.range(0.3, 0.6)})`; ctx.lineWidth = rng.range(0.8, 2.0); ctx.stroke();
    }
    // pulverised centre
    const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, rng.range(14, 34));
    g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(ox - 40, oy - 40, 80, 80);
  }
  // a few long stress cracks running off the edges
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    let px = rng.range(0, S), py = rng.next() < 0.5 ? 0 : S;
    ctx.moveTo(px, py);
    const a = rng.range(0, Math.PI * 2);
    for (let t = 0; t < 6; t++) { px += Math.cos(a) * rng.range(30, 90) + rng.range(-20, 20); py += Math.sin(a) * rng.range(30, 90) + rng.range(-20, 20); ctx.lineTo(px, py); }
    ctx.strokeStyle = `rgba(255,255,255,${rng.range(0.25, 0.55)})`; ctx.lineWidth = rng.range(0.8, 1.8); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
