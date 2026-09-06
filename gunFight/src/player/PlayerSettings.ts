/**
 * Runtime-adjustable player options. The UI module can mutate the object returned by
 * `engine.get('player').settings` at any time; changes take effect next frame.
 */
export interface PlayerSettings {
  /** radians of view rotation per pixel of mouse movement (hip) */
  sensitivity: number;
  invertY: boolean;
  /** Horizontal field of view in degrees (CoD convention, measured at 16:9). */
  fov: number;
  /** 'relative' scales ADS sensitivity by the zoom ratio (CoD "Relative"); 'legacy' uses adsSensMul only. */
  adsSensMode: 'relative' | 'legacy';
  adsSensMul: number;
  /** Ctrl/C toggles crouch instead of hold. */
  crouchToggle: boolean;
  /** Tactical sprint from a double tap of Shift. */
  tacSprintDoubleTap: boolean;
  /** Tactical sprint after holding sprint this long (seconds); 0 disables. */
  tacSprintHoldDelay: number;
  /** Automatically vault low cover while sprinting into it. */
  autoMantle: boolean;
  /** 0..1 scale of head bob. */
  headBobScale: number;
  /** 0..1 scale of screen shake / view punch. */
  shakeScale: number;
  /** Fraction of addRecoil() that permanently moves the aim (rest is a spring kick that returns). */
  recoilPersist: number;
  /** Sprint / slide FOV kick on. */
  fovKick: boolean;
}

export function defaultPlayerSettings(): PlayerSettings {
  return {
    sensitivity: 0.0022,
    invertY: false,
    fov: 80,
    adsSensMode: 'relative',
    adsSensMul: 1.0,
    crouchToggle: false,
    tacSprintDoubleTap: true,
    tacSprintHoldDelay: 0,
    autoMantle: true,
    headBobScale: 1,
    shakeScale: 1,
    recoilPersist: 0.3,
    fovKick: true,
  };
}

const DEG = Math.PI / 180;

/** Horizontal FOV measured at 16:9 -> vertical FOV for three.js PerspectiveCamera at `aspect`. */
export function horizontalToVerticalFov(hfovDeg: number, aspect: number): number {
  void aspect; // CoD keeps the vertical FOV constant across aspect ratios (Hor+ scaling), reference 16:9.
  const ref = 16 / 9;
  return 2 * Math.atan(Math.tan(hfovDeg * 0.5 * DEG) / ref) / DEG;
}

/** Sensitivity multiplier that keeps the same on-screen movement per mouse inch at a narrower FOV. */
export function zoomSensitivity(hipFovDeg: number, aimFovDeg: number, mode: PlayerSettings['adsSensMode'], mul: number): number {
  if (mode === 'legacy') return mul;
  const r = Math.tan(aimFovDeg * 0.5 * DEG) / Math.tan(hipFovDeg * 0.5 * DEG);
  return Math.max(0.05, Math.min(1, r)) * mul;
}
