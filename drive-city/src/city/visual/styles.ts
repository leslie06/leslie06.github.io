/**
 * Facade styles shared by the tile worker (Buildings.ts writes them per vertex) and the facade
 * shader (Materials.ts). Pure data: safe to import in the worker.
 */
export const ST = {
  BLANK: 0, SLAB: 1, BRICK: 2, TOWER: 3, OFF_RIBBON: 4, OFF_GRID: 5, GLASS: 6, HUTONG: 7, TRAD: 8, LOW: 9, STATION: 10, WALL: 11,
  /** Roofs and roof-top objects share the facade mesh and material. */
  ROOF_FLAT: 12, ROOF_TILE: 13, ROOF_TRAD: 14, OBJ: 15,
} as const;
export type Style = (typeof ST)[keyof typeof ST];

/** Segment flags (aFac.z): the ground floor has shop units / the wall faces a street. */
export const FLAG_SHOP = 1, FLAG_STREET = 2;

/** Wall colours by style (sRGB): pale tile, beige, grey render, white, some brick red. */
export const WALL_COLOURS: Record<number, string[]> = {
  [ST.BLANK]: ['#d6d2c8'],
  [ST.SLAB]: ['#ddd4c2', '#e6e0d3', '#d2cdc3', '#dccbb8', '#e2d8bd', '#cfd2cf', '#d9c3b6', '#e8e4da'],
  [ST.BRICK]: ['#a8705c', '#9b6a58', '#b07a64', '#a29c94', '#b6aca0'],
  [ST.TOWER]: ['#ebe8e1', '#ddd2bd', '#cfcdc7', '#e2d9c8', '#d9dcdd', '#e9e1cf'],
  [ST.OFF_RIBBON]: ['#d9d5cc', '#c8ccce', '#cfc3ae', '#e0ddd6'],
  [ST.OFF_GRID]: ['#dbd6cb', '#cbc6ba', '#bfc4c7', '#d4c6ae', '#e3dfd5'],
  [ST.GLASS]: ['#b8bec2', '#a4abb0', '#c7ccce', '#8e979d'],
  [ST.HUTONG]: ['#a3a5a4', '#9c9fa0', '#aaaaa6', '#979a9b'],
  [ST.TRAD]: ['#9a3226', '#8e2c22', '#a23828'],
  [ST.LOW]: ['#c9c5bb', '#bdbab2', '#d2cec4'],
  [ST.STATION]: ['#ddd4c4', '#d0cfc9'],
  [ST.WALL]: ['#9c9ea0', '#a3a5a4'],
};
/** Curtain-wall glass tints by building (linear-ish sRGB). */
export const GLASS_TINTS = ['#46708c', '#3d6a70', '#56707f', '#355a7a', '#617a88'];
