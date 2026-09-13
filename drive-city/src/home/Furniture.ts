import { Parts, box, cyl, lathe, tube, type V3 } from '../city/landmarks/kit/geo';

/**
 * 我家 · the soft furnishings.
 *
 * The villa was architecture with nothing in it: white boxes standing about on a grey plane, which
 * from inside read as an unlet office rather than somewhere a person lives. This is the kit that
 * dresses it - seating, beds, lamps, curtains, art, planting, the things on top of the things.
 *
 * Every piece is built **at the local origin, standing on y = 0**, and the caller places it with
 * `P.at(x, y, z, ry, () => …)`. That is what keeps Villa.ts a plan rather than a pile of
 * coordinates, and it is the only way a rotated chair is worth writing twice.
 *
 * What makes a box read as furniture, learned the hard way from the first pass:
 *   - Nothing is one box. A sofa is a dark plinth under separate seat and back cushions with gaps
 *     between them; a bed is a base, a mattress, a duvet with a folded-back band, two rows of
 *     pillows and a throw. The gaps and the tonal break are the whole effect.
 *   - Soft things are never flush with hard things: cushions inset, throws overhang, rugs run well
 *     past the furniture standing on them.
 *   - Nothing is unlit. Lamps and coves carry `vLight`, which is what the night pass glows.
 *
 * Material keys are plain strings from Villa.ts's palette, so this file imports nothing from it.
 */

const K = {
  wood: 'vWoodDark', timber: 'vTimberClad', white: 'vFabricWhite', tan: 'vFabricTan',
  velvet: 'vVelvet', sheer: 'vSheer', drape: 'vDrape', brass: 'vBrass', light: 'vLight',
  marble: 'vMarbleWhite', dark: 'vMarbleDark', metal: 'vLouvre', rug: 'vRug', leaf: 'vLeaf',
  art: 'vArt', mirror: 'vMirror', book: 'vBook', glass: 'vGlass', plaster: 'vPlaster',
  stone: 'vStoneWall', fire: 'vFire',
} as const;

const hash = (n: number): number => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// ------------------------------------------------------------------------------------ soft goods

/** A rug: a woven field with a darker border, so it reads as a rug and not as a painted rectangle. */
export function rug(P: Parts, w: number, d: number): void {
  const b = P.get(K.rug);
  box(b, 0, 0.012, 0, w, 0.024, d);
  // The border is the read: a plain quad on the floor disappears into it.
  const t = Math.min(w, d) * 0.07;
  // A woven border in the warm fabric tone. Drawn in the dark-wood key it read as a picture frame.
  for (const [sx, sz] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as [number, number][]) {
    box(P.get(K.tan), sx * (w / 2 - t / 2), 0.026, sz * (d / 2 - t / 2),
      sx ? t : w - t * 2, 0.006, sz ? t : d - t * 2);
  }
}

/** A cushion: a slightly domed pad, never a flat slab. */
export function cushion(P: Parts, key: string, w: number, h: number, d: number, ry = 0): void {
  const b = P.get(key);
  box(b, 0, h / 2, 0, w, h, d, { ry });
  box(b, 0, h * 0.92, 0, w * 0.86, h * 0.3, d * 0.86, { ry });
}

/** A throw blanket folded over the foot of a bed or the arm of a sofa. */
export function throwOver(P: Parts, key: string, w: number, d: number, drop: number): void {
  const b = P.get(key);
  box(b, 0, 0.03, 0, w, 0.06, d);
  for (const s of [-1, 1]) box(b, 0, -drop / 2 + 0.03, s * d / 2, w, drop, 0.05);
}

/**
 * Curtains down a glazed wall: sheer panels across it with a heavier drape at each end. The folds
 * are separate thin boxes at alternating depths - one flat panel reads as a wall, not as cloth.
 */
export function curtains(P: Parts, len: number, h: number, o: { sheer?: boolean; drapes?: boolean } = {}): void {
  const s = P.get(K.sheer), d = P.get(K.drape);
  box(P.get(K.metal), 0, h - 0.04, 0, len, 0.05, 0.06);
  if (o.sheer !== false) {
    const step = 0.34;
    for (let x = -len / 2 + step * 0.5; x < len / 2; x += step) {
      const f = (hash(x * 5.3) - 0.5) * 0.05;
      box(s, x, h / 2 - 0.05, f, step * 0.82, h - 0.1, 0.055, { faces: 'xXzZ' });
    }
  }
  if (o.drapes === false) return;
  for (const sx of [-1, 1]) {
    const cx = sx * (len / 2 - 0.42);
    for (let i = 0; i < 5; i++) {
      const x = cx + (i - 2) * 0.17;
      box(d, x, h / 2 - 0.04, 0.09 + (i % 2) * 0.05, 0.17, h - 0.08, 0.1);
    }
  }
}

// --------------------------------------------------------------------------------------- seating

/**
 * A sofa `w` long and `d` deep: dark plinth, separate seat cushions, tilted back cushions, arms,
 * and two throw cushions in an accent fabric.
 */
export function sofa(P: Parts, w: number, d: number, o: { key?: string; accent?: string; arms?: boolean } = {}): void {
  const key = o.key ?? K.white, accent = o.accent ?? K.velvet;
  const base = P.get(K.wood);
  box(base, 0, 0.09, 0, w - 0.1, 0.18, d - 0.08);
  const seats = Math.max(2, Math.round(w / 0.95));
  const sw = (w - 0.3) / seats;
  for (let i = 0; i < seats; i++) {
    const x = -w / 2 + 0.15 + sw * (i + 0.5);
    P.at(x, 0.18, 0.06, 0, () => cushion(P, key, sw - 0.04, 0.24, d - 0.32));
    // Back cushions sit proud of the frame and lean into it.
    P.at(x, 0.42, -d / 2 + 0.26, 0, () => cushion(P, key, sw - 0.06, 0.44, 0.26));
  }
  box(P.get(key), 0, 0.5, -d / 2 + 0.08, w, 0.64, 0.16);
  if (o.arms !== false) for (const s of [-1, 1]) {
    box(P.get(key), s * (w / 2 - 0.1), 0.4, 0, 0.2, 0.44, d - 0.1);
  }
  for (const s of [-1, 1]) {
    P.at(s * (w / 2 - 0.5), 0.42, -d / 2 + 0.42, s * 0.3, () => cushion(P, accent, 0.42, 0.14, 0.42));
  }
}

/** An armchair: the sofa's vocabulary at one seat, on slim legs. */
export function armchair(P: Parts, o: { key?: string } = {}): void {
  const key = o.key ?? K.velvet;
  const b = P.get(key);
  box(b, 0, 0.36, 0, 0.86, 0.16, 0.82);
  P.at(0, 0.44, 0.04, 0, () => cushion(P, key, 0.74, 0.16, 0.7));
  box(b, 0, 0.66, -0.36, 0.86, 0.62, 0.14);
  for (const s of [-1, 1]) box(b, s * 0.4, 0.5, 0, 0.1, 0.32, 0.8);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    cyl(P.get(K.brass), sx * 0.34, 0, sz * 0.32, 0.026, 0.022, 0.3, 6);
  }
}

/** A dining chair: upholstered seat and back on four legs. */
export function chair(P: Parts, o: { key?: string } = {}): void {
  const key = o.key ?? K.tan;
  box(P.get(key), 0, 0.45, 0, 0.46, 0.09, 0.46);
  box(P.get(key), 0, 0.72, -0.2, 0.44, 0.54, 0.07);
  const w = P.get(K.wood);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(w, sx * 0.19, 0.21, sz * 0.19, 0.045, 0.42, 0.045);
}

/** A bar stool for the kitchen island. */
export function stool(P: Parts, h = 0.68): void {
  box(P.get(K.tan), 0, h, 0, 0.38, 0.08, 0.36);
  box(P.get(K.tan), 0, h + 0.22, -0.15, 0.36, 0.36, 0.06);
  const m = P.get(K.metal);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(m, sx * 0.15, 0, sz * 0.14, 0.02, 0.018, h, 6);
  for (const sx of [-1, 1]) box(m, sx * 0.15, h * 0.32, 0, 0.025, 0.025, 0.3);
}

/** A long bench at the foot of a bed or in a hall. */
export function bench(P: Parts, w: number, d = 0.44, key: string = K.tan): void {
  box(P.get(key), 0, 0.42, 0, w, 0.16, d);
  for (const sx of [-1, 1]) cyl(P.get(K.brass), sx * (w / 2 - 0.12), 0, 0, 0.025, 0.025, 0.36, 6);
  for (const sx of [-1, 1]) box(P.get(K.brass), sx * (w / 2 - 0.12), 0.04, 0, 0.05, 0.04, d - 0.06);
}

// ------------------------------------------------------------------------------------- bedrooms

/**
 * A bed `w` x `len`, headboard against -z: upholstered channel-tufted headboard, mattress, duvet
 * with a folded-back band, two rows of pillows, and a throw across the foot.
 */
export function bed(P: Parts, w: number, len: number, o: { head?: string; linen?: string; accent?: string } = {}): void {
  const head = o.head ?? K.velvet, linen = o.linen ?? K.white, accent = o.accent ?? K.tan;
  const hb = P.get(head);
  // Headboard: vertical channels, not a slab.
  box(hb, 0, 0.7, -len / 2 - 0.12, w + 0.5, 1.4, 0.14);
  for (let x = -(w + 0.3) / 2; x <= (w + 0.3) / 2; x += 0.26) {
    box(hb, x, 0.7, -len / 2 - 0.03, 0.04, 1.36, 0.06);
  }
  box(P.get(K.wood), 0, 0.16, 0, w, 0.32, len);
  box(P.get(linen), 0, 0.44, 0, w + 0.06, 0.28, len);          // mattress
  // Duvet, stopping short of the pillows, with the turn-back at its head.
  box(P.get(linen), 0, 0.62, 0.14, w + 0.12, 0.12, len - 0.5);
  box(P.get(linen), 0, 0.68, -len / 2 + 0.62, w + 0.12, 0.1, 0.42);
  for (const s of [-1, 1]) {
    P.at(s * w * 0.24, 0.58, -len / 2 + 0.3, 0, () => cushion(P, linen, w * 0.44, 0.16, 0.36));
    P.at(s * w * 0.24, 0.7, -len / 2 + 0.44, 0, () => cushion(P, linen, w * 0.4, 0.14, 0.3));
    P.at(s * w * 0.2, 0.8, -len / 2 + 0.56, 0, () => cushion(P, accent, 0.36, 0.12, 0.26));
  }
  P.at(0, 0.66, len / 2 - 0.5, 0, () => throwOver(P, accent, w + 0.16, 0.7, 0.4));
}

/** A nightstand with a lamp and a book on it. */
export function nightstand(P: Parts, o: { lamp?: boolean } = {}): void {
  const w = P.get(K.wood);
  box(w, 0, 0.28, 0, 0.56, 0.56, 0.44);
  box(P.get(K.brass), 0, 0.34, 0.23, 0.18, 0.02, 0.02);
  box(P.get(K.brass), 0, 0.14, 0.23, 0.18, 0.02, 0.02);
  if (o.lamp !== false) P.at(0, 0.56, -0.02, 0, () => tableLamp(P, 0.17, 0.42));
  P.at(0.16, 0.56, 0.1, 0.4, () => bookStack(P, 2));
}

/** A wardrobe run: tall doors with slim handles. */
export function wardrobe(P: Parts, w: number, h = 2.4, d = 0.62): void {
  const k = P.get(K.wood);
  box(k, 0, h / 2 + 0.08, 0, w, h - 0.08, d);
  // A recessed plinth, and doors proud of the carcass with a real shadow gap between them:
  // flush panels 0.03 apart read as one slab from any distance.
  box(P.get(K.metal), 0, 0.04, 0, w - 0.08, 0.08, d - 0.06);
  const doors = Math.max(2, Math.round(w / 0.9));
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + (w / doors) * (i + 0.5);
    box(P.get(K.timber), x, h / 2 + 0.1, d / 2 + 0.02, w / doors - 0.09, h - 0.24, 0.04);
    box(P.get(K.brass), x + w / doors / 2 - 0.09, h * 0.54, d / 2 + 0.05, 0.02, 0.56, 0.02);
  }
}

/** An open dressing-room run: hanging rails with clothes, shelves, a drawer block. */
export function dressingRun(P: Parts, w: number, h = 2.4): void {
  const k = P.get(K.wood);
  box(k, 0, h / 2, -0.16, w, h, 0.08);
  for (const y of [h * 0.36, h * 0.78]) {
    cyl(P.get(K.brass), -w / 2 + 0.1, y, 0.12, 0.018, 0.018, w - 0.2, 6, { top: false });
    box(P.get(K.brass), 0, y, 0.12, w - 0.2, 0.036, 0.036);
    // Hanging clothes: alternating tones so a rail is not one long bar.
    for (let x = -w / 2 + 0.18; x < w / 2 - 0.1; x += 0.11) {
      const key = hash(x * 9.1 + y) > 0.5 ? K.tan : hash(x * 3.7) > 0.5 ? K.velvet : K.white;
      box(P.get(key), x, y - 0.34, 0.12, 0.09, 0.62, 0.28);
    }
  }
  box(k, 0, 0.3, 0.1, w * 0.5, 0.6, 0.5);
  for (let i = 0; i < 3; i++) box(P.get(K.brass), 0, 0.14 + i * 0.18, 0.36, w * 0.3, 0.015, 0.015);
}

// ----------------------------------------------------------------------------- tables and objects

/** A low table: thin top, slim frame, and whatever is styled on it. */
export function lowTable(P: Parts, w: number, d: number, h = 0.36, key = K.marble): void {
  box(P.get(key), 0, h, 0, w, 0.07, d);
  const m = P.get(K.metal);
  for (const sx of [-1, 1]) box(m, sx * (w / 2 - 0.1), h / 2, 0, 0.05, h, d - 0.16);
  box(m, 0, h * 0.3, 0, w - 0.3, 0.04, 0.04);
}

/** A dining or work table on four legs. */
export function table(P: Parts, w: number, d: number, h = 0.75): void {
  const k = P.get(K.wood);
  box(k, 0, h, 0, w, 0.08, d);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(k, sx * (w / 2 - 0.18), h / 2, sz * (d / 2 - 0.16), 0.09, h, 0.09);
}

/** A stack of books, spines in mixed tones. */
export function bookStack(P: Parts, n = 3): void {
  let y = 0;
  for (let i = 0; i < n; i++) {
    const h = 0.035 + hash(i * 4.1) * 0.02, w = 0.24 - i * 0.015;
    const key = [K.book, K.dark, K.tan, K.velvet][Math.floor(hash(i * 7.3) * 4)];
    box(P.get(key), 0, y + h / 2, 0, w, h, w * 0.72, { ry: (hash(i * 2.9) - 0.5) * 0.22 });
    y += h;
  }
}

/** A shelf of books: spines of mixed height and tone, with gaps. */
export function bookRow(P: Parts, len: number, h = 0.26): void {
  for (let x = -len / 2 + 0.03; x < len / 2 - 0.04; ) {
    if (hash(x * 11.3) > 0.86) { x += 0.06; continue; }
    const w = 0.022 + hash(x * 5.1) * 0.026, bh = h * (0.72 + hash(x * 3.3) * 0.28);
    const key = [K.book, K.dark, K.tan, K.velvet, K.white][Math.floor(hash(x * 17.7) * 5)];
    box(P.get(key), x + w / 2, bh / 2, 0, w, bh, 0.2);
    x += w + 0.004;
  }
}

/** A vase with stems, or a bowl when `h` is small. */
export function vase(P: Parts, r: number, h: number, o: { stems?: boolean } = {}): void {
  lathe(P.get(K.marble), [[r * 0.5, 0], [r, h * 0.3], [r * 0.82, h * 0.78], [r * 0.66, h], [r * 0.6, h]], 12);
  if (o.stems === false) return;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2, lean = 0.12 + hash(i * 6.1) * 0.16;
    tube(P.get(K.leaf), [
      [0, h * 0.9, 0], [Math.cos(a) * lean, h + 0.18, Math.sin(a) * lean],
      [Math.cos(a) * lean * 2.2, h + 0.34 + hash(i) * 0.12, Math.sin(a) * lean * 2.2],
    ] as V3[], 0.012, 4);
    leafBlob(P, Math.cos(a) * lean * 2.4, h + 0.4 + hash(i) * 0.12, Math.sin(a) * lean * 2.4, 0.1);
  }
}

/** A bowl of fruit / a tray: the thing that stops a table top being empty. */
export function bowl(P: Parts, r = 0.16): void {
  lathe(P.get(K.marble), [[r * 0.4, 0], [r, r * 0.5], [r * 0.94, r * 0.62]], 12);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    lathe(P.get(K.leaf), [[0, r * 0.4], [r * 0.26, r * 0.62], [0, r * 0.84]], 7, Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4);
  }
}

function leafBlob(P: Parts, x: number, y: number, z: number, r: number): void {
  lathe(P.get(K.leaf), [[0.01, y - r], [r * 0.8, y - r * 0.3], [r, y + r * 0.1], [r * 0.6, y + r * 0.6], [0.01, y + r]], 7, x, z);
}

/** A potted plant: pot, trunk, and a few leaf masses. Height `h` overall. */
export function plant(P: Parts, h: number, o: { pot?: string } = {}): void {
  const pr = h * 0.17;
  lathe(P.get(o.pot ?? K.plaster), [[pr * 0.7, 0], [pr, pr * 0.3], [pr * 0.94, pr * 1.5], [pr * 0.8, pr * 1.6]], 12);
  const th = h * 0.42;
  cyl(P.get('vTrunk'), 0, pr, 0, 0.035, 0.028, th, 5);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + hash(i) * 0.6, r = h * (0.16 + hash(i * 2.2) * 0.08);
    leafBlob(P, Math.cos(a) * h * 0.12, th + h * (0.22 + hash(i * 3.1) * 0.3), Math.sin(a) * h * 0.12, r);
  }
}

// ----------------------------------------------------------------------------------------- light

/** A table lamp: brass stem, fabric drum, and the lit disc under it that glows at night. */
export function tableLamp(P: Parts, r = 0.16, h = 0.44): void {
  cyl(P.get(K.brass), 0, 0, 0, r * 0.5, r * 0.36, 0.03, 10);
  cyl(P.get(K.brass), 0, 0.03, 0, 0.018, 0.018, h - r * 0.7, 6);
  cyl(P.get(K.white), 0, h - r * 0.7, 0, r * 0.86, r, r * 0.8, 12, { top: false });
  cyl(P.get(K.light), 0, h - r * 0.68, 0, r * 0.8, r * 0.8, 0.02, 12);
}

/** A floor lamp beside a chair. */
export function floorLamp(P: Parts, h = 1.55): void {
  cyl(P.get(K.brass), 0, 0, 0, 0.16, 0.13, 0.03, 12);
  cyl(P.get(K.brass), 0, 0.03, 0, 0.022, 0.022, h - 0.3, 6);
  cyl(P.get(K.white), 0, h - 0.3, 0, 0.19, 0.23, 0.28, 12, { top: false });
  cyl(P.get(K.light), 0, h - 0.28, 0, 0.18, 0.18, 0.02, 12);
}

/** A cluster pendant over a table: `n` brass rods dropping to lit globes. */
export function pendantCluster(P: Parts, drop: number, n = 7, spread = 0.55): void {
  box(P.get(K.metal), 0, -0.03, 0, spread * 1.6, 0.06, spread * 1.1);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, r = spread * (0.35 + hash(i * 3.7) * 0.65);
    const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.7, d = drop * (0.45 + hash(i * 5.3) * 0.55);
    cyl(P.get(K.brass), x, -d, z, 0.008, 0.008, d, 4);
    lathe(P.get(K.light), [[0.001, -d - 0.11], [0.075, -d - 0.055], [0.075, -d + 0.01], [0.001, -d + 0.05]], 9, x, z);
  }
}

/** A wall sconce either side of a mirror or a bed. */
export function sconce(P: Parts, h = 0.3): void {
  box(P.get(K.brass), 0, 0, 0, 0.06, 0.06, 0.06);
  cyl(P.get(K.brass), 0, 0, 0.03, 0.012, 0.012, 0.14, 5);
  cyl(P.get(K.white), 0, -h / 2, 0.16, 0.07, 0.085, h, 9, { top: false });
  cyl(P.get(K.light), 0, -h / 2 + 0.02, 0.16, 0.07, 0.07, 0.02, 9);
}

// --------------------------------------------------------------------------------- wall dressing

/**
 * A framed picture on a wall. Built in the xy plane facing +z, so the caller turns it with `P.at`:
 * a wall at +x wants ry = -PI/2, one at -x wants +PI/2, and a wall at -z wants PI.
 */
export function art(P: Parts, w: number, h: number, o: { frame?: string; tone?: number } = {}): void {
  const f = P.get(o.frame ?? K.brass);
  box(f, 0, 0, 0, w, h, 0.05);
  box(P.get(K.art), 0, 0, 0.03, w - 0.09, h - 0.09, 0.01, { faces: 'Z' });
}

/** A gallery wall: a run of frames at mixed sizes, the way people actually hang pictures. */
export function gallery(P: Parts, len: number, o: { rows?: number } = {}): void {
  const n = Math.max(3, Math.round(len / 0.85));
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (len / n) * (i + 0.5);
    const w = 0.34 + hash(i * 3.1) * 0.3, h = 0.4 + hash(i * 7.7) * 0.36;
    P.at(x, (hash(i * 5.5) - 0.5) * 0.3, 0, 0, () => art(P, w, h));
  }
}

/** A mirror with a slim frame. */
export function mirror(P: Parts, w: number, h: number): void {
  box(P.get(K.brass), 0, 0, 0, w, h, 0.04);
  box(P.get(K.mirror), 0, 0, 0.025, w - 0.07, h - 0.07, 0.01, { faces: 'Z' });
}

/** A wall-hung television. */
export function tv(P: Parts, w: number): void {
  box(P.get(K.metal), 0, 0, 0, w, w * 0.57, 0.06);
  box(P.get(K.dark), 0, 0, 0.035, w - 0.05, w * 0.57 - 0.05, 0.01, { faces: 'Z' });
}

// ------------------------------------------------------------------------------------- bathrooms

/**
 * A stack of folded towels. Folded, not rolled: `cyl` only builds upright cylinders and a rolled
 * towel would need a transform of its own for no gain at this size.
 */
export function towels(P: Parts, n = 3, w = 0.34): void {
  let y = 0;
  for (let i = 0; i < n; i++) {
    const h = 0.07 + hash(i * 3.3) * 0.02;
    box(P.get(i % 2 ? K.white : K.tan), (hash(i * 5.7) - 0.5) * 0.02, y + h / 2, 0, w, h, w * 0.62);
    y += h + 0.006;
  }
}

/** A freestanding basin on a stone plinth. */
export function basin(P: Parts, w = 0.62): void {
  lathe(P.get(K.marble), [[w * 0.36, 0.78], [w * 0.5, 0.86], [w * 0.47, 0.9], [w * 0.2, 0.86], [w * 0.18, 0.8]], 14);
  cyl(P.get(K.marble), 0, 0, 0, w * 0.2, w * 0.24, 0.78, 12);
  cyl(P.get(K.brass), 0, 0.9, -w * 0.34, 0.018, 0.018, 0.24, 6);
  box(P.get(K.brass), 0, 1.13, -w * 0.24, 0.03, 0.03, 0.2);
}

// ------------------------------------------------------------------------------------- outdoors

/** A sun lounger by the pool: slatted frame, a mattress, and a folded towel. */
export function lounger(P: Parts): void {
  const f = P.get(K.metal);
  for (const sx of [-1, 1]) {
    box(f, sx * 0.32, 0.16, 0, 0.05, 0.32, 1.9);
    for (const sz of [-1, 1]) box(f, sx * 0.32, 0.08, sz * 0.86, 0.06, 0.16, 0.06);
  }
  box(P.get(K.white), 0, 0.38, 0.12, 0.68, 0.14, 1.6);
  // The raised back is what makes it a lounger and not a bench.
  for (let i = 0; i < 5; i++) {
    box(P.get(K.white), 0, 0.42 + i * 0.09, -0.66 - i * 0.07, 0.68, 0.13, 0.2, { ry: 0 });
  }
  P.at(0, 0.46, 0.5, 0, () => throwOver(P, K.tan, 0.44, 0.3, 0.12));
}

/** A parasol. */
export function parasol(P: Parts, h = 2.4, r = 1.5): void {
  cyl(P.get(K.metal), 0, 0, 0, 0.05, 0.04, h, 8);
  lathe(P.get(K.white), [[0.04, h - 0.04], [r * 0.6, h - 0.26], [r, h - 0.5], [r, h - 0.44]], 12);
  cyl(P.get(K.metal), 0, 0, 0, 0.34, 0.3, 0.08, 12);
}

/** An outdoor dining table with a bowl on it. */
export function outdoorTable(P: Parts, w: number, d: number): void {
  box(P.get('vDeck'), 0, 0.74, 0, w, 0.09, d);
  const m = P.get(K.metal);
  for (const sx of [-1, 1]) {
    box(m, sx * (w / 2 - 0.3), 0.37, 0, 0.06, 0.74, d - 0.2);
    box(m, sx * (w / 2 - 0.3), 0.04, 0, 0.4, 0.08, d - 0.1);
  }
  box(m, 0, 0.36, 0, w - 0.8, 0.05, 0.05);
}

/** A fire pit: a stone ring with a low flame in it. */
export function firePit(P: Parts, r = 0.62): void {
  lathe(P.get(K.stone), [[r * 0.8, 0], [r, 0.06], [r, 0.42], [r * 0.86, 0.44], [r * 0.86, 0.1]], 16);
  cyl(P.get(K.dark), 0, 0.1, 0, r * 0.84, r * 0.84, 0.02, 16);
  cyl(P.get(K.fire), 0, 0.14, 0, r * 0.6, r * 0.3, 0.22, 12, { top: false });
}
