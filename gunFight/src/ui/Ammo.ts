/**
 * Bottom-right weapon cluster, laid out like the reference frames: weapon line-glyph, big mag
 * count (~38px at 1080p), dim reserve beside it, then one meta line (fire mode + weapon name) and
 * the lethal-equipment slot with its keycap. Low-ammo flash + RELOAD prompt sit above the numbers.
 */
import { div, span, svg, setText, setClass, animate, type ShotAnim } from './dom';
import { FIRE_MODE_ICONS, WEAPON_ICONS, GRENADE } from './icons';
import { theme } from './theme';
import type { WeaponState } from '../game/Contracts';
import type { HudState } from './HudState';
import { t, onLangChange, type TKey } from '../core/I18n';

const MODE_LABEL: Record<WeaponState['fireMode'], TKey> = { auto: 'mode.auto', semi: 'mode.semi', burst: 'mode.burst', bolt: 'mode.bolt', pump: 'mode.pump' };

export class Ammo {
  root: HTMLDivElement;
  private rl = div('rl', [t('hud.reload')]);
  private mag = span('mag', '30');
  private res = span('res', '120');
  private wpnIcon = svg(WEAPON_ICONS.rifle, '0 0 44 24', 'wi');
  private modeIcon = svg(FIRE_MODE_ICONS.auto, '0 0 14 14');
  private modeTxt = span('', t('mode.auto'));
  private name = span('name', 'RIFLE');
  private nades = span('c', '2');
  private lastMode = '';
  private lastKind = '';

  constructor() {
    this.root = div('ammo', [
      this.rl,
      div('row', [this.wpnIcon, this.mag, this.res]),
      div('meta', [div('mode', [this.modeIcon, this.modeTxt]), this.name]),
      div('eq', [svg(GRENADE, '0 0 24 24', 'gi'), this.nades, span('key', 'G')]),
    ]);
    onLangChange(() => { this.lastMode = ''; }); // the fire-mode label is only rewritten when the mode changes
  }

  update(s: HudState): void {
    const w = s.weapon;
    const mag = w?.ammoInMag ?? 0, size = w?.magSize ?? 30, reserve = w?.reserveAmmo ?? 0;
    setText(this.mag, String(mag));
    setText(this.res, String(reserve));
    setText(this.name, (w?.name ?? 'RIFLE').toUpperCase());
    const kind = w?.kind ?? 'rifle';
    if (kind !== this.lastKind) { this.lastKind = kind; this.wpnIcon.innerHTML = WEAPON_ICONS[kind] ?? WEAPON_ICONS.rifle; }
    const mode = w?.fireMode ?? 'auto';
    if (mode !== this.lastMode) {
      this.lastMode = mode;
      this.modeIcon.innerHTML = FIRE_MODE_ICONS[mode] ?? FIRE_MODE_ICONS.auto;
      setText(this.modeTxt, t(MODE_LABEL[mode] ?? 'mode.auto'));
    }
    const nades = s.game?.grenades;
    setClass(this.root, 'noeq', nades === undefined);
    setText(this.nades, String(nades ?? 0));

    const reloading = w?.reloading ?? false;
    const low = mag > 0 && mag <= Math.ceil(size * 0.2);
    const empty = mag <= 0;
    setClass(this.root, 'low', low && !reloading);
    setClass(this.root, 'empty', empty && !reloading);
    setClass(this.root, 'rlp', (low || empty) && !reloading && reserve > 0);
    setClass(this.root, 'rlg', reloading);
    setText(this.rl, t(reloading ? 'hud.reloading' : reserve <= 0 && (low || empty) ? 'hud.noAmmo' : 'hud.reload'));
  }
}

/**
 * Weapon-swap readout above the ammo cluster. Two slots only (the one you just drew, large with its
 * glyph, and the one you'd swap back to at 40%) — a full inventory list is menu furniture, not HUD.
 */
export class SlotsPopup {
  root = div('slots');
  private anim: ShotAnim | null = null;

  show(slots: WeaponState[], current: WeaponState | undefined): void {
    const cur = Math.max(0, slots.findIndex((w) => w === current || w.id === current?.id));
    const order = slots.length > 1 ? [slots[cur], slots[(cur + 1) % slots.length]] : [slots[cur]];
    this.root.replaceChildren();
    order.forEach((w, i) => {
      if (!w) return;
      const idx = slots.indexOf(w) + 1;
      this.root.append(div(i === 0 ? 's cur' : 's', [
        span('n', String(idx)),
        span('nm', w.name.toUpperCase()),
        svg(WEAPON_ICONS[w.kind] ?? WEAPON_ICONS.rifle, '0 0 44 24'),
      ]));
    });
    this.anim?.cancel();
    const life = theme.timing.weaponSwitch;
    this.anim = animate(this.root, [
      { opacity: 0, transform: 'translateX(10px)', offset: 0 },
      { opacity: 1, transform: 'translateX(0)', offset: 140 / life },
      { opacity: 1, transform: 'translateX(0)', offset: 1 - 280 / life },
      { opacity: 0, transform: 'translateX(0)', offset: 1 },
    ], { duration: life, easing: 'ease-out' }, 500);
  }
}
