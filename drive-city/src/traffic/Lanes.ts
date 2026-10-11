import { SIDEWALK } from '../people/Pavement';

/**
 * How a carriageway is divided into lanes, from its OSM class, width, one-way flag and tagged lane count. Shared
 * by the lane graph (main thread) and the kerbside parking (tile worker), which must agree on where traffic runs.
 */
export function laneLayout(w: number, oneway: boolean, tagged: number): { lanes: number; laneW: number } {
  const lanes = oneway ? (tagged || Math.max(1, Math.round(w / 3.3))) : Math.max(1, tagged ? Math.round(tagged / 2) : Math.floor(w / 2 / 3.1));
  return { lanes, laneW: (oneway ? w : w / 2) / lanes };
}

/**
 * Metres left of the centre line of a lane's middle. A street with one lane each way keeps its traffic within
 * 1.4 m of the line (oncoming cars still pass a metre apart): at half its width, 1.75-2 m out, the kerb lane of
 * a narrow street ran against the house fronts the widths overstate (the drivability census, 2026-10-03).
 */
export function laneOffsetOf(oneway: boolean, lanes: number, laneW: number, hw: number, lane: number): number {
  if (oneway) return hw - (lane + 0.5) * laneW;
  return lanes === 1 ? -Math.min(0.5 * laneW, 1.4) : -(lane + 0.5) * laneW;
}

/** Road classes with cars parked along the kerb (Beijing's side streets; main roads keep their kerb lane). */
export const PARK_CLASSES = new Set(['residential', 'unclassified', 'tertiary']);
/** The strip a parked car takes across the road (the bodies are 1.72-1.84 m wide, the mirrors stand above the bonnet). */
export const PARK_W = 1.85;
/**
 * Half the width traffic is given (AiDriver's leader test uses 0.95; the bodies are 0.86-0.92), and the gap to it:
 * a car still settling into its lane after a turn runs up to half a metre wide of it (at 0.2 they scraped the row).
 */
const TRAFFIC_HW = 0.92, GAP = 0.3;

/**
 * The kerbside parking strip on the right of travel (on both sides of a two-way street, on the right of a one-way
 * one), as distances from the centre line: `inner` its edge towards the traffic, `outer` its kerbside edge. The cars
 * keep clear of the outermost lane's traffic and stand against the kerb where the carriageway has room - else half
 * up on the pavement, as Beijing parks, never more than 1.05 m up and leaving 1.4 m to walk. Null where the street
 * has no room (main roads, narrow lanes, one-way carriageways whose lanes fill them) or no pavement.
 */
export function parkingLine(cls: string, w: number, oneway: boolean, tagged: number): { inner: number; outer: number } | null {
  const sw = SIDEWALK[cls] ?? 0;
  // A one-way tertiary is mostly a main road's 辅路 (建国门外大街's): no parking along those.
  if (!PARK_CLASSES.has(cls) || !sw || (oneway && cls === 'tertiary')) return null;
  const { lanes, laneW } = laneLayout(w, oneway, tagged), hw = w / 2;
  const right = oneway ? -laneOffsetOf(true, lanes, laneW, hw, lanes - 1) : -laneOffsetOf(false, lanes, laneW, hw, lanes - 1);
  const inner = right + TRAFFIC_HW + GAP;
  const outer = Math.max(hw - 0.15, inner + PARK_W);
  if (outer - hw > Math.min(1.05, sw - 1.4)) return null;
  return { inner: outer - PARK_W, outer };
}
