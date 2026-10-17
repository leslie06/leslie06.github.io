import type { Engine } from '../core/Engine';
import { onLangChange } from '../core/I18n';
import type { GuideSign } from '../city/Signs';
import { drawFace, faceSize, type GuideSignApi } from '../city/visual/GuideSigns';
import { css, el } from './theme';

css(`
.hud .signcard{position:absolute;right:var(--hud-x);bottom:calc(var(--hud-y) + 240px);width:min(300px,26vw);opacity:0;transform:translateY(8px);
  transition:opacity .35s,transform .35s;pointer-events:none;filter:drop-shadow(0 4px 14px rgba(0,0,0,.45))}
.hud .signcard.on{opacity:1;transform:none}
.hud .signcard canvas{display:block;width:100%;height:auto}
body.dc-touch .hud .signcard{right:calc(14px + env(safe-area-inset-right,0px));bottom:calc(222px + env(safe-area-inset-bottom,0px));
  width:clamp(110px,calc((100vh - 310px) * 1.7),210px)}
@media (max-height:340px){body.dc-touch .hud .signcard{display:none}}
`);

/** Face pixels per plate pixel: the card is drawn at twice the atlas's size, so it stays crisp at any dpr. */
const SCALE = 2;

/**
 * The guide sign the player is driving up to, on the HUD (2026-10-17, 「远点看不清晰……车开的过程很快，来不及看清
 * 路牌」): its face as the plate shows it, drawn big, from AHEAD m out until the car is under it, then gone. The
 * plates themselves were made bigger too; this is for the ones still too far, or flashing past at speed.
 */
export class SignCard {
  private root: HTMLDivElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private shown: GuideSign | null = null;

  constructor(private engine: Engine, parent: HTMLElement) {
    this.root = el('div', 'signcard', parent);
    this.cv = el('canvas', '', this.root);
    this.g = this.cv.getContext('2d')!;
    onLangChange(() => { if (this.shown) this.draw(this.shown); });
  }

  private draw(s: GuideSign): void {
    const [w, h] = faceSize(s);
    if (this.cv.width !== w * SCALE || this.cv.height !== h * SCALE) { this.cv.width = w * SCALE; this.cv.height = h * SCALE; }
    this.g.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    drawFace(this.g, s, w, h);
  }

  update(on: boolean): void {
    const s = on ? this.engine.get<GuideSignApi>('guideSigns')?.ahead ?? null : null;
    if (s && s !== this.shown) this.draw(s);
    // Fading out keeps the last face; a new one is drawn on its way in.
    if (s) this.shown = s;
    this.root.classList.toggle('on', !!s);
  }
}
