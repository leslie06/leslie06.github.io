import { F } from './theme';

const CSS = `
.dc-banner{position:fixed;inset:0;display:grid;place-items:center;z-index:40;pointer-events:none;
  background:radial-gradient(ellipse at center,rgba(30,4,4,.25),rgba(14,2,2,.74));animation:dc-banner-in .8s ease both}
.dc-banner[hidden]{display:none}
.dc-banner b{font:900 clamp(56px,10vw,140px)/1 ${F.ui};letter-spacing:.08em;color:#d9362d;text-shadow:0 6px 40px rgba(0,0,0,.7)}
@keyframes dc-banner-in{from{opacity:0}to{opacity:1}}
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
