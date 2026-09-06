/**
 * Head-bob curves. Pure functions of a stride phase (1.0 = one full gait cycle = two footfalls).
 * View-space units: x right, y up (meters); pitch/roll in radians.
 */
export interface BobSample { x: number; y: number; pitch: number; roll: number }

export interface BobStyle {
  /** lateral sway amplitude (m), one swing per cycle */
  ampX: number;
  /** vertical amplitude (m), two bounces per cycle */
  ampY: number;
  /** roll amplitude (rad) */
  ampRoll: number;
  /** pitch amplitude (rad), two nods per cycle */
  ampPitch: number;
  /** meters travelled per full gait cycle (two steps) — sets bob frequency from speed */
  cycleLength: number;
  /** constant forward lean (rad, positive = look down) */
  lean: number;
  /** constant eye drop (m) while in this gait */
  drop: number;
}

export const BOB_STYLES = {
  walk:      { ampX: 0.012, ampY: 0.016, ampRoll: 0.010, ampPitch: 0.006, cycleLength: 2.9, lean: 0.0,   drop: 0.0 },
  sprint:    { ampX: 0.026, ampY: 0.036, ampRoll: 0.022, ampPitch: 0.014, cycleLength: 3.7, lean: 0.035, drop: 0.05 },
  tacSprint: { ampX: 0.034, ampY: 0.048, ampRoll: 0.030, ampPitch: 0.020, cycleLength: 3.9, lean: 0.065, drop: 0.08 },
  crouch:    { ampX: 0.008, ampY: 0.010, ampRoll: 0.008, ampPitch: 0.004, cycleLength: 1.7, lean: 0.0,   drop: 0.0 },
  ads:       { ampX: 0.003, ampY: 0.004, ampRoll: 0.002, ampPitch: 0.002, cycleLength: 2.9, lean: 0.0,   drop: 0.0 },
} as const satisfies Record<string, BobStyle>;

const TAU = Math.PI * 2;

/** Sample the bob curve at `phase` (cycles). Figure-8 pattern: lateral once per cycle, vertical twice. */
export function bobSample(phase: number, s: BobStyle): BobSample {
  const p = phase * TAU;
  // Vertical: two bounces per cycle. Sharpened so the "heel strike" reads as a quicker drop than the rise.
  const v = Math.sin(2 * p);
  const y = s.ampY * (v - 0.35 * v * v * v);
  const x = s.ampX * Math.sin(p);
  // Roll trails the lateral sway by a quarter cycle so the head tilts into the step.
  const roll = s.ampRoll * Math.sin(p - Math.PI * 0.25);
  const pitch = s.ampPitch * Math.sin(2 * p + Math.PI * 0.5);
  return { x, y: y - s.drop, pitch: pitch + s.lean, roll };
}

/** Weighted blend of several styles (weights need not sum to 1; they are normalised). */
export function blendStyles(parts: Array<[BobStyle, number]>): BobStyle {
  let wsum = 0;
  const out: BobStyle = { ampX: 0, ampY: 0, ampRoll: 0, ampPitch: 0, cycleLength: 0, lean: 0, drop: 0 };
  for (const [, w] of parts) wsum += Math.max(0, w);
  if (wsum <= 1e-9) return { ...BOB_STYLES.walk, ampX: 0, ampY: 0, ampRoll: 0, ampPitch: 0, lean: 0, drop: 0 };
  for (const [st, wRaw] of parts) {
    const w = Math.max(0, wRaw) / wsum;
    out.ampX += st.ampX * w; out.ampY += st.ampY * w; out.ampRoll += st.ampRoll * w; out.ampPitch += st.ampPitch * w;
    out.cycleLength += st.cycleLength * w; out.lean += st.lean * w; out.drop += st.drop * w;
  }
  return out;
}

/** Bob amplitude as a function of ground speed: silent when still, full above ~walk speed. */
export function bobAmplitudeForSpeed(speed: number, walkSpeed: number): number {
  const r = speed / Math.max(0.1, walkSpeed);
  const t = Math.min(1, Math.max(0, (r - 0.08) / 0.55));
  return t * t * (3 - 2 * t);
}

/** Advance the gait phase by distance travelled. Returns the new phase and how many footfalls happened. */
export function advancePhase(phase: number, speed: number, dt: number, cycleLength: number): { phase: number; footfalls: number } {
  const next = phase + (speed * dt) / Math.max(0.2, cycleLength);
  const footfalls = Math.floor(next * 2) - Math.floor(phase * 2);
  return { phase: next, footfalls };
}
