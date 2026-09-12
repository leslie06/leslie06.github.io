import type { BlipKind } from '../game/Contracts';
import { C } from '../ui/theme';

/**
 * Blip icons and markers shared by the minimap and the full map. Canvas 2D, identity transform (CSS
 * pixels after the DPR scale). Angles are screen angles: radians clockwise from straight up.
 */
export type MarkKind = BlipKind | 'waypoint' | 'mission';

export const INK = 'rgba(9,11,13,0.9)';
export const POLICE_RED = '#ff3b30', POLICE_BLUE = '#2f7bff';
export const BLIP_COLOR: Record<MarkKind, string> = {
  police: POLICE_BLUE, target: C.yellow, pickup: '#3aa6ff', dropoff: '#3ccf72', car: '#d8dbde', landmark: '#d4b264', waypoint: C.yellow, mission: C.yellow,
};

/** Police lights: red/blue at ~2.5 Hz. */
export const policeColor = (time: number): string => (Math.floor(time * 5) % 2 ? POLICE_RED : POLICE_BLUE);

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.26); ctx.strokeStyle = INK; ctx.stroke();
}

/**
 * One blip at (x, y), radius `r` px. `angle` (screen, NaN = none) turns police and cars into arrows;
 * `time` (seconds) drives flashing.
 */
export function drawBlip(ctx: CanvasRenderingContext2D, kind: MarkKind, x: number, y: number, r: number, angle: number, time: number, flash = false): void {
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (flash && kind !== 'police' && Math.floor(time * 3) % 2) ctx.globalAlpha *= 0.35;
  const col = BLIP_COLOR[kind];
  switch (kind) {
    case 'police': {
      const c = flash ? policeColor(time) : POLICE_BLUE;
      if (Number.isFinite(angle)) {
        ctx.translate(x, y); ctx.rotate(angle);
        ctx.beginPath(); ctx.moveTo(0, -r * 1.25); ctx.lineTo(r * 0.95, r * 0.9); ctx.lineTo(0, r * 0.45); ctx.lineTo(-r * 0.95, r * 0.9); ctx.closePath();
        ctx.fillStyle = c; ctx.fill(); ctx.lineWidth = Math.max(1.5, r * 0.26); ctx.strokeStyle = INK; ctx.stroke();
      } else disc(ctx, x, y, r * 0.85, c);
      break;
    }
    case 'car': {
      ctx.translate(x, y); ctx.rotate(Number.isFinite(angle) ? angle : 0);
      const w = r * 0.95, h = r * 1.7;
      ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, w * 0.35);
      ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = Math.max(1.5, r * 0.24); ctx.strokeStyle = INK; ctx.stroke();
      ctx.fillStyle = 'rgba(9,11,13,0.55)'; ctx.fillRect(-w * 0.32, -h * 0.22, w * 0.64, h * 0.2);
      break;
    }
    case 'landmark': {
      ctx.translate(x, y); ctx.rotate(Math.PI / 4);
      const s = r * 1.3;
      ctx.beginPath(); ctx.rect(-s / 2, -s / 2, s, s);
      ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = Math.max(1.5, r * 0.24); ctx.strokeStyle = INK; ctx.stroke();
      ctx.fillStyle = INK; ctx.fillRect(-s * 0.14, -s * 0.14, s * 0.28, s * 0.28);
      break;
    }
    case 'pickup': {
      disc(ctx, x, y, r, col);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y - r * 0.28, r * 0.26, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x, y + r * 0.42, r * 0.46, r * 0.3, 0, Math.PI, 0); ctx.fill();
      break;
    }
    case 'dropoff': {
      disc(ctx, x, y, r, col);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.2, r * 0.16);
      ctx.beginPath(); ctx.moveTo(x - r * 0.3, y + r * 0.5); ctx.lineTo(x - r * 0.3, y - r * 0.5); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(x - r * 0.3, y - r * 0.5); ctx.lineTo(x + r * 0.45, y - r * 0.25); ctx.lineTo(x - r * 0.3, y); ctx.closePath(); ctx.fill();
      break;
    }
    case 'waypoint': {
      // A map pin with its tip on the point.
      const R = r * 0.95, cy = y - R * 1.9;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x - R * 0.35, cy + R * 1.1, x - R, cy + R * 0.55, x - R, cy);
      ctx.arc(x, cy, R, Math.PI, 0);
      ctx.bezierCurveTo(x + R, cy + R * 0.55, x + R * 0.35, cy + R * 1.1, x, y);
      ctx.closePath();
      ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = Math.max(1.5, r * 0.22); ctx.strokeStyle = INK; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, cy, R * 0.38, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
      break;
    }
    case 'mission':
    case 'target': {
      disc(ctx, x, y, r, col);
      ctx.beginPath(); ctx.arc(x, y, r * 0.42, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
      break;
    }
  }
  ctx.restore();
}

/** The player: a GTA-style arrowhead, `size` px from tip to tail, pointing along `angle`. */
export function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number): void {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle);
  const s = size / 2;
  ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.8, s * 0.8); ctx.lineTo(0, s * 0.38); ctx.lineTo(-s * 0.8, s * 0.8); ctx.closePath();
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 4;
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineJoin = 'round'; ctx.lineWidth = 1.6; ctx.strokeStyle = INK; ctx.stroke();
  ctx.restore();
}

/** A small arrow on a map's edge pointing out towards something off the map. */
export function drawEdgeArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string, size: number): void {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle);
  ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size * 0.75, 0); ctx.lineTo(-size * 0.75, 0); ctx.closePath();
  ctx.fillStyle = color; ctx.fill(); ctx.lineJoin = 'round'; ctx.lineWidth = 1.4; ctx.strokeStyle = INK; ctx.stroke();
  ctx.restore();
}

/** Screen angle (clockwise from up) of world heading `h` on a map whose up points along world heading `up`. */
export const screenAngle = (h: number, up: number): number => up - h;
