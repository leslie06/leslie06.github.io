import type { Engine } from '../core/Engine';
import type { NavApi, PlayerApi, VehicleApi } from '../game/Contracts';
import { t } from '../core/I18n';
import { css } from './theme';

/**
 * 界面三档（2026-11-10，docs/beijing-immersion-design.md C1）：暂停菜单里选「完整 / 简洁 / 沉浸」，存在本地。
 * - 完整：原来的样子。
 * - 简洁：没有导航目标时小地图缩小、半透明，有目标时恢复。
 * - 沉浸：小地图、速度表、漂移纪录收起来，只留蓝色路牌卡片、地名标题和语音导航；有导航目标时左上角留一条转向提示。
 * 档位写在 body 的 class 上（`dc-hud-simple` / `dc-hud-immersive`），有导航目标时（地图上点的、任务的；主线来电的起点一直都在，不算）小地图再加 `dc-nav-on`，样式都在这里。
 * 默认「完整」；没接任务连续跑图 5 分钟，提示一次可以换「沉浸」。`?hud=full|simple|immersive` 临时指定（不存）。
 */
export type HudMode = 'full' | 'simple' | 'immersive';
export const HUD_MODES: readonly HudMode[] = ['full', 'simple', 'immersive'];
const KEY = 'drivecity.hudMode';
const TIP_KEY = 'drivecity.hudTip';

css(`
body.dc-hud-simple:not(.dc-nav-on) .minimap{transform:scale(.66);opacity:.55}
body.dc-hud-simple .minimap{transform-origin:top left;transition:transform .5s,opacity .5s}
body.dc-hud-immersive:not(.dc-nav-on) .minimap{display:none}
body.dc-hud-immersive .minimap .frame{aspect-ratio:auto;background:none;box-shadow:none}
body.dc-hud-immersive .minimap canvas,body.dc-hud-immersive .minimap .online{display:none}
body.dc-hud-immersive .minimap .turn{position:relative;border-radius:7px;box-shadow:0 6px 20px rgba(0,0,0,.35)}
body.dc-hud-immersive .hud .speedo,body.dc-hud-immersive .hud .best{display:none}
body.dc-hud-immersive.dc-radar .hud .hint{top:var(--hud-y)}
`);

const fromUrl = new URLSearchParams(location.search).get('hud') as HudMode | null;
let mode: HudMode = HUD_MODES.includes(fromUrl as HudMode) ? fromUrl! : 'full';
if (!fromUrl) try { const s = localStorage.getItem(KEY) as HudMode | null; if (s && HUD_MODES.includes(s)) mode = s; } catch { /* private mode */ }
const listeners: ((m: HudMode) => void)[] = [];

function apply(): void {
  document.body.classList.toggle('dc-hud-simple', mode === 'simple');
  document.body.classList.toggle('dc-hud-immersive', mode === 'immersive');
}
apply();

export const hudMode = {
  get value(): HudMode { return mode; },
  set(m: HudMode): void {
    if (m === mode) return;
    mode = m;
    try { localStorage.setItem(KEY, m); } catch { /* private mode */ }
    apply();
    for (const f of listeners) f(m);
  },
  onChange(f: (m: HudMode) => void): void { listeners.push(f); },
};

/** Free roaming this long (no GPS target, driving) in the full HUD: one line saying 沉浸 exists. */
const TIP_AFTER = 300;

/** The one-time tip; `playing` says the game (not a menu) is up, `coach` puts a line on the HUD. */
export function hudTip(engine: Engine, playing: () => boolean, coach: (text: string, secs: number) => void): void {
  let done = false;
  try { done = !!localStorage.getItem(TIP_KEY); } catch { done = true; }
  if (done || new URLSearchParams(location.search).has('shot')) return;
  let roam = 0, poll = 0;
  engine.add({
    name: 'hudTip',
    update(dt) {
      if (done || (poll -= dt) > 0) return;
      poll = 1;
      const nav = engine.get<NavApi>('nav'), car = engine.get<VehicleApi>('vehicle')?.car;
      const driving = engine.get<PlayerApi>('player')?.mode !== 'onfoot' && (car?.speed ?? 0) > 4;
      if (!playing() || mode !== 'full' || (nav?.target && nav.target.kind !== 'story')) { roam = 0; return; }
      if (driving) roam += 1;
      if (roam < TIP_AFTER) return;
      done = true;
      try { localStorage.setItem(TIP_KEY, '1'); } catch { /* ignore */ }
      coach(t('hud.tipImmersive'), 9);
    },
  });
}
