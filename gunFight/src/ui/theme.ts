/** Simplified-Chinese UI faces (macOS, Windows, Linux/Android). Listed after every Latin face below. */
const CJK = `"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC"`;

/**
 * Design tokens for every piece of DOM UI. Nothing in ui/ hardcodes a color or font — it reads
 * these (as CSS custom properties on #ui, see styles.ts) so the whole HUD re-skins from one place.
 *
 * Aesthetic target: a shipped military shooter HUD (MWII/MWIII), not a sci-fi web page.
 * Rules distilled from ref/notes.md and the reference frames:
 *   - white text at 88-90% opacity, secondary at 55-60%, never pure #fff except the crosshair
 *   - labels are all-caps with ~1px letter-spacing, NOT 0.3em tracking
 *   - team = green, enemy = red/orange, objective = gold
 *   - GOLD BUDGET: two roles only in the live HUD (objective line, reload prompt). Everything else
 *     that used to be amber - compass heading, wave subtitle, score popups, killfeed skull,
 *     low-ammo count, crosshair hit flash - is white, separated by size/weight/opacity
 *   - dark plates (black 35-45%) behind minimap + killfeed only; everything else sits on the image
 *   - everything edge-anchored at a 24px safe margin (1080p), centre 60% kept clear
 */
export const theme = {
  font: {
    /**
     * Condensed display stack — reads like CoD's DIN/Industry. All system fonts, no requests.
     * CJK faces come after every Latin face, so English keeps the condensed type and only Chinese
     * glyphs fall through to the platform's Hei face (PingFang on macOS, YaHei on Windows).
     */
    display: `"Avenir Next Condensed", "Bahnschrift", "Roboto Condensed", "Arial Narrow", "Helvetica Neue", Arial, ${CJK}, sans-serif`,
    /** Body / small labels. */
    body: `"Avenir Next Condensed", "Bahnschrift", "Roboto Condensed", "Arial Narrow", "Helvetica Neue", Arial, ${CJK}, sans-serif`,
    mono: `"SF Mono", Menlo, Consolas, "Roboto Mono", ${CJK}, monospace`,
  },
  color: {
    /** Reference white. HUD text uses `hud` (90%), never this at full strength. */
    white: '#f2f4f7',
    hud: 'rgba(242,244,247,0.90)',
    dim: 'rgba(242,244,247,0.58)',
    faint: 'rgba(242,244,247,0.30)',
    line: 'rgba(242,244,247,0.22)',
    scrim: 'rgba(4,6,9,0.42)',
    scrimStrong: 'rgba(4,6,9,0.72)',
    /** Dark plate behind minimap + killfeed: 38% black, per reference. Never opaque. */
    panel: 'rgba(0,0,0,0.38)',
    hit: '#ff8a1f',
    kill: '#ff4b38',
    headshot: '#ffc74a',
    /** Objective / location / heading gold. */
    gold: '#ffc74a',
    /** Friendly / own name in the killfeed. */
    ally: '#63d68b',
    /** Hostiles: nameplates, minimap pings, compass diamonds. */
    enemy: '#ff5340',
    danger: '#ff3b2f',
    lowAmmo: '#ff8a1f',
    success: '#63d68b',
    shadow: 'rgba(0,0,0,0.85)',
  },
  /** Base drop shadow every piece of HUD text gets. Keeps it legible over bright sky. */
  textShadow: '0 1px 2px rgba(0,0,0,.75), 0 0 4px rgba(0,0,0,.35)',
  /** Chamfer used on panels/buttons (clip-path polygon, 2px corners). */
  chamfer: (px = 3) => `polygon(${px}px 0, calc(100% - ${px}px) 0, 100% ${px}px, 100% calc(100% - ${px}px), calc(100% - ${px}px) 100%, ${px}px 100%, 0 calc(100% - ${px}px), 0 ${px}px)`,
  timing: {
    hitmarker: 120,
    hitmarkerHold: 60,
    damageIndicator: 1200,
    killfeedLife: 5200,
    /** Score popups live 0.6s (critic: max 2 on screen, right of the crosshair). */
    scorePopup: 600,
    /** Wave banner holds 1.2s then fades over 0.4s. */
    waveBanner: 1600,
    waveBannerHold: 1200,
    weaponSwitch: 1500,
    message: 2000,
    /** After this long the objective demotes to a dim line under the compass. */
    objectiveSettle: 3,
  },
  z: { hud: 10, screens: 20, loading: 30 },
} as const;

/** CSS custom properties emitted onto #ui so the stylesheet can read tokens. */
export function cssVars(): string {
  const c = theme.color;
  return [
    `--font-display:${theme.font.display}`,
    `--font-body:${theme.font.body}`,
    `--font-mono:${theme.font.mono}`,
    `--c-white:${c.white}`, `--c-hud:${c.hud}`, `--c-dim:${c.dim}`, `--c-faint:${c.faint}`, `--c-line:${c.line}`,
    `--c-scrim:${c.scrim}`, `--c-scrim-strong:${c.scrimStrong}`, `--c-panel:${c.panel}`,
    `--c-hit:${c.hit}`, `--c-kill:${c.kill}`, `--c-headshot:${c.headshot}`, `--c-gold:${c.gold}`,
    `--c-ally:${c.ally}`, `--c-enemy:${c.enemy}`,
    `--c-danger:${c.danger}`, `--c-lowammo:${c.lowAmmo}`, `--c-success:${c.success}`, `--c-shadow:${c.shadow}`,
    `--text-shadow:${theme.textShadow}`,
    `--chamfer:${theme.chamfer(3)}`,
    `--chamfer-lg:${theme.chamfer(6)}`,
  ].join(';');
}
