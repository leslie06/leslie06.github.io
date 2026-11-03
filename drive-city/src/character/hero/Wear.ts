import * as THREE from 'three';
import type { Look } from '../Body';
import type { Wear } from '../../game/Contracts';
import type { Hero } from './Hero';

/**
 * Dressing Chen Ye (2026-11-03, 南锣鼓巷 round 2, docs/gta-plan.md §12: 「服装帽子店：帽子、墨镜挂在陈野头部骨骼上，外套和裤子改颜
 * 色」). The cast model (public/models/characters/chenye.glb) has one suit mesh, jacket and jeans in one texture, and no
 * hats or glasses (MakeHuman's CC0 pack has none), so:
 *   hats and glasses  built here (lathe crowns, extruded peaks, tube frames) to his measured head and hung on its bone;
 *   jacket, trousers  the suit's texture repainted on a canvas through its mask (public/models/characters/
 *                     chenye.suitmask.png, scripts/characters/suitmask.mjs: the jacket red, the jeans green, the striped
 *                     shirt neither), each to its colour with its shading kept (luminance ratio);
 *   hair              the hair cards' colour (both passes: the cut one and the fringe).
 * Without the model (the crowd draws the player) the same wear goes onto the Look: cap colour, glasses, shirt, trousers.
 */

/**
 * Chen Ye's head in the model's bind pose (measured off the glb: `.scratch/nl2/head.mjs`), metres, +z his front:
 * the crown's centre at band height, the band's half widths, the eyes, the ears.
 */
const HEAD = { cx: 0, cy: 1.694, cz: 0.031, rx: 0.097, rz: 0.119, eyeY: 1.654, eyeX: 0.033, faceZ: 0.159, earX: 0.079, earZ: 0.03 };

const std = (color: THREE.ColorRepresentation, rough = 0.85, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });

/** A surface of revolution from (r, y) with r as a fraction of the band's ellipse, about the crown's centre. */
function crown(profile: [number, number][], segs = 28): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs);
  g.scale(HEAD.rx, 1, HEAD.rz);
  return g;
}

/** A knit or straw texture for a hat: ribs or a weave, drawn once. */
let knitTex: THREE.CanvasTexture | null = null, strawTex: THREE.CanvasTexture | null = null;
function knit(): THREE.CanvasTexture {
  if (knitTex) return knitTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
  for (let x = 0; x < 64; x += 4) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x, 0, 1.5, 64); }
  for (let y = 0; y < 64; y += 3) { g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, y, 64, 1); }
  knitTex = new THREE.CanvasTexture(c);
  knitTex.wrapS = knitTex.wrapT = THREE.RepeatWrapping; knitTex.repeat.set(10, 3); knitTex.colorSpace = THREE.SRGBColorSpace;
  return knitTex;
}
function straw(): THREE.CanvasTexture {
  if (strawTex) return strawTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 4) for (let x = 0; x < 64; x += 8) {
    g.fillStyle = `rgba(90,60,20,${0.12 + 0.1 * (((x + y) / 4) % 2)})`;
    g.fillRect(x + ((y / 4) % 2) * 4, y, 6, 3);
  }
  strawTex = new THREE.CanvasTexture(c);
  strawTex.wrapS = strawTex.wrapT = THREE.RepeatWrapping; strawTex.repeat.set(12, 4); strawTex.colorSpace = THREE.SRGBColorSpace;
  return strawTex;
}

/** The peak of a cap: a rounded tongue out from the band's front, curved down a little at its sides. */
function peak(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.085, 0); s.quadraticCurveTo(-0.09, 0.07, -0.05, 0.085); s.quadraticCurveTo(0, 0.1, 0.05, 0.085);
  s.quadraticCurveTo(0.09, 0.07, 0.085, 0); s.lineTo(-0.085, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: false, curveSegments: 8 });
  // lay it flat (shape y -> forward z), curve its sides down
  g.rotateX(Math.PI / 2);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) - 0.35 * p.getX(i) * p.getX(i) - 0.12 * p.getZ(i) * 0.4);
  g.computeVertexNormals();
  g.translate(0, 0.004, HEAD.rz - 0.01);
  return g;
}

/** A hat, in the model's bind space (the caller moves it into the head bone's). */
export function hatMesh(id: string, color: string): THREE.Object3D {
  // built about the crown's centre, so a tilt turns it there
  const o = new THREE.Group();
  o.name = `wear:hat:${id}`;
  o.position.set(HEAD.cx, HEAD.cy, HEAD.cz);
  const add = (g: THREE.BufferGeometry, m: THREE.Material) => { const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; o.add(mesh); return mesh; };
  if (id === 'cap') {
    const m = std(color, 0.8);
    add(crown([[1.0, -0.004], [1.0, 0.022], [0.97, 0.046], [0.88, 0.07], [0.72, 0.088], [0.48, 0.101], [0.2, 0.108], [0, 0.109]]), m);
    add(peak(), m);
    const b = add(new THREE.SphereGeometry(0.009, 8, 6), m); b.position.set(0, 0.109, 0);
    // the band tips back a little: lower at the nape
    o.rotation.x = -0.07;
  } else if (id === 'bucket') {
    const m = std(color, 0.9);
    m.side = THREE.DoubleSide;
    add(crown([[1.62, -0.034], [1.55, -0.03], [1.04, -0.002], [1.0, 0.01], [0.97, 0.07], [0.9, 0.095], [0.5, 0.104], [0, 0.106]]), m);
  } else if (id === 'beanie') {
    const m = std(color, 0.95, { map: knit() });
    add(crown([[1.05, -0.012], [1.07, 0.02], [1.05, 0.042], [1.0, 0.05], [0.96, 0.075], [0.84, 0.1], [0.62, 0.12], [0.3, 0.133], [0, 0.136]]), m);
    o.rotation.x = -0.12;
  } else {
    // straw: a wide brim and a low crown with a dark band
    const m = std(color, 0.8, { map: straw(), side: THREE.DoubleSide });
    add(crown([[2.05, -0.03], [1.9, -0.02], [1.3, -0.005], [1.02, 0.0], [1.0, 0.012], [0.97, 0.08], [0.9, 0.1], [0.5, 0.11], [0, 0.112]], 36), m);
    add(crown([[1.012, 0.008], [1.0, 0.035]]), std('#4a2a18', 0.7));
  }
  return o;
}

/** Sunglasses: two dark lenses, the frame round them, a bridge and the arms back to the ears. */
export function glassesMesh(id: string): THREE.Object3D {
  const o = new THREE.Group();
  o.name = `wear:glasses:${id}`;
  const aviator = id === 'aviator';
  const frame = aviator ? std('#c9a85a', 0.3, { metalness: 0.9 }) : std('#141414', 0.4);
  const lensMat = new THREE.MeshStandardMaterial({ color: aviator ? '#1d2a22' : '#121212', roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.88 });
  const r = 0.0016;
  for (const side of [-1, 1]) {
    // the lens outline in the face's plane (x across, y up), about the eye
    const pts: THREE.Vector3[] = [];
    const n = 24;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      let x = Math.cos(a), y = Math.sin(a);
      if (aviator) { x *= 0.027; y = y > 0 ? y * 0.018 : y * 0.024; x += side * (y < 0 ? 0.004 * (-y / 0.024) : 0) * -1; }
      else { x *= 0.022; y *= 0.022; }
      pts.push(new THREE.Vector3(HEAD.cx + side * HEAD.eyeX + x, HEAD.eyeY + y + (aviator ? 0.002 : 0), HEAD.faceZ - 0.004 * Math.abs(x) / 0.027));
    }
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, p.y)));
    const lens = new THREE.Mesh(new THREE.ShapeGeometry(shape, 12), lensMat);
    lens.position.z = HEAD.faceZ - 0.001;
    o.add(lens);
    const rim = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 48, aviator ? r : r * 1.8, 5, true), frame);
    o.add(rim);
    // the arm: from the lens's outer edge back over the ear
    const ex = HEAD.cx + side * (HEAD.eyeX + (aviator ? 0.027 : 0.022));
    const arm = new THREE.CatmullRomCurve3([
      new THREE.Vector3(ex, HEAD.eyeY + 0.006, HEAD.faceZ - 0.004),
      new THREE.Vector3(HEAD.cx + side * HEAD.earX, HEAD.eyeY + 0.008, HEAD.faceZ - 0.04),
      new THREE.Vector3(HEAD.cx + side * HEAD.earX, HEAD.eyeY + 0.004, HEAD.earZ + 0.01),
      new THREE.Vector3(HEAD.cx + side * (HEAD.earX - 0.004), HEAD.eyeY - 0.012, HEAD.earZ - 0.012),
    ]);
    o.add(new THREE.Mesh(new THREE.TubeGeometry(arm, 16, r * 1.3, 5, false), frame));
  }
  const bridge = new THREE.CatmullRomCurve3([
    new THREE.Vector3(HEAD.cx - HEAD.eyeX + 0.02, HEAD.eyeY + 0.01, HEAD.faceZ),
    new THREE.Vector3(HEAD.cx, HEAD.eyeY + 0.014, HEAD.faceZ + 0.003),
    new THREE.Vector3(HEAD.cx + HEAD.eyeX - 0.02, HEAD.eyeY + 0.01, HEAD.faceZ),
  ]);
  o.add(new THREE.Mesh(new THREE.TubeGeometry(bridge, 8, r * 1.2, 5, false), frame));
  if (aviator) {
    const top = new THREE.CatmullRomCurve3([
      new THREE.Vector3(HEAD.cx - HEAD.eyeX - 0.012, HEAD.eyeY + 0.021, HEAD.faceZ - 0.001),
      new THREE.Vector3(HEAD.cx, HEAD.eyeY + 0.022, HEAD.faceZ + 0.002),
      new THREE.Vector3(HEAD.cx + HEAD.eyeX + 0.012, HEAD.eyeY + 0.021, HEAD.faceZ - 0.001),
    ]);
    o.add(new THREE.Mesh(new THREE.TubeGeometry(top, 10, r, 5, false), frame));
  }
  o.traverse((m) => { if ((m as THREE.Mesh).isMesh) m.castShadow = false; });
  return o;
}

/** Hang `obj` (built in the model's bind space) on bone `name` of the model. */
function hangOn(hero: Hero, name: string, obj: THREE.Object3D): boolean {
  const b = hero.boneBind(name);
  if (!b) return false;
  obj.updateMatrix();
  b.bind.invert().multiply(obj.matrix).decompose(obj.position, obj.quaternion, obj.scale);
  b.bone.add(obj);
  return true;
}

/**
 * The suit's texture repainted by its mask (scripts/characters/suitmask.mjs: red where the jacket is, green the jeans,
 * from the same colour boxes cast.json recolours them by; the striped shirt is in neither): each part to its colour, its
 * shading kept as each pixel's luminance against the part's own colour (what pack.mjs left it). null keeps a part.
 */
export function recolorSuit(src: CanvasImageSource & { width: number; height: number }, mask: ImageData, jacket: string | null, pants: string | null): HTMLCanvasElement | null {
  const w = src.width, h = src.height;
  if (!w || !h || mask.width !== w || mask.height !== h) return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(src, 0, 0);
  if (!jacket && !pants) return c;
  const img = g.getImageData(0, 0, w, h), d = img.data, m = mask.data;
  const lum = (r: number, gg: number, b: number) => 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  // where the jeans are tells which way up the texture is (the mask is the file's way up; an ImageBitmap may be flipped)
  let blueY = 0, blueN = 0;
  for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) {
    const i = (y * w + x) * 4;
    if (d[i + 2] > d[i] + 12 && d[i + 2] > 40) { blueY += y; blueN++; }
  }
  const flipped = blueN > 0 && blueY / blueN < h / 2;
  // the parts' own colours (cast.json recolours the suit to these), 0..255 sRGB
  const JACKET = lum(0x25, 0x26, 0x2a), PANTS = lum(0x24, 0x31, 0x4a);
  // '#rrggbb' as the texture's own sRGB bytes (a THREE.Color would be linear)
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const J = jacket ? rgb(jacket) : null, P = pants ? rgb(pants) : null;
  for (let y = 0; y < h; y++) {
    const my = flipped ? h - 1 - y : y;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, k = (my * w + x) * 4;
      const wj = J ? m[k] / 255 : 0, wp = P ? m[k + 1] / 255 : 0;
      if (wj <= 0 && wp <= 0) continue;
      const r = d[i], gg = d[i + 1], b = d[i + 2], l = lum(r, gg, b);
      const [to, wt, ref] = wp > wj ? [P!, wp, PANTS] : [J!, wj, JACKET];
      const s = Math.min(3.2, l / ref);
      d[i] = r + (Math.min(255, to[0] * s) - r) * wt;
      d[i + 1] = gg + (Math.min(255, to[1] * s) - gg) * wt;
      d[i + 2] = b + (Math.min(255, to[2] * s) - b) * wt;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** The suit's mask at `w` x `h` (the texture's size), loaded once. */
let maskP: Promise<HTMLImageElement> | null = null;
function suitMask(w: number, h: number): Promise<ImageData | null> {
  maskP ??= new Promise<HTMLImageElement>((ok, no) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => ok(im);
    im.onerror = () => { maskP = null; no(new Error('suit mask')); };
    im.src = new URL(`${import.meta.env.BASE_URL}models/characters/chenye.suitmask.png`, document.baseURI).href;
  });
  return maskP.then((im) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(im, 0, 0, w, h);
    return g.getImageData(0, 0, w, h);
  }).catch(() => null);
}

/** What is on a model now, so a change only redoes its part. */
interface Dressed { hat: string | null; glasses: string | null; jacket: string | null; pants: string | null; hair: string | null }

/** Puts a `Wear` on one model (the player's Chen Ye): hats and glasses on the head bone, the suit and hair recoloured. */
export class Wardrobe {
  private hat: THREE.Object3D | null = null;
  private glasses: THREE.Object3D | null = null;
  private now: Dressed = { hat: null, glasses: null, jacket: null, pants: null, hair: null };
  private suit: THREE.MeshStandardMaterial | null = null;
  private suitSrc: (CanvasImageSource & { width: number; height: number }) | null = null;
  private suitMap: THREE.Texture | null = null;
  private hair: THREE.MeshPhysicalMaterial[] = [];
  private hairBase: THREE.Color | null = null;

  constructor(private readonly hero: Hero) {
    hero.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      const mat = m.material as THREE.MeshPhysicalMaterial;
      if (/casualsuit|suit/i.test(mat.name) && mat.map && !this.suit) {
        // a copy of the texture as loaded: core/Assets.compact releases the source once it is on the GPU (built before
        // the model's first frame, this is before that)
        this.suit = mat; this.suitMap = mat.map;
        const img = mat.map.image as (CanvasImageSource & { width: number; height: number }) | undefined;
        if (img?.width) {
          const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
          c.getContext('2d')?.drawImage(img, 0, 0);
          this.suitSrc = c;
        }
      }
      if (mat.alphaTest > 0 && /short|bob|long|ponytail|braid|afro/i.test(mat.name)) { this.hair.push(mat); this.hairBase ??= mat.color.clone(); }
    });
  }

  apply(w: Wear): void {
    const hat = w.hat ? `${w.hat}|${w.hatColor ?? ''}` : null;
    if (hat !== this.now.hat) {
      if (this.hat) { this.hat.removeFromParent(); dispose(this.hat); this.hat = null; }
      if (w.hat) { const h = hatMesh(w.hat, w.hatColor ?? '#333333'); if (hangOn(this.hero, 'Head', h)) this.hat = h; }
      this.now.hat = hat;
    }
    if (w.glasses !== this.now.glasses) {
      if (this.glasses) { this.glasses.removeFromParent(); dispose(this.glasses); this.glasses = null; }
      if (w.glasses) { const g = glassesMesh(w.glasses); if (hangOn(this.hero, 'Head', g)) this.glasses = g; }
      this.now.glasses = w.glasses ?? null;
    }
    if ((w.jacket ?? null) !== this.now.jacket || (w.pants ?? null) !== this.now.pants) {
      this.now.jacket = w.jacket ?? null; this.now.pants = w.pants ?? null;
      this.paintSuit();
    }
    if ((w.hair ?? null) !== this.now.hair) {
      this.now.hair = w.hair ?? null;
      const c = w.hair ? new THREE.Color(w.hair) : this.hairBase;
      if (c) for (const m of this.hair) { m.color.copy(c); m.sheenColor.copy(c).lerp(new THREE.Color('#a49686'), 0.3); }
    }
  }

  private paints = 0;
  private paintSuit(): void {
    const mat = this.suit, src = this.suitSrc, orig = this.suitMap;
    if (!mat || !src || !orig) return;
    const n = ++this.paints, jacket = this.now.jacket, pants = this.now.pants;
    if (!jacket && !pants) { if (mat.map !== orig) { mat.map?.dispose(); mat.map = orig; } return; }
    void suitMask(src.width, src.height).then((mask) => {
      // a later change came first
      if (!mask || n !== this.paints) return;
      const c = recolorSuit(src, mask, jacket, pants);
      if (!c) return;
      const t = new THREE.CanvasTexture(c);
      t.flipY = orig.flipY; t.colorSpace = orig.colorSpace; t.wrapS = orig.wrapS; t.wrapT = orig.wrapT;
      t.anisotropy = orig.anisotropy; t.channel = orig.channel;
      if (mat.map !== orig) mat.map?.dispose();
      mat.map = t;
    });
  }
}

function dispose(o: THREE.Object3D): void {
  // (the knit and straw textures are shared: kept)
  o.traverse((m) => { const mesh = m as THREE.Mesh; if (mesh.isMesh) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); } });
}

/** The same wear on a crowd-drawn body: a cap in the hat's colour, glasses, the jacket and trousers, the hair. */
export function wearOnLook(look: Look, w: Wear, base: Look): void {
  look.cap = w.hat ? new THREE.Color(w.hatColor ?? '#333333') : (base.cap ?? null);
  look.glasses = w.glasses ? true : base.glasses;
  look.shirt = w.jacket ? new THREE.Color(w.jacket) : base.shirt.clone();
  look.pants = w.pants ? new THREE.Color(w.pants) : base.pants.clone();
  look.hair = w.hair ? new THREE.Color(w.hair) : base.hair.clone();
}
