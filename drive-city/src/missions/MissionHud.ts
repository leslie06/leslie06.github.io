import { C, F } from '../ui/theme';

const CSS = `
.hud .cash{position:absolute;top:62px;right:28px;font:800 24px/1 ${F.ui};font-variant-numeric:tabular-nums;letter-spacing:.02em;
  color:#a6e38f;text-shadow:0 1px 0 rgba(0,0,0,.75),0 0 10px rgba(0,0,0,.45)}
.hud .cash.bump{animation:dc-cash .9s ease}
.hud .cash-add[hidden],.hud .objective[hidden]{display:none}
@keyframes dc-cash{0%{transform:scale(1.25);color:#e9ffd9}100%{transform:scale(1)}}
.hud .cash-add{position:absolute;top:92px;right:28px;font:700 17px/1 ${F.ui};color:#a6e38f;text-shadow:0 1px 0 rgba(0,0,0,.75)}
.hud .objective{position:absolute;top:20px;left:50%;transform:translateX(-50%);padding:9px 18px;border-radius:6px;
  background:${C.inkGlass};font:700 16px/1.25 ${F.ui};letter-spacing:.03em;max-width:min(78vw,660px);text-align:center;
  border-bottom:2px solid ${C.yellow};font-variant-numeric:tabular-nums}
`;

/** Cash (top-right, under the wanted stars) and the current objective (top-centre). */
export class MissionHud {
  private cash: HTMLDivElement | null = null;
  private add!: HTMLDivElement;
  private obj!: HTMLDivElement;
  private shownCash = -1;
  private shownObj: string | null = '';
  private addT = 0;

  private mount(): boolean {
    if (this.cash) return true;
    const hud = document.querySelector('.hud');
    if (!hud) return false;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.cash = document.createElement('div'); this.cash.className = 'cash';
    this.add = document.createElement('div'); this.add.className = 'cash-add'; this.add.hidden = true;
    this.obj = document.createElement('div'); this.obj.className = 'objective'; this.obj.hidden = true;
    hud.append(this.cash, this.add, this.obj);
    return true;
  }

  earned(n: number): void {
    if (!this.mount()) return;
    this.add.textContent = `+¥${n}`;
    this.add.hidden = false; this.addT = 3;
    this.cash!.classList.remove('bump'); void this.cash!.offsetWidth; this.cash!.classList.add('bump');
  }

  update(dt: number, cash: number, objective: string | null): void {
    if (!this.mount()) return;
    if (cash !== this.shownCash) { this.shownCash = cash; this.cash!.textContent = `¥${cash.toLocaleString('en-US')}`; }
    if (objective !== this.shownObj) { this.shownObj = objective; this.obj.hidden = !objective; this.obj.textContent = objective ?? ''; }
    if (this.addT > 0) { this.addT -= dt; if (this.addT <= 0) this.add.hidden = true; }
  }
}
