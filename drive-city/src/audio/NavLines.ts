/**
 * 语音导航的台词（2026-11-10，docs/beijing-immersion-design.md C2）：两种声音，普通话（导航软件的女声）和京腔（老北京的哥）。
 * 一句提示由几段录音拼成：「前方五百米右转」+「进入东三环」（+「随后左转」）。距离只录几档（一公里、五百米、三百米、两百米），
 * 快到路口时说不带距离的那句（「前方路口右转」「前边儿路口，往右一拐」）。路名在 `NavRoads.ts`（`scripts/voice/nav-roads.mts`
 * 按出现次数挑的），录音 id 用路名的哈希，名单变了旧录音不错位。
 * 录音：`npx tsx scripts/voice/nav.mts` 写 assets/voice/nav.json，`tools/voice-gen/run.sh design|synth --lines assets/voice/nav.json`
 * 录到 assets/voice/nav-raw/，`node scripts/voice/nav-pack.mjs` 打包到 public/voice/nav/<id>.mp3。游戏里 `audio/NavVoice.ts` 按 id 取。
 */
import type { TurnKind } from '../nav/Turns';
import { NAV_ROADS } from './NavRoads';

export type NavVoiceId = 'f' | 'j';
export const NAV_VOICES: readonly NavVoiceId[] = ['f', 'j'];
/** The distances a "前方…米" line is recorded at, far to near. */
export const NAV_DISTS = [1000, 500, 300, 200] as const;
export type NavDist = (typeof NAV_DISTS)[number];
export const NAV_KINDS: readonly TurnKind[] = ['L', 'R', 'SL', 'SR', 'U', 'S', 'exit', 'arrive'];

/** A short stable hash of a road name, for its clip id. */
export function roadKey(name: string): string {
  let h = 0x811c9dc5;
  for (const ch of name) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** Clip ids. */
export const navId = {
  far: (v: NavVoiceId, d: NavDist, k: TurnKind) => `nav.${v}.far.${d}.${k}`,
  near: (v: NavVoiceId, k: TurnKind) => `nav.${v}.near.${k}`,
  then: (v: NavVoiceId, k: TurnKind) => `nav.${v}.then.${k}`,
  road: (v: NavVoiceId, name: string) => `nav.${v}.road.${roadKey(name)}`,
  side: (v: NavVoiceId) => `nav.${v}.fulu`,
  start: (v: NavVoiceId) => `nav.${v}.start`,
  reroute: (v: NavVoiceId) => `nav.${v}.reroute`,
  arrived: (v: NavVoiceId) => `nav.${v}.arrived`,
};

const RECORDED = new Set(NAV_ROADS);
/** The clip that names the road a turn takes you onto, or null (not recorded, or a deck named after its interchange). */
export function roadClip(v: NavVoiceId, road: string): string | null {
  if (!road || /桥$/.test(road)) return null;
  if (/辅路$/.test(road)) return navId.side(v);
  return RECORDED.has(road) ? navId.road(v, road) : null;
}

interface Say { dist: Record<NavDist, string>; far: Record<TurnKind, string>; near: Record<TurnKind, string>; then: Record<TurnKind, string>; onto: (r: string) => string; side: string; start: string; reroute: string; arrived: string; tone: string }
const SAY: Record<NavVoiceId, Say> = {
  f: {
    dist: { 1000: '一公里', 500: '五百米', 300: '三百米', 200: '两百米' },
    far: { L: '左转', R: '右转', SL: '靠左行驶', SR: '靠右行驶', U: '掉头', S: '直行', exit: '进入匝道', arrive: '到达目的地' },
    near: { L: '前方路口左转', R: '前方路口右转', SL: '请靠左行驶', SR: '请靠右行驶', U: '前方路口掉头', S: '继续直行', exit: '请进入匝道', arrive: '目的地就在前方' },
    then: { L: '随后左转', R: '随后右转', SL: '随后靠左', SR: '随后靠右', U: '随后掉头', S: '随后直行', exit: '随后进入匝道', arrive: '随后到达目的地' },
    onto: (r) => `进入${r}`, side: '进入辅路', start: '开始导航，请按路线行驶。', reroute: '您已偏离路线，已为您重新规划。', arrived: '已到达目的地附近，本次导航结束。',
    tone: '导航软件的语音提示，清晰温和，语速适中。',
  },
  j: {
    dist: { 1000: '一公里', 500: '五百米', 300: '三百米', 200: '二百米' },
    far: { L: '往左拐', R: '往右拐', SL: '靠左边儿走', SR: '靠右边儿走', U: '掉头', S: '直着走', exit: '下匝道', arrive: '就到地儿了' },
    near: { L: '前边儿路口，往左一拐', R: '前边儿路口，往右一拐', SL: '您靠左边儿走', SR: '您靠右边儿走', U: '前边儿路口掉个头', S: '接着直走，甭拐', exit: '下匝道，您留神', arrive: '到地儿了，就前边儿' },
    then: { L: '紧跟着往左拐', R: '紧跟着往右拐', SL: '紧跟着靠左', SR: '紧跟着靠右', U: '紧跟着掉头', S: '紧跟着直走', exit: '紧跟着下匝道', arrive: '紧跟着就到了' },
    onto: (r) => `上${r}`, side: '走辅路', start: '得嘞，您坐稳了，咱走着！', reroute: '您走岔了，没事儿，我给您重新规划。', arrived: '到地儿了您呐！',
    tone: '老北京的哥给乘客指路，京腔儿化音，热心随和。',
  },
};

/** What TTS reads for a road name (the OSM spelling has the odd hyphen). */
const spoken = (r: string) => r.replace(/-/g, '');

export interface NavLine { id: string; voice: `nav${NavVoiceId}`; text: string; instruct: string }

/** Every line, in recording order. */
export function navLines(): NavLine[] {
  const out: NavLine[] = [];
  for (const v of NAV_VOICES) {
    const s = SAY[v], push = (id: string, text: string, instruct = s.tone) => out.push({ id, voice: `nav${v}`, text, instruct });
    push(navId.start(v), s.start, v === 'j' ? '热情爽快地招呼。' : s.tone);
    push(navId.reroute(v), s.reroute);
    push(navId.arrived(v), s.arrived, v === 'j' ? '高兴地招呼，带点儿得意。' : s.tone);
    for (const k of NAV_KINDS) push(navId.near(v, k), s.near[k] + '。');
    for (const k of NAV_KINDS) push(navId.then(v, k), s.then[k] + '。');
    for (const d of NAV_DISTS) for (const k of NAV_KINDS) push(navId.far(v, d, k), `${v === 'f' ? '前方' : '前边儿'}${s.dist[d]}${s.far[k]}。`);
    push(navId.side(v), s.side + '。');
    for (const r of NAV_ROADS) push(navId.road(v, r), s.onto(spoken(r)) + '。', v === 'j' ? '老北京的哥指路，京腔，平稳地说出路名。' : '导航软件的语音提示，平稳清晰地说出路名。');
  }
  return out;
}
