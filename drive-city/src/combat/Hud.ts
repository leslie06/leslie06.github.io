import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { t } from '../core/I18n';
import type { HudApi } from '../game/Contracts';

/**
 * What a fist fight puts on screen (combat/): a short health bar over each gang member still standing within 20 m,
 * and over the one winding up a red "!" with the counter key - the window to press it; over the one a press would
 * kick into a car or a wall (the finisher) a gold mark. The first fight also shows the keys once.
 */
export class CombatHud {
  private root: HTMLDivElement | null = null;
  private tags: { el: HTMLDivElement; bar: HTMLElement; fin: HTMLElement }[] = [];
  private v = new THREE.Vector3();
  private hinted = false;
  private touch = typeof document !== 'undefined' && document.body.classList.contains('dc-touch');

  constructor(private engine: Engine) {}

  private mount(): HTMLDivElement | null {
    if (this.root) return this.root;
    const hud = document.querySelector('.hud');
    if (!hud) return null;
    const style = document.createElement('style');
    style.textContent = '.hud .cmb{position:absolute;inset:0;pointer-events:none}'
      + '.hud .cmb>div{position:absolute;width:46px;height:5px;margin-left:-23px;border-radius:3px;background:rgba(8,10,12,.6);box-shadow:inset 0 0 0 1px rgba(244,241,232,.2)}'
      + '.hud .cmb>div>i{display:block;height:100%;border-radius:3px;background:#e0463a}'
      + '.hud .cmb>div>b{display:none;position:absolute;left:50%;bottom:9px;transform:translateX(-50%);min-width:26px;height:26px;padding:0 6px;box-sizing:border-box;border-radius:13px;'
      + 'background:#e0463a;color:#fff;font:800 14px/26px system-ui,sans-serif;text-align:center;white-space:nowrap;box-shadow:0 0 0 3px rgba(224,70,58,.35),0 0 18px rgba(224,70,58,.8);animation:cmbp .32s ease-in-out infinite alternate}'
      + '.hud .cmb>div.warn>b{display:block}'
      + '.hud .cmb>div>u{display:none;position:absolute;left:50%;bottom:9px;transform:translateX(-50%);height:24px;padding:0 9px;border-radius:12px;background:#f3b50f;color:#141416;'
      + 'font:800 13px/24px system-ui,sans-serif;text-decoration:none;white-space:nowrap;box-shadow:0 0 0 3px rgba(243,181,15,.3),0 0 16px rgba(243,181,15,.7)}'
      + '.hud .cmb>div.fin:not(.warn)>u{display:block}@keyframes cmbp{from{transform:translateX(-50%) scale(.9)}to{transform:translateX(-50%) scale(1.12)}}';
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'cmb';
    hud.appendChild(this.root);
    return this.root;
  }

  draw(list: readonly { x: number; y: number; z: number; hp: number; warn: boolean; fin: 'car' | 'wall' | null; standing: boolean }[], engaged: boolean): void {
    if (!list.length && !this.root) return;
    const root = this.mount();
    if (!root) return;
    const cam = this.engine.camera, w = root.clientWidth, h = root.clientHeight;
    while (this.tags.length < list.length) {
      const el = document.createElement('div'), bar = document.createElement('i'), b = document.createElement('b'), fin = document.createElement('u');
      b.textContent = this.touch ? '!' : t('combat.counterKey');
      el.append(bar, b, fin); root.appendChild(el);
      this.tags.push({ el, bar, fin });
    }
    for (let i = 0; i < this.tags.length; i++) {
      const tag = this.tags[i], f = list[i];
      let show = !!f && f.standing;
      if (show) {
        this.v.set(f.x, f.y + 1.72, f.z);   // the crown, then a fixed lift on screen: the on-foot camera is at head height
        const d = this.v.distanceTo(cam.position);
        this.v.project(cam);
        show = d < 20 && this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
      }
      tag.el.style.display = show ? '' : 'none';
      if (!show) continue;
      tag.el.style.left = `${((this.v.x + 1) / 2 * w).toFixed(0)}px`;
      tag.el.style.top = `${((1 - this.v.y) / 2 * h - 16).toFixed(0)}px`;
      tag.bar.style.width = `${Math.max(0, f.hp * 100).toFixed(0)}%`;
      tag.el.classList.toggle('warn', f.warn);
      tag.el.classList.toggle('fin', !!f.fin);
      if (f.fin) { const s = t(f.fin === 'car' ? 'combat.finCar' : 'combat.finWall', { key: this.touch ? t('touch.push') : 'E' }); if (tag.fin.textContent !== s) tag.fin.textContent = s; }
    }
    if (engaged && !this.hinted) {
      this.hinted = true;
      this.engine.get<HudApi>('hud')?.toast(t(this.touch ? 'combat.hintTouch' : 'combat.hint'));
    }
  }
}
