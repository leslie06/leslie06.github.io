/**
 * Top-left minimap: 220x220 at 1080p on a 40% black plate with an 8px radius (reference layout).
 * The level's road/nav graph is baked once into a world-space bitmap, then blitted rotated around
 * the player each frame. Over that: the view cone, the player arrow, hostile pings (enemies that
 * fired recently), and small cardinal letters on the rim. Deliberately *not* a radar: no sweep, no
 * blueprint grid — those are the two things that made it read as sci-fi rather than military.
 */
import { div, span, el, setText, fmtInt, pad2 } from './dom';
import { theme } from './theme';
import { L } from './lang';
import { t } from '../core/I18n';
import type { HudState } from './HudState';
import type { LevelApi } from '../game/Contracts';

const RANGE_M = 26;         // metres from player to the map edge (level is 74m across, so the
                            // play-boundary rectangle stays outside the widget from mid-map)
const PING_LIFE = 2.6;      // seconds a hostile stays pinged after firing

interface Blip { x: number; z: number; t: number }

export class Minimap {
  root: HTMLDivElement;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement | null = null;
  private offPpm = 4; private offMinX = 0; private offMinZ = 0;
  private offKey = '';
  private sizePx = 220;
  private wave = span('v', '01'); private kills = span('v', '0'); private score = span('v', '0');
  private blips = new Map<number, Blip>();
  private fakeMap = false;

  constructor() {
    this.ctx = this.canvas.getContext('2d', { alpha: true })!;
    this.root = div('mm', [
      div('map', [this.canvas, div('rim')]),
      div('mmst', [
        div('s', [el('span', 'l', undefined, [L('stat.wave')]), this.wave]),
        div('s', [el('span', 'l', undefined, [L('stat.kills')]), this.kills]),
        div('s', [el('span', 'l', undefined, [L('stat.score')]), this.score]),
      ]),
    ]);
  }

  /** Called on resize: size the canvas to its CSS box (one layout read). */
  resize(): void {
    const css = this.canvas.clientWidth || 220;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.sizePx = Math.round(css * dpr);
    if (this.canvas.width !== this.sizePx) { this.canvas.width = this.sizePx; this.canvas.height = this.sizePx; }
  }

  enemyFired(id: number, x: number, z: number, now: number): void { this.blips.set(id, { x, z, t: now }); }
  setFakeMap(v: boolean): void { this.fakeMap = v; this.offKey = ''; }

  /** Bake the level's roads into a world-space bitmap once (rebuilt only if the level changes). */
  private buildOffscreen(level: LevelApi | undefined): void {
    const nav = level?.navPoints ?? [];
    const b = level?.bounds;
    const key = `${nav.length}:${b ? b.min.x + ',' + b.max.x : 'nb'}:${this.fakeMap}`;
    if (key === this.offKey) return;
    this.offKey = key;
    const minX = b ? b.min.x : -60, maxX = b ? b.max.x : 60, minZ = b ? b.min.z : -60, maxZ = b ? b.max.z : 60;
    const ppm = Math.max(2, Math.min(6, this.sizePx / (RANGE_M * 2))) * 2;
    const pad = Math.ceil(10 * ppm);
    const w = Math.ceil((maxX - minX) * ppm) + pad * 2, h = Math.ceil((maxZ - minZ) * ppm) + pad * 2;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    this.off = c; this.offPpm = ppm; this.offMinX = minX - pad / ppm; this.offMinZ = minZ - pad / ppm;
    const X = (x: number) => (x - this.offMinX) * ppm, Z = (z: number) => (z - this.offMinZ) * ppm;

    // Built-up ground: dark, so streets read as pale cuts through blocks (a CoD minimap is a
    // map, not a wireframe). A dimmer 8m periphery feathers the play boundary so the edge of the
    // world isn't a hard cut to void when the player stands near it.
    const per = 8 * ppm;
    g.fillStyle = 'rgba(20,25,33,0.40)';
    g.fillRect(X(minX) - per, Z(minZ) - per, (maxX - minX) * ppm + per * 2, (maxZ - minZ) * ppm + per * 2);
    g.fillStyle = 'rgba(20,25,33,0.88)';
    g.fillRect(X(minX), Z(minZ), (maxX - minX) * ppm, (maxZ - minZ) * ppm);

    const pts: { x: number; z: number; links: number[] }[] = nav.length
      ? nav.map((n) => ({ x: n.position.x, z: n.position.z, links: n.links }))
      : this.fakeMap ? fakeNav() : [];
    const roads = (width: number, style: string) => {
      g.strokeStyle = style; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath();
      for (let i = 0; i < pts.length; i++) for (const j of pts[i].links) if (j > i && pts[j]) { g.moveTo(X(pts[i].x), Z(pts[i].z)); g.lineTo(X(pts[j].x), Z(pts[j].z)); }
      g.stroke();
    };
    // Two passes: a soft kerb, then a brighter carriageway down the middle. Kept NARROW on purpose:
    // the nav graph is dense enough that a 2.9 x ppm kerb merged every street into one pale field,
    // which is what made the widget read as a bright plate instead of a dark one with pale cuts.
    roads(Math.max(3, ppm * 1.75), 'rgba(150,168,196,0.16)');
    roads(Math.max(1.6, ppm * 0.95), 'rgba(214,228,246,0.30)');
    // Play boundary, so the edge of the world reads as deliberate.
    g.strokeStyle = 'rgba(255,255,255,0.13)'; g.lineWidth = Math.max(1, ppm * 0.35);
    g.strokeRect(X(minX), Z(minZ), (maxX - minX) * ppm, (maxZ - minZ) * ppm);
  }

  update(s: HudState): void {
    setText(this.wave, pad2(s.game?.wave ?? 1));
    setText(this.kills, String(s.game?.kills ?? 0));
    setText(this.score, fmtInt(s.game?.score ?? 0));

    const g = this.ctx, S = this.sizePx, c = S / 2;
    if (S < 4) return;
    this.buildOffscreen(s.level);
    const p = s.player;
    const px = p?.x ?? 0, pz = p?.z ?? 0;
    const headingRad = s.heading * Math.PI / 180;
    const scale = S / (RANGE_M * 2); // px per metre on screen
    const k = S / 220;               // everything below is authored at the 220px reference size

    g.clearRect(0, 0, S, S);
    // Unsurveyed ground under everything, so the scene never shows through the map itself.
    g.fillStyle = 'rgba(9,12,17,0.86)';
    g.fillRect(0, 0, S, S);

    // ---- map layer, rotated so the player's heading is up
    g.save();
    g.beginPath(); g.rect(0, 0, S, S); g.clip();
    g.translate(c, c);
    g.rotate(-headingRad);
    g.scale(scale, scale);
    g.translate(-px, -pz);
    if (this.off) g.drawImage(this.off, this.offMinX, this.offMinZ, this.off.width / this.offPpm, this.off.height / this.offPpm);
    g.restore();

    // ---- view cone: a soft wedge ahead of the player, matching the camera FOV
    const cone = S * 0.42;
    const half = Math.min(1.05, s.fovRad / 2);
    g.save();
    g.beginPath();
    g.moveTo(c, c);
    g.arc(c, c, cone, -Math.PI / 2 - half, -Math.PI / 2 + half);
    g.closePath();
    g.clip();
    const cg = g.createRadialGradient(c, c, 0, c, c, cone);
    cg.addColorStop(0, 'rgba(255,255,255,0.20)');
    cg.addColorStop(0.5, 'rgba(255,255,255,0.08)');
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = cg; g.fillRect(0, 0, S, S);
    g.restore();

    // ---- hostile pings (world space -> screen, rotated with the map)
    for (const [id, b] of this.blips) {
      const age = s.t - b.t;
      if (age > PING_LIFE || age < 0) { this.blips.delete(id); continue; }
      const a = 1 - age / PING_LIFE;
      const dx = b.x - px, dz = b.z - pz;
      const cs = Math.cos(-headingRad), sn = Math.sin(-headingRad);
      const sx = c + (dx * cs - dz * sn) * scale, sy = c + (dx * sn + dz * cs) * scale;
      if (sx < -8 || sy < -8 || sx > S + 8 || sy > S + 8) continue;
      // expanding ring
      g.globalAlpha = 0.5 * a;
      g.strokeStyle = theme.color.enemy; g.lineWidth = 1.2 * k;
      g.beginPath(); g.arc(sx, sy, (3.5 + (1 - a) * 9) * k, 0, Math.PI * 2); g.stroke();
      // diamond, dark-rimmed so it survives a pale map
      g.globalAlpha = 0.45 + 0.55 * a;
      g.save(); g.translate(sx, sy); g.rotate(Math.PI / 4);
      const r = 3.1 * k;
      g.fillStyle = theme.color.enemy; g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1 * k;
      g.beginPath(); g.rect(-r, -r, r * 2, r * 2); g.fill(); g.stroke();
      g.restore();
      g.globalAlpha = 1;
    }

    // ---- north marker on the rim
    const nAng = -headingRad;
    const rim = c - 8 * k;
    const nx = c + Math.sin(nAng) * rim, ny = c - Math.cos(nAng) * rim;
    g.font = `700 ${Math.round(9.5 * k)}px ${theme.font.display}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fillText(t('dir.0'), nx, ny);

    // ---- player arrow, always centred, facing up
    const a = 7 * k;
    g.beginPath();
    g.moveTo(c, c - a * 1.3); g.lineTo(c + a * 0.8, c + a * 0.9); g.lineTo(c, c + a * 0.38); g.lineTo(c - a * 0.8, c + a * 0.9);
    g.closePath();
    g.strokeStyle = 'rgba(0,0,0,.8)'; g.lineWidth = 2.4 * k; g.lineJoin = 'round'; g.stroke();
    g.fillStyle = '#fff'; g.fill();
  }
}

/** Placeholder street grid for poses when the level exposes no nav graph yet. */
function fakeNav(): { x: number; z: number; links: number[] }[] {
  const pts: { x: number; z: number; links: number[] }[] = [];
  const n = 7, step = 14;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const idx = i * n + j;
    const links: number[] = [];
    if (j > 0 && (i % 2 === 0 || j % 3 === 1)) links.push(idx - 1);
    if (i > 0 && (j % 2 === 0 || i % 3 === 2)) links.push(idx - n);
    pts.push({ x: (j - (n - 1) / 2) * step + ((i * 7) % 5) - 2, z: (i - (n - 1) / 2) * step + ((j * 3) % 4) - 1.5, links });
  }
  for (let i = 0; i < pts.length; i++) for (const j of pts[i].links) pts[j].links.push(i);
  return pts;
}
