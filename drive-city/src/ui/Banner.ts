import { F } from './theme';

const CSS = `
.dc-banner{position:fixed;inset:0;display:grid;place-items:center;z-index:40;pointer-events:none;
  background:radial-gradient(ellipse at center,rgba(30,4,4,.25),rgba(14,2,2,.74));animation:dc-banner-in .8s ease both}
.dc-banner[hidden]{display:none}
.dc-banner b{font:900 clamp(56px,10vw,140px)/1 ${F.ui};letter-spacing:.08em;color:#d9362d;text-shadow:0 6px 40px rgba(0,0,0,.7)}
@keyframes dc-banner-in{from{opacity:0}to{opacity:1}}
/* a phone on its side: a tag at the top instead of a darkened screen with a word across the road (2026-10-20, 「悬赏两个字也会遮住屏幕，影响视线」) */
@media (max-height:470px){
body.dc-touch .dc-banner{inset:auto;top:calc(4px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);background:none}
body.dc-touch .dc-banner b{display:block;font-size:20px;letter-spacing:.12em;padding:5px 16px;border-radius:7px;background:rgba(14,16,18,.86);text-shadow:none;white-space:nowrap}
body.dc-touch:has(.dc-banner:not([hidden])) .hud :is(.objective,.phone,.toast,.combo,.drift){visibility:hidden}
}
`;

/** A full-screen word over the game (WASTED). */
export class Banner {
  private el: HTMLDivElement | null = null;
  private word!: HTMLElement;

  private mount(): void {
    if (this.el) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.className = 'dc-banner';
    this.el.hidden = true;
    this.word = document.createElement('b');
    this.el.appendChild(this.word);
    (document.getElementById('app') ?? document.body).appendChild(this.el);
  }

  show(text: string, color = '#d9362d'): void {
    this.mount();
    this.word.textContent = text; this.word.style.color = color;
    this.el!.hidden = false;
  }
  hide(): void { if (this.el) this.el.hidden = true; }
}
