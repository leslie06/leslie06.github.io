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

let titleUp = () => {};
/**
 * Settles once the title is on screen. What the boot does not need (the Blender trees, the far skyline, the photo
 * textures, the glb landmarks, the other car bodies) waits for it: started as soon as the spawn's tiles were in, it
 * shared a slow link with the last small files the title still waited for (2026-10-17: at 150 KB/s a 2 KB list took
 * 9 s and the title came at 46 s instead of 36).
 */
export const afterTitle = new Promise<void>((r) => { titleUp = r; });

export const boot = {
  stage(from: number, to: number, label: TKey, secs: number): void { stat.mark('b_' + label.replace(/^boot\./, '')); ui()?.stage(from, to, t(label), secs); },
  sub(f: number): void { ui()?.sub(f); },
  /** The title is up (main.ts): let `afterTitle` go. */
  titleShown(): void { titleUp(); },
};
