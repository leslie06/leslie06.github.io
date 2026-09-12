import { t } from '../core/I18n';
import { C, F } from '../ui/theme';

const CSS = `
.hud .wanted{position:absolute;top:22px;right:28px;display:flex;gap:3px;font:900 30px/1 ${F.ui};opacity:0}
.hud .wanted.active{opacity:1}
.hud .wanted span{color:rgba(255,255,255,.16);text-shadow:0 1px 0 rgba(0,0,0,.7),0 0 10px rgba(0,0,0,.45)}
.hud .wanted span.on{color:#fbfbf8}
.hud .wanted.search span.on{animation:dc-wflash .9s steps(2,jump-none) infinite}
@keyframes dc-wflash{50%{color:rgba(255,255,255,.22)}}
.dc-busted{position:fixed;inset:0;display:grid;place-items:center;z-index:40;pointer-events:none;
  background:radial-gradient(ellipse at center,rgba(8,10,14,.25),rgba(8,10,14,.72));animation:dc-bfade .7s ease both}
.dc-busted b{font:900 clamp(56px,10vw,140px)/1 ${F.ui};letter-spacing:.08em;color:#f4f4f1;
  text-shadow:0 6px 40px rgba(0,0,0,.65);border-bottom:6px solid ${C.yellow};padding-bottom:10px}
.dc-busted[hidden],.hud .wanted [hidden]{display:none}
@keyframes dc-bfade{from{opacity:0}to{opacity:1}}
`;

/** Wanted stars (top-right of the HUD; they flash while the police search) and the BUSTED screen. */
export class WantedHud {
  private root: HTMLDivElement | null = null;
  private stars: HTMLSpanElement[] = [];
  private overlay: HTMLDivElement | null = null;
  private shown = -1;
  private flashing = false;

  private mount(): boolean {
    if (this.root) return true;
    const hud = document.querySelector('.hud');
    if (!hud) return false;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'wanted';
    for (let i = 0; i < 5; i++) { const s = document.createElement('span'); s.textContent = '★'; this.root.appendChild(s); this.stars.push(s); }
    hud.appendChild(this.root);
    this.overlay = document.createElement('div');
    this.overlay.className = 'dc-busted';
    this.overlay.hidden = true;
    const b = document.createElement('b');
    b.textContent = t('wanted.busted');
    this.overlay.appendChild(b);
    (document.getElementById('app') ?? document.body).appendChild(this.overlay);
    return true;
  }

  update(level: number, seen: boolean): void {
    if (!this.mount()) return;
    if (level !== this.shown) {
      this.shown = level;
      this.stars.forEach((s, i) => s.classList.toggle('on', i < level));
      this.root!.classList.toggle('active', level > 0);
    }
    const f = level > 0 && !seen;
    if (f !== this.flashing) { this.flashing = f; this.root!.classList.toggle('search', f); }
  }

  busted(on: boolean): void {
    if (this.mount()) this.overlay!.hidden = !on;
  }
}
