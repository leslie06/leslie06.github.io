/**
 * Inline SVG glyphs. Weapons are drawn as *line* art (stroke, no fill) in a 44x24 box so they stay
 * readable at the 24px killfeed / weapon-slot size — silhouette blobs turn to mush below ~20px.
 * Everything inherits `currentColor`.
 */
import type { WeaponState } from '../game/Contracts';

/** Line-glyph stroke preset. 1.7 units in a 24-unit-tall box ≈ 1.7px when drawn at 24px. */
const S = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
const F = 'fill="currentColor"';

/**
 * Weapon line glyphs, 44x24 box, muzzle right, bore line at y≈10.5. Kept to 5-7 strokes each with
 * ≥3 units of clear space between them so nothing fills in at the 22px killfeed size.
 */
export const WEAPON_ICONS: Record<WeaponState['kind'], string> = {
  // AR — the mid-length reference: thin tube stock, medium body, LONG thin barrel past the body,
  // narrow 30-rd mag raked forward. Overall extent x4→41.
  rifle: `<g ${S}><path d="M4.4 8.6v4.8M4.4 11h6.6"/><rect x="11" y="7" width="11.5" height="7"/><path d="M22.5 10.4h18.5"/><path d="M36.5 10.4V7.2"/><path d="M15.6 14l1 6.4h4.3l-.7-6.4"/><path d="M12.9 14l-2.3 6.2"/></g>`,
  // SMG — compact: folded V stock, short body, barely any barrel, and a LONG straight vertical
  // mag that drops well below the others. Overall extent x7→32, visibly shorter than the AR.
  smg: `<g ${S}><path d="M12 7.8L7 10.4l5 2.6"/><rect x="12" y="7" width="13.5" height="7"/><path d="M25.5 10.4h6.5"/><path d="M29.5 10.4V8"/><rect x="15.8" y="14" width="3.8" height="7.6"/><path d="M23.4 14l-1.5 4.8"/></g>`,
  // Pistol: slide with sight nubs, frame, trigger guard, raked grip
  pistol: `<g ${S}><rect x="14" y="7" width="17" height="4.6"/><path d="M16 7V5.4M29.4 7V5.4"/><path d="M14 11.6h5.2l-2.6 8.8h-4.2l2.2-6.6"/><path d="M19.6 11.6c0 3 4.6 3 4.6 0"/></g>`,
  // Pump shotgun: twin tubes (barrel over magazine tube) is the read; solid stock, sliding pump
  shotgun: `<g ${S}><path d="M11 8.6H3.8l1.4 5.6H11"/><rect x="11" y="7.6" width="11" height="6.6"/><path d="M22 9.6h19"/><path d="M22 13.2h15"/><rect x="26" y="8.4" width="6" height="5.4"/><path d="M15 14.2L12.9 19.6"/></g>`,
  // Sniper: the scope tube on top is unmistakable, so no bipod here — the bipod belongs to the LMG
  sniper: `<g ${S}><path d="M11 8.6H3.6v5.8H11"/><rect x="11" y="7.6" width="12" height="6.8"/><path d="M23 10.8h18"/><rect x="12.4" y="2.8" width="12" height="3.4"/><path d="M15 7.6V6.2M22 7.6V6.2"/><path d="M15.4 14.4l-2 5.6"/></g>`,
  // LMG — the heavy: solid box stock, TALL body with a carry handle, WIDE shallow box mag and a
  // bipod under the barrel. Bulk and the squat magazine separate it from the AR at a glance.
  lmg: `<g ${S}><rect x="3.4" y="8.2" width="7.4" height="6.4"/><rect x="10.8" y="6" width="13.5" height="9"/><path d="M14 6V3.8h6.4V6"/><path d="M24.3 10.4h16.7"/><path d="M36.5 10.4V7.8"/><rect x="13.6" y="15" width="9.6" height="5.4"/><path d="M30 11v3.2l-2.8 3.2M30 14.2l2.8 3.2"/></g>`,
  // Launcher: fat tube, flared muzzle, optic, fore-grip
  launcher: `<g ${S}><rect x="4" y="7" width="32" height="7.4" rx="1.4"/><path d="M36 7l4.6 4.7L36 16"/><rect x="13.5" y="4.6" width="7" height="2.4"/><path d="M11.6 14.4L9.6 20.4"/><path d="M24 14.4l-1.6 4.6"/></g>`,
};

/** Fire-mode glyphs (14x14): bullets per trigger pull. */
export const FIRE_MODE_ICONS: Record<WeaponState['fireMode'], string> = {
  auto: `<rect ${F} x="2" y="2" width="2" height="10"/><rect ${F} x="6" y="2" width="2" height="10"/><rect ${F} x="10" y="2" width="2" height="10"/>`,
  burst: `<rect ${F} x="2" y="2" width="2" height="10"/><rect ${F} x="6" y="2" width="2" height="10"/><rect ${F} x="10" y="2" width="2" height="10" opacity=".3"/>`,
  semi: `<rect ${F} x="6" y="2" width="2" height="10"/>`,
  bolt: `<rect ${F} x="6" y="2" width="2" height="10"/><rect ${F} x="2" y="10.5" width="10" height="1.5"/>`,
  pump: `<rect ${F} x="6" y="2" width="2" height="10"/><rect ${F} x="2" y="6" width="10" height="1.5"/>`,
};

/** Frag grenade, 24x24 line glyph — the lethal-equipment slot next to the ammo cluster. */
export const GRENADE = `<g ${S}><path d="M9.5 5h5v2.2h-5z"/><path d="M12 7.2v1.4"/><path d="M14.5 5.6c2 .4 3.3 1.6 3.6 3.1"/><rect x="6.5" y="8.6" width="11" height="11.4" rx="4.2"/><path d="M6.5 12.4h11M6.5 16.2h11M9.9 8.6v11.4M14.1 8.6v11.4"/></g>`;

/** Small skull for headshot kills in the killfeed. Solid: it has to read at ~14px. */
export const SKULL = `<path ${F} d="M12 2.6c-4.1 0-7 2.9-7 6.7 0 2 .8 3.6 2.1 4.7v2.9h2v-1.8h1.1v1.8h3.4v-1.8h1.1v1.8h2v-2.9c1.3-1.1 2.1-2.7 2.1-4.7 0-3.8-2.9-6.7-6.8-6.7zm-2.9 8.9a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4zm5.8 0a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4zM12 13.7l-1.1-2.2h2.2z"/>`;

export const CHEVRON = `<path ${S} d="M4 8l8 8 8-8"/>`;
export const PLAYER_ARROW = `<path ${F} d="M12 2l8 20-8-5-8 5z"/>`;
export const CROSS = `<path ${S} d="M5 5l14 14M19 5L5 19"/>`;
export const SPRINT = `<path ${S} d="M13 4a1.5 1.5 0 1 0 0-.1M9 20l3-6-3-2 2-5 4 1 3 3"/><path ${S} d="M12 14l3 2 1 4"/>`;

/** Compass cardinal labels at 45° steps. */
export const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
