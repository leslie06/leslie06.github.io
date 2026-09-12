/**
 * Layout of the livery atlas (1024 x 512, drawn by CarMaterials, sampled by every car mesh except
 * the paint). Rectangles are in canvas pixels (origin top left); `uv()` turns one into the
 * [u0, v0, u1, v1] a Surf maps its 0..1 face coordinates into. Shared by the geometry (Node-safe)
 * and the drawing code.
 */
export const ATLAS_W = 1024, ATLAS_H = 768;

export interface PxRect { x: number; y: number; w: number; h: number }

export const PX = {
  white: { x: 0, y: 0, w: 64, h: 64 },
  head: { x: 64, y: 0, w: 256, h: 128 },
  tail: { x: 320, y: 0, w: 256, h: 128 },
  grille: { x: 576, y: 0, w: 256, h: 128 },
  intake: { x: 832, y: 0, w: 192, h: 64 },
  amber: { x: 832, y: 64, w: 96, h: 64 },
  reverse: { x: 928, y: 64, w: 96, h: 64 },
  plateF: { x: 0, y: 128, w: 256, h: 80 },
  plateR: { x: 256, y: 128, w: 256, h: 80 },
  sign: { x: 512, y: 128, w: 512, h: 128 },
  door: { x: 0, y: 208, w: 512, h: 96 },
  dest: { x: 512, y: 256, w: 512, h: 96 },
  beacon: { x: 0, y: 304, w: 256, h: 64 },
  side: { x: 256, y: 352, w: 768, h: 96 },
  badge: { x: 0, y: 368, w: 64, h: 64 },
  busHead: { x: 64, y: 368, w: 192, h: 80 },
  rearDoor: { x: 0, y: 448, w: 256, h: 64 },
  vent: { x: 256, y: 448, w: 256, h: 64 },
  mesh: { x: 512, y: 448, w: 256, h: 64 },
  cabin: { x: 768, y: 448, w: 256, h: 64 },
  // Front and rear styles, so the body types do not share one face.
  grilleBars: { x: 0, y: 512, w: 256, h: 128 },
  grilleSlim: { x: 256, y: 512, w: 256, h: 128 },
  grilleWave: { x: 512, y: 512, w: 256, h: 128 },
  head2: { x: 768, y: 512, w: 256, h: 128 },
  tail2: { x: 0, y: 640, w: 256, h: 128 },
} as const satisfies Record<string, PxRect>;

export type AtlasKey = keyof typeof PX;

/** A rect in texture coordinates (v up), inset by `pad` pixels so mipmaps don't bleed neighbours in. */
export function uv(key: AtlasKey, pad = 2): readonly [number, number, number, number] {
  const r = PX[key];
  return [(r.x + pad) / ATLAS_W, 1 - (r.y + r.h - pad) / ATLAS_H, (r.x + r.w - pad) / ATLAS_W, 1 - (r.y + pad) / ATLAS_H];
}

/** Centre of the white swatch: untextured faces sample it. */
export const WHITE: readonly [number, number] = [32 / ATLAS_W, 1 - 32 / ATLAS_H];
