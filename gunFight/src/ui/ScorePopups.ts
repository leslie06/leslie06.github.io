/**
 * Score popups just right of the crosshair. Deliberately small and short-lived (0.6 s): the centre
 * 60% of the frame stays clear in every reference frame, so at most two are ever on screen and a
 * third retires the oldest immediately.
 */
import { div, span, animate, type ShotAnim } from './dom';
import { theme } from './theme';
import { t, type TKey } from '../core/I18n';

const STREAK_NAMES: Record<number, TKey> = { 2: 'sp.streak2', 3: 'sp.streak3', 4: 'sp.streak4', 5: 'sp.streak5', 6: 'sp.streak6' };
const MAX_LIVE = 2;

export class ScorePopups {
  root = div('score');
  private live: { el: HTMLElement; anim: ShotAnim }[] = [];

  push(points: number, label: string, cls = ''): void {
    while (this.live.length >= MAX_LIVE) this.retire(this.live[0]);
    const e = div('sp ' + cls, [span('pts', `+${points}`), span('lbl', label)]);
    this.root.append(e);
    const life = theme.timing.scorePopup;
    const anim = animate(e, [
      { opacity: 0, transform: 'translate(-3px,.25em)', offset: 0 },
      { opacity: 1, transform: 'translate(0,0)', offset: 90 / life },
      { opacity: 1, transform: 'translate(0,0)', offset: 1 - 200 / life },
      { opacity: 0, transform: 'translate(0,-.35em)', offset: 1 },
    ], { duration: life, easing: 'cubic-bezier(.2,.7,.3,1)' }, 230);
    const rec = { el: e, anim };
    this.live.push(rec);
    anim.onfinish = () => this.retire(rec);
  }

  private retire(rec: { el: HTMLElement; anim: ShotAnim }): void {
    const i = this.live.indexOf(rec);
    if (i < 0) return;
    this.live.splice(i, 1);
    rec.anim.onfinish = null;
    rec.anim.cancel();
    rec.el.remove();
  }

  kill(headshot: boolean, streak: number): void {
    if (headshot) this.push(150, t('sp.headshot'), 'hs'); else this.push(100, t('sp.kill'));
    const name = STREAK_NAMES[Math.min(streak, 6)];
    if (streak >= 2 && name) this.push(streak * 25, t(name), 'streak');
  }
}
