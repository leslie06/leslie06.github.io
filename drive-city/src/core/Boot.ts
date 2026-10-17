import { t, type TKey } from './I18n';
import { stat } from '../online/Funnel';

/**
 * The loading screen's progress bar (index.html draws it from the first byte as `window.__boot`; 2026-10-12,
 * 「游戏加载添加游戏进度」). The boot reports its stages: a span of the bar, a label and roughly how long it takes
 * (the bar creeps through a stage at that pace), and where a stage can count its own progress (the city's files, the
 * spawn's tiles), the fraction done. Nothing here when there is no loading screen (tests, Node).
 */
interface BootUi { stage(from: number, to: number, label?: string, secs?: number): void; sub(f: number): void }
const ui = (): BootUi | undefined => (typeof window !== 'undefined' ? (window as unknown as { __boot?: BootUi }).__boot : undefined);

export const boot = {
  stage(from: number, to: number, label: TKey, secs: number): void { stat.mark('b_' + label.replace(/^boot\./, '')); ui()?.stage(from, to, t(label), secs); },
  sub(f: number): void { ui()?.sub(f); },
};
