/**
 * Every player-facing string, in English and Simplified Chinese. ui/, game/ and debug/ read text
 * through `t()`, so the language is a setting rather than a code search.
 *
 * Which language, first match wins:
 *   1. `?lang=zh|en` in the URL
 *   2. shot mode: English, so captures are identical on every machine (`shot.mjs --lang zh` for Chinese)
 *   3. the player's saved choice (Settings > Language, or the switch on the main menu)
 *   4. the browser's language: zh* -> Chinese, anything else -> English
 *
 * Node-safe (no DOM at import): GameLogic's unit tests reach it through lastHostilesText.
 *
 * Templates use `{name}` placeholders; `{nn}` is `{n}` zero-padded to two digits. Where the word
 * order differs ("4 REMAINING" / "剩余 4") the whole phrase is the template, never a label glued
 * to a number by the caller.
 */

export type Lang = 'en' | 'zh';
export const LANGS: readonly Lang[] = ['zh', 'en'];
/** Each language named in itself: the switch must be readable by someone who can't read the other one. */
export const LANG_NAME: Record<Lang, string> = { zh: '中文', en: 'ENGLISH' };

const STORE_KEY = 'gunfight.lang.v1';

const EN = {
  'loading.label': 'LOADING',
  'loading.detail': 'INITIALIZING RENDERER · PHYSICS · ASSETS',

  // screen corners
  'frame.ops': 'GUNFIGHT // OPERATIONS',
  'frame.afterAction': 'GUNFIGHT // AFTER ACTION',
  'frame.paused': 'PAUSED',
  'frame.kia': 'KILLED IN ACTION',
  'frame.settings': 'SETTINGS',
  'frame.controls': 'CONTROLS',

  // main menu
  'menu.tag': 'SURVIVAL · HOLD THE LINE',
  'menu.play': 'PLAY',
  'menu.settings': 'SETTINGS',
  'menu.controls': 'CONTROLS',
  'brief.head': 'MISSION BRIEFING',
  'brief.title': 'HOLD THE LINE',
  'brief.body': 'Hostile squads push the compound in escalating waves. Scavenge ammo, use cover, and survive as long as you can. Headshots score more.',
  'best.wave': 'BEST WAVE',
  'best.score': 'BEST SCORE',
  'best.kills': 'MOST KILLS',

  // footer keycap hints
  'hint.move': 'MOVE',
  'hint.sprint': 'SPRINT',
  'hint.aim': 'AIM',
  'hint.reload': 'RELOAD',
  'hint.resume': 'RESUME',
  'hint.deploy': 'DEPLOY',
  'hint.back': 'BACK',

  // pause
  'pause.title': 'PAUSED',
  'pause.sub': 'WAVE {nn} · {k} KILLS',
  'pause.resume': 'RESUME',
  'pause.quit': 'QUIT TO MENU',

  // death
  'dead.big': 'K.I.A.',
  'dead.sub': 'YOU WERE ELIMINATED',
  'dead.deployIn': 'DEPLOYING IN',
  'dead.deploy': 'DEPLOY',
  'stat.kills': 'KILLS',
  'stat.wave': 'WAVE',
  'stat.score': 'SCORE',
  'stat.streak': 'BEST STREAK',

  // settings
  'set.title': 'SETTINGS',
  'set.sub': 'APPLIED INSTANTLY · SAVED IN THIS BROWSER',
  'set.lang': 'LANGUAGE · 语言',
  'set.sens': 'MOUSE SENSITIVITY',
  'set.invert': 'INVERT LOOK Y',
  'set.fov': 'FIELD OF VIEW',
  'set.fovSub': 'Horizontal FOV, degrees',
  'set.quality': 'GRAPHICS QUALITY',
  'set.qualitySub': 'Changing quality reloads the game',
  'set.master': 'MASTER VOLUME',
  'set.sfx': 'SFX VOLUME',
  'set.music': 'MUSIC VOLUME',
  'opt.off': 'OFF',
  'opt.on': 'ON',
  'q.low': 'LOW',
  'q.medium': 'MEDIUM',
  'q.high': 'HIGH',
  'q.ultra': 'ULTRA',
  'ui.back': 'BACK',
  'ui.escBack': 'Esc to go back',

  // controls
  'ctl.title': 'CONTROLS',
  'ctl.sub': 'KEYBOARD & MOUSE',
  'ctl.move': 'MOVE',
  'ctl.sprint': 'SPRINT',
  'ctl.jump': 'JUMP',
  'ctl.crouch': 'CROUCH / SLIDE',
  'ctl.fire': 'FIRE',
  'ctl.ads': 'AIM DOWN SIGHTS',
  'ctl.reload': 'RELOAD',
  'ctl.slots': 'WEAPON SLOTS',
  'ctl.cycle': 'CYCLE WEAPON',
  'ctl.melee': 'MELEE',
  'ctl.grenade': 'GRENADE',
  'ctl.interact': 'INTERACT',
  'ctl.inspect': 'INSPECT WEAPON',
  'ctl.pause': 'PAUSE',
  // keycaps that are words, not legends printed on the key
  'key.space': 'SPACE',
  'key.lmb': 'LMB',
  'key.rmb': 'RMB',
  'key.scroll': 'SCROLL',

  // HUD
  'hud.hp': 'HP',
  'hud.reload': 'RELOAD',
  'hud.reloading': 'RELOADING',
  'hud.noAmmo': 'NO AMMO',
  'mode.auto': 'AUTO',
  'mode.semi': 'SEMI',
  'mode.burst': 'BURST',
  'mode.bolt': 'BOLT',
  'mode.pump': 'PUMP',
  'kf.you': 'YOU',
  'kf.hostile': 'HOSTILE',
  'sp.headshot': 'HEADSHOT',
  'sp.kill': 'KILL',
  'sp.streak2': 'DOUBLE KILL',
  'sp.streak3': 'TRIPLE KILL',
  'sp.streak4': 'QUAD KILL',
  'sp.streak5': 'KILL FRENZY',
  'sp.streak6': 'RAMPAGE',
  'obj.eliminate': 'ELIMINATE ALL HOSTILES',
  'obj.remaining': '{n} REMAINING',
  'obj.clear': 'WAVE CLEAR · NEXT WAVE IN',
  'obj.seconds': '{n} SECONDS',
  'wave.banner': 'WAVE {nn}',
  'wave.inbound': 'ENEMIES INBOUND',
  'prompt.interact': 'INTERACT',
  // compass / minimap cardinals, clockwise from north
  'dir.0': 'N',
  'dir.1': 'NE',
  'dir.2': 'E',
  'dir.3': 'SE',
  'dir.4': 'S',
  'dir.5': 'SW',
  'dir.6': 'W',
  'dir.7': 'NW',

  // game-mode callouts (game/)
  'msg.wave': 'WAVE {n}',
  'msg.waveIncoming': 'WAVE {n} INCOMING',
  'msg.waveComplete': 'WAVE {n} COMPLETE  +{bonus}',
  'msg.finalHostile': 'FINAL HOSTILE',
  'msg.lastHostiles': 'LAST {n} HOSTILES',
  'msg.resupplyPrompt': '[E]  RESUPPLY',
  'msg.resupplied': 'AMMO RESUPPLIED',

  // debug/ banners. HTML, static and trusted; only escaped values are ever spliced in.
  'diag.crashTitle': 'The last session did not exit cleanly (the browser reloaded or killed the page)',
  'diag.crashBody': 'Below is the memory/resource log from the last few minutes before it died. Please copy it and send it over.',
  'diag.crashClose': 'click the title to close',
  'diag.copy': 'Copy log',
  'diag.copied': 'Copied',
  'diag.gpuSoft': 'The browser is rendering in software (no GPU acceleration)',
  'diag.gpuIntegrated': 'The browser is using integrated graphics, not your dedicated GPU',
  'diag.gpuAdapter': 'Current adapter: ',
  'diag.gpuSteps':
    'The game has dropped to <b>low</b> quality automatically. To run on the dedicated GPU:<br>' +
    '&nbsp;1. Make sure the monitor cable is plugged into the <b>graphics card</b>, not the motherboard;<br>' +
    '&nbsp;2. Windows Settings → System → Display → Graphics → find your browser → choose "High performance";<br>' +
    '&nbsp;3. Open <b>chrome://gpu</b> and check that GL_RENDERER now says NVIDIA;<br>' +
    '&nbsp;4. Then set graphics quality back to high in Settings.<br>' +
    '<span style="opacity:.6">F9 shows the live frame rate · click to close</span>',
  'diag.lost':
    '<div><b style="color:#f6b26b;font-size:16px">The graphics driver reset (WebGL context lost)</b><br><br>' +
    'The game did not quit: the GPU took its rendering context back. Common causes:<br>' +
    'a frame ran past the Windows driver watchdog (TDR, 2 s by default), GPU memory ran out, or the card throttled from heat.<br><br>' +
    '<b>Reload the page (F5)</b> to start again. If it keeps happening, open with <b>?quality=medium</b> or <b>?fps=30</b>,<br>' +
    'and send the MEMORY line from the F9 panel.</div>',
  // F9 panel
  'diag.adapterUnknown': '  (adapter unknown)',
  'diag.software': 'SOFTWARE',
  'diag.integrated': 'INTEGRATED',
  'diag.uncapped': 'none',
  'diag.tier': 'TIER    {tier}   pixel ratio {pr}  (adaptive {scale}, cap {mp} MP)  fps cap {cap}',
  'diag.buffer': 'BUFFER  {w}×{h}  = {mp} MP    window {iw}×{ih} @{dpr}x',
  'diag.frame': 'FRAME   mean {mean} ms ({fps} fps)   median {med} ms   p95 {p95} ms',
  'diag.draw': 'DRAW    {calls} calls   {tris}k tris   shaders {prog}',
  'diag.mem': 'MEMORY  geometry {geo} (peak {pgeo})   textures {tex} (peak {ptex})',
  'diag.heap': '   JS heap {heap} MB (peak {pheap})',
  'diag.released': 'FREED   {n} source images ({mb} MB)   shrunk {s}',
  'diag.toggle': 'F9 toggles this panel',
} as const;

export type TKey = keyof typeof EN;
export type TParams = Record<string, string | number>;

const ZH: Record<TKey, string> = {
  'loading.label': '加载中',
  'loading.detail': '正在初始化 渲染器 · 物理 · 资源',

  'frame.ops': 'GUNFIGHT // 作战行动',
  'frame.afterAction': 'GUNFIGHT // 战后报告',
  'frame.paused': '已暂停',
  'frame.kia': '阵亡',
  'frame.settings': '设置',
  'frame.controls': '操作说明',

  'menu.tag': '生存模式 · 坚守防线',
  'menu.play': '开始游戏',
  'menu.settings': '设置',
  'menu.controls': '操作说明',
  'brief.head': '任务简报',
  'brief.title': '坚守防线',
  'brief.body': '敌方小队会一波接一波地强攻营地，攻势逐波升级。搜刮弹药、利用掩体，尽可能坚持下去。爆头得分更高。',
  'best.wave': '最高波次',
  'best.score': '最高得分',
  'best.kills': '最多击杀',

  'hint.move': '移动',
  'hint.sprint': '冲刺',
  'hint.aim': '瞄准',
  'hint.reload': '换弹',
  'hint.resume': '继续',
  'hint.deploy': '部署',
  'hint.back': '返回',

  'pause.title': '已暂停',
  'pause.sub': '第 {n} 波 · 击杀 {k}',
  'pause.resume': '继续游戏',
  'pause.quit': '退出到主菜单',

  'dead.big': '阵亡',
  'dead.sub': '你已被击杀',
  'dead.deployIn': '部署倒计时',
  'dead.deploy': '重新部署',
  'stat.kills': '击杀',
  'stat.wave': '波次',
  'stat.score': '得分',
  'stat.streak': '最高连杀',

  'set.title': '设置',
  'set.sub': '即时生效 · 保存在本浏览器',
  'set.lang': '语言 · LANGUAGE',
  'set.sens': '鼠标灵敏度',
  'set.invert': '反转垂直视角',
  'set.fov': '视野',
  'set.fovSub': '水平视野，单位：度',
  'set.quality': '画质',
  'set.qualitySub': '更改画质会重新加载游戏',
  'set.master': '主音量',
  'set.sfx': '音效音量',
  'set.music': '音乐音量',
  'opt.off': '关',
  'opt.on': '开',
  'q.low': '低',
  'q.medium': '中',
  'q.high': '高',
  'q.ultra': '极高',
  'ui.back': '返回',
  'ui.escBack': '按 Esc 返回',

  'ctl.title': '操作说明',
  'ctl.sub': '键盘与鼠标',
  'ctl.move': '移动',
  'ctl.sprint': '冲刺',
  'ctl.jump': '跳跃',
  'ctl.crouch': '蹲下 / 滑铲',
  'ctl.fire': '开火',
  'ctl.ads': '开镜瞄准',
  'ctl.reload': '换弹',
  'ctl.slots': '武器栏位',
  'ctl.cycle': '切换武器',
  'ctl.melee': '近战攻击',
  'ctl.grenade': '投掷手雷',
  'ctl.interact': '互动',
  'ctl.inspect': '检视武器',
  'ctl.pause': '暂停',
  'key.space': '空格',
  'key.lmb': '左键',
  'key.rmb': '右键',
  'key.scroll': '滚轮',

  'hud.hp': '生命',
  'hud.reload': '换弹',
  'hud.reloading': '换弹中',
  'hud.noAmmo': '弹药耗尽',
  'mode.auto': '全自动',
  'mode.semi': '半自动',
  'mode.burst': '点射',
  'mode.bolt': '栓动',
  'mode.pump': '泵动',
  'kf.you': '你',
  'kf.hostile': '敌人',
  'sp.headshot': '爆头',
  'sp.kill': '击杀',
  'sp.streak2': '双杀',
  'sp.streak3': '三杀',
  'sp.streak4': '四杀',
  'sp.streak5': '杀戮狂潮',
  'sp.streak6': '暴走',
  'obj.eliminate': '消灭所有敌人',
  'obj.remaining': '剩余 {n}',
  'obj.clear': '本波已肃清',
  'obj.seconds': '下一波 {n} 秒后',
  'wave.banner': '第 {n} 波',
  'wave.inbound': '敌军来袭',
  'prompt.interact': '互动',
  'dir.0': '北',
  'dir.1': '东北',
  'dir.2': '东',
  'dir.3': '东南',
  'dir.4': '南',
  'dir.5': '西南',
  'dir.6': '西',
  'dir.7': '西北',

  'msg.wave': '第 {n} 波',
  'msg.waveIncoming': '第 {n} 波即将来袭',
  'msg.waveComplete': '第 {n} 波完成  +{bonus}',
  'msg.finalHostile': '最后一名敌人',
  'msg.lastHostiles': '最后 {n} 名敌人',
  'msg.resupplyPrompt': '[E]  补充弹药',
  'msg.resupplied': '弹药已补充',

  'diag.crashTitle': '上次游戏没有正常退出（页面被浏览器重载或杀掉了）',
  'diag.crashBody': '下面是崩溃前最后几分钟的内存/资源记录，请复制发出来。',
  'diag.crashClose': '点标题关闭',
  'diag.copy': '复制记录',
  'diag.copied': '已复制',
  'diag.gpuSoft': '浏览器正在用软件渲染（没有 GPU 加速）',
  'diag.gpuIntegrated': '浏览器正在用核显，不是你的独立显卡',
  'diag.gpuAdapter': '当前适配器：',
  'diag.gpuSteps':
    '游戏已自动降到 <b>low</b> 画质。要用独显跑，请：<br>' +
    '&nbsp;1. 确认显示器线插在<b>显卡</b>上，不是主板背板；<br>' +
    '&nbsp;2. Windows 设置 → 系统 → 显示 → 显示卡 → 找到浏览器 → 选“高性能”；<br>' +
    '&nbsp;3. 浏览器地址栏进 <b>chrome://gpu</b> 确认 GL_RENDERER 变成 NVIDIA；<br>' +
    '&nbsp;4. 之后在设置里把画质调回 high。<br>' +
    '<span style="opacity:.6">按 F9 看实时帧数 · 点此关闭</span>',
  'diag.lost':
    '<div><b style="color:#f6b26b;font-size:16px">显卡驱动重置了（WebGL 上下文丢失）</b><br><br>' +
    '这不是游戏退出，是 GPU 把渲染上下文收回去了。常见原因：<br>' +
    '单帧耗时超过 Windows 的驱动看门狗（TDR，默认 2 秒）、显存耗尽、或者显卡过热降频。<br><br>' +
    '<b>刷新页面（F5）</b>即可重开。如果反复出现，用 <b>?quality=medium</b> 或 <b>?fps=30</b> 打开，<br>' +
    '并把 F9 面板里的"资源"那行发出来。</div>',
  'diag.adapterUnknown': '  (适配器未知)',
  'diag.software': '软件渲染',
  'diag.integrated': '核显',
  'diag.uncapped': '不限',
  'diag.tier': '档位    {tier}   像素比 {pr}  (自适应 {scale}, 上限 {mp} MP)  帧率上限 {cap}',
  'diag.buffer': '缓冲    {w}×{h}  = {mp} MP    窗口 {iw}×{ih} @{dpr}x',
  'diag.frame': '帧      均值 {mean} ms ({fps} fps)   中位 {med} ms   p95 {p95} ms',
  'diag.draw': '绘制    {calls} 次   {tris}k 三角面   着色器 {prog}',
  'diag.mem': '资源    几何 {geo} (峰 {pgeo})   纹理 {tex} (峰 {ptex})',
  'diag.heap': '   JS 堆 {heap} MB (峰 {pheap})',
  'diag.released': '资源释放 {n} 张源图 ({mb} MB)   缩小 {s} 张',
  'diag.toggle': 'F9 开关此面板',
};

/** Both tables, for the placeholder-parity test. */
export const STRINGS: Readonly<Record<Lang, Readonly<Record<TKey, string>>>> = { en: EN, zh: ZH };

const isLang = (v: unknown): v is Lang => v === 'en' || v === 'zh';

function detect(): Lang {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  const fromUrl = q?.get('lang');
  if (isLang(fromUrl)) return fromUrl;
  if (q?.has('shot')) return 'en';
  try { const saved = localStorage.getItem(STORE_KEY); if (isLang(saved)) return saved; } catch { /* no storage: node, private mode */ }
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  return /^zh/i.test(nav ?? '') ? 'zh' : 'en';
}

let current: Lang = detect();
const listeners = new Set<(l: Lang) => void>();

/** `lang` on <html> picks the Simplified-Chinese glyph forms and font fallback for the whole page. */
function stampDocument(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en';
}
stampDocument();

export function lang(): Lang { return current; }

export function setLang(l: Lang): void {
  if (l === current) return;
  current = l;
  try { localStorage.setItem(STORE_KEY, l); } catch { /* not persisted; still applies to this session */ }
  // A `?lang=` left in the address bar would override this choice on the next load (and the quality
  // switch reloads with the current URL), so keep it in step.
  if (typeof location !== 'undefined' && typeof history !== 'undefined') {
    const url = new URL(location.href);
    if (url.searchParams.has('lang')) { url.searchParams.set('lang', l); history.replaceState(history.state, '', url); }
  }
  stampDocument();
  for (const fn of listeners) { try { fn(l); } catch (e) { console.error('[i18n]', e); } }
}

export function onLangChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Translate. Without params this is a plain table lookup, so it is safe to call every frame. */
export function t(key: TKey, params?: TParams): string {
  const s = (current === 'zh' ? ZH : EN)[key];
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
}
