/**
 * Killfeed, top-right under the safe margin. One row per kill:
 *   <killer>  [skull?] [weapon line-glyph]  <victim>
 * Names are team-coloured (green = you/allies, red-orange = hostiles) on a 40% black plate, and
 * the weapon glyph is stroked line art at 24px so it stays readable (ref_03).
 */
import { div, span, svg, animate } from './dom';
import { SKULL, WEAPON_ICONS } from './icons';
import { theme } from './theme';
import type { WeaponState } from '../game/Contracts';

const MAX_ROWS = 4;

export class Killfeed {
  root = div('kf');

  push(weapon: Pick<WeaponState, 'kind' | 'name'>, headshot: boolean, victim = 'HOSTILE', killer = 'YOU'): void {
    const row = div('row', [span('nm ally', killer)]);
    if (headshot) row.append(svg(SKULL, '0 0 24 24', 'sk'));
    row.append(svg(WEAPON_ICONS[weapon.kind] ?? WEAPON_ICONS.rifle, '0 0 44 24', 'w'));
    row.append(span('nm en', victim));
    this.root.prepend(row);
    while (this.root.children.length > MAX_ROWS) this.root.lastElementChild?.remove();

    const life = theme.timing.killfeedLife;
    const a = animate(row, [
      { opacity: 0, transform: 'translateX(18px)', offset: 0 },
      { opacity: 1, transform: 'translateX(0)', offset: 160 / life },
      { opacity: 1, transform: 'translateX(0)', offset: 1 - 400 / life },
      { opacity: 0, transform: 'translateX(0)', offset: 1 },
    ], { duration: life, easing: 'cubic-bezier(.2,.8,.2,1)' }, 600);
    a.onfinish = () => row.remove();
  }
}
