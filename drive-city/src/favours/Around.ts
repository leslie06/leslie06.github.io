import type { Engine } from '../core/Engine';
import { lang, t, type TKey } from '../core/I18n';
import type { StreetApi } from '../street';

/** 身边一件能做的事：街头生活、能用的店、没打过卡的地标。 */
export interface Thing { d: number; x: number; z: number; name: string; kind: 'life' | 'shop' | 'landmark' }

/**
 * 身边走得到的事，近的在前（2026-11-10 写在 adventure/ 的「身边」面板里；2026-11-11 搬出来，问路的路人也指它）：
 * 正在进行的街头生活（`life.scenes()`，270 米内才有）、每种能用的店最近的一家（150 米内）、最近一个没打过卡的
 * 地标（1.5 公里内）。
 */
export function thingsNear(engine: Engine, P: { x: number; z: number }): Thing[] {
  const out: Thing[] = [];
  for (const sc of engine.get<{ name: string; scenes?: () => { kind: string; x: number; z: number }[] }>('life')?.scenes?.() ?? []) {
    out.push({ d: Math.hypot(sc.x - P.x, sc.z - P.z), x: sc.x, z: sc.z, name: t(`near.life.${sc.kind}` as TKey), kind: 'life' });
  }
  for (const sh of engine.get<StreetApi>('street')?.nearby(P.x, P.z, 150).slice(0, 4) ?? []) out.push({ d: sh.d, x: sh.x, z: sh.z, name: sh.name, kind: 'shop' });
  const ck = engine.get<{ name: string; sites: readonly { id: string; x: number; z: number; name: { zh: string; en: string } }[]; debug: { has(id: string): boolean } }>('checkin');
  let lm: Thing | null = null;
  for (const s of ck?.sites ?? []) {
    const d = Math.hypot(s.x - P.x, s.z - P.z);
    if (d < 1500 && (!lm || d < lm.d) && !ck!.debug.has(s.id)) lm = { d, x: s.x, z: s.z, name: lang() === 'zh' ? s.name.zh : s.name.en, kind: 'landmark' };
  }
  if (lm) out.push(lm);
  return out.sort((a, b) => a.d - b.d);
}
