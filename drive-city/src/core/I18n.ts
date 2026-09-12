/**
 * Every player-facing string, in Simplified Chinese and English. ui/ and debug/ read text through
 * `t()`, so the language is a setting rather than a code search.
 *
 * Which language, first match wins:
 *   1. `?lang=zh|en` in the URL
 *   2. shot mode: English, so captures are identical on every machine (`shot.mjs --lang zh` for Chinese)
 *   3. the player's saved choice (the switch on the start screen)
 *   4. the browser's language: zh* -> Chinese, anything else -> English
 *
 * Node-safe (no DOM at import). Templates use `{name}` placeholders; where word order differs the
 * whole phrase is the template, never a label glued to a number by the caller.
 *
 * In-world signage (the driving-school gate, lane stencils, the plate) stays Chinese in both
 * languages: it is part of the place, like a street sign in a film.
 */

export type Lang = 'en' | 'zh';
export const LANGS: readonly Lang[] = ['zh', 'en'];
/** Each language named in itself: the switch must be readable by someone who can't read the other one. */
export const LANG_NAME: Record<Lang, string> = { zh: '中文', en: 'EN' };

const STORE_KEY = 'drivecity.lang.v1';

const EN = {
  'title.name': 'B CITY CHASE',
  'title.tag': 'OPEN WORLD',
  'title.sub': 'From Tiananmen to Guomao',
  'title.start': 'START DRIVING',
  'title.resume': 'RESUME',
  'title.loading': 'LOADING',
  'title.note': 'Drive a taxi and pick up fares. Get out anywhere, take any car, and keep the police off your back.',
  'title.controls': 'CONTROLS',

  'ctl.drive': 'Accelerate / brake · reverse',
  'ctl.steer': 'Steer',
  'ctl.handbrake': 'Handbrake',
  'ctl.camera': 'Change camera',
  'ctl.lookBack': 'Look behind',
  'ctl.orbit': 'Look around',
  'ctl.horn': 'Horn',
  'ctl.reset': 'Reset car',
  'ctl.burnout': 'Burnout (when stopped)',
  'ctl.mute': 'Mute',
  'ctl.help': 'Show / hide controls',
  'ctl.pause': 'Pause',
  'ctl.pad': 'Gamepad: RT/LT pedals · left stick steer · A handbrake · Y get in/out · D-pad ↓ reset · D-pad ↑ map · View camera',
  'key.mouse': 'Mouse',
  'key.space': 'Space',

  'pause.title': 'PAUSED',
  'pause.hint': 'Click or press Esc to keep driving',

  'hud.kmh': 'KM/H',
  'hud.drift': 'DRIFT',
  'hud.driftBank': '+{n} banked',
  'hud.driftLost': 'crashed · lost',
  'hud.best': 'BEST {n}',
  'hud.air': 'AIR {s}s',
  'hud.gearR': 'R',
  'hud.gearN': 'N',
  'hud.flipped': 'Press R to put the car back on its wheels',
  'hud.camera.chase': 'CAMERA · CHASE',
  'hud.camera.far': 'CAMERA · FAR',
  'hud.camera.near': 'CAMERA · NEAR',
  'hud.camera.hood': 'CAMERA · HOOD',
  'hud.muted': 'SOUND OFF',
  'hud.unmuted': 'SOUND ON',
  'hud.helpHint': 'F1 controls',
  'hud.enterCar': 'F  Get in',
  'hud.ride': 'F  Ride',
  'hud.rideOff': 'F  Get off',
  'park.board': '{name} - hold on',
  'park.done': '{name} - thanks for riding',
  'park.closed': '{name} is running, wait for it to come back',
  'home.welcome': 'Home',
  'home.saved': 'Saved at home · ¥{cash} banked, and you are patched up',
  'wanted.busted': 'BUSTED',
  'wanted.lost': 'Lost the cops',
  'player.wasted': 'WASTED',
  'race.label': 'Street race',
  'race.hint': 'Stop in the red marker to start a street race',
  'race.go': 'GO!',
  'race.status': 'Race · checkpoint {cp}/{n} · P{pos}/{of} · {time}',
  'race.finish': 'Finished P{place} in {time} · prize ¥{prize}',
  'race.fail': 'Race abandoned',
  'player.bill': 'Hospital bill ¥{n}',
  'car.dead': 'The engine is wrecked. It will only limp now.',
  'ctl.shove': 'Shove someone aside (on foot)',
  'touch.gas': 'GAS',
  'touch.brake': 'BRAKE',
  'touch.hand': 'HAND',
  'touch.door': 'IN/OUT',
  'touch.cam': 'CAM',
  'touch.map': 'MAP',
  'touch.pause': 'II',
  'touch.jump': 'JUMP',
  'touch.run': 'RUN',
  'touch.push': 'PUSH',
  'touch.rotate': 'Turn your phone sideways to play',
  'taxi.hail': 'Someone is hailing a cab nearby',
  'taxi.pickup': 'Pick up the passenger',
  'taxi.boarding': 'The passenger is getting in…',
  'taxi.fare': 'Passenger',
  'taxi.to': 'Drive to {place}',
  'taxi.say1': '"{place}, please."',
  'taxi.say2': '"{place}, and step on it!"',
  'taxi.say3': '"To {place}. No rush."',
  'taxi.careful': '"Easy, driver!"',
  'taxi.paid': 'Fare ¥{fare} · tip ¥{tip}',
  'taxi.late': 'Too slow: the passenger got out',
  'taxi.scared': 'The police scared your passenger off',
  'taxi.left': 'You left your passenger',
  'taxi.gone': 'The passenger took another cab',
  'ctl.enter': 'Get in / out of a car',
  'ctl.sprint': 'Sprint (on foot)',

  'settings.quality': 'Graphics',
  'settings.q.low': 'Low',
  'settings.q.medium': 'Medium',
  'settings.q.high': 'High',

  'diag.title': 'DIAGNOSTICS (F9)',
  'diag.crashed': 'Previous session ended abnormally',
  'err.context': 'The graphics driver dropped the page (GPU reset or out of memory). Reload to keep driving.',
  'nav.arrived': 'Arrived at the waypoint',
  'nav.north': 'N',
  'nav.waypoint': 'Waypoint',
  'nav.mission': 'Mission',
  'nav.km': '{n} km',
  'nav.m': '{n} m',
  'nav.noRoute': 'no road route',
  'ctl.map': 'Map',
  'map.title': 'MAP',
  'map.city': 'Central Beijing',
  'map.legend': 'LEGEND',
  'map.you': 'You',
  'map.waypoint': 'Waypoint',
  'map.mission': 'Mission target',
  'map.pickup': 'Pick-up',
  'map.dropoff': 'Drop-off',
  'map.police': 'Police',
  'map.car': 'Car',
  'map.landmark': 'Landmark',
  'map.route': 'GPS route',
  'map.search': 'Police search area',
  'map.set': 'Set waypoint',
  'map.clear': 'Clear waypoint',
  'map.pan': 'Pan',
  'map.zoom': 'Zoom',
  'map.close': 'Close',
  'map.key.click': 'Click',
  'map.key.rclick': 'Right-click',
  'map.key.drag': 'Drag',
  'map.key.wheel': 'Wheel',
  'map.left': '{d} to go',
  'map.loading': 'Loading map detail {n}%',
};

export type TKey = keyof typeof EN;
export type TParams = Record<string, string | number>;

const ZH: Record<TKey, string> = {
  'title.name': 'b城追车',
  'title.tag': '开放世界',
  'title.sub': '从天安门到国贸',
  'title.start': '开始驾驶',
  'title.resume': '继续',
  'title.loading': '加载中',
  'title.note': '开着出租车拉活儿。随时下车、随手抢车，别让警察盯上你。',
  'title.controls': '操作',

  'ctl.drive': '油门 / 刹车 · 倒车',
  'ctl.steer': '转向',
  'ctl.handbrake': '手刹',
  'ctl.camera': '切换视角',
  'ctl.lookBack': '向后看',
  'ctl.orbit': '环视',
  'ctl.horn': '喇叭',
  'ctl.reset': '车辆复位',
  'ctl.burnout': '原地烧胎（停车时）',
  'ctl.mute': '静音',
  'ctl.help': '显示 / 隐藏操作说明',
  'ctl.pause': '暂停',
  'ctl.pad': '手柄：RT/LT 油门刹车 · 左摇杆转向 · A 手刹 · Y 上下车 · 十字键↓ 复位 · 十字键↑ 地图 · View 切视角',
  'key.mouse': '鼠标',
  'key.space': '空格',

  'pause.title': '已暂停',
  'pause.hint': '点击或按 Esc 继续驾驶',

  'hud.kmh': 'KM/H',
  'hud.drift': '漂移',
  'hud.driftBank': '+{n} 已入账',
  'hud.driftLost': '撞了 · 分数作废',
  'hud.best': '最高 {n}',
  'hud.air': '腾空 {s} 秒',
  'hud.gearR': 'R',
  'hud.gearN': 'N',
  'hud.flipped': '按 R 把车翻回来',
  'hud.camera.chase': '视角 · 跟车',
  'hud.camera.far': '视角 · 远景',
  'hud.camera.near': '视角 · 近景',
  'hud.camera.hood': '视角 · 引擎盖',
  'hud.muted': '声音已关',
  'hud.unmuted': '声音已开',
  'hud.helpHint': 'F1 操作说明',
  'hud.enterCar': 'F  上车',
  'hud.ride': 'F  乘坐',
  'hud.rideOff': 'F  下来',
  'park.board': '{name} 开始，坐稳了',
  'park.done': '{name} 结束，欢迎再来',
  'park.closed': '{name} 正在运行，等它回站',
  'home.welcome': '到家了',
  'home.saved': '已存档 · 现金 ¥{cash} 已入账，伤也养好了',
  'wanted.busted': '被捕',
  'wanted.lost': '甩掉了警察',
  'player.wasted': '死亡',
  'race.label': '街头赛车',
  'race.hint': '在红色标记里停车，开始街头赛车',
  'race.go': '出发！',
  'race.status': '赛车 · 检查点 {cp}/{n} · 第{pos}/{of}名 · {time}',
  'race.finish': '第{place}名冲线，用时 {time} · 奖金 ¥{prize}',
  'race.fail': '比赛放弃',
  'player.bill': '医药费 ¥{n}',
  'car.dead': '发动机快散架了，只能慢慢挪了。',
  'ctl.shove': '推开行人（步行）',
  'touch.gas': '油门',
  'touch.brake': '刹车',
  'touch.hand': '手刹',
  'touch.door': '上下车',
  'touch.cam': '视角',
  'touch.map': '地图',
  'touch.pause': '暂停',
  'touch.jump': '跳',
  'touch.run': '跑',
  'touch.push': '推',
  'touch.rotate': '横屏玩更舒服',
  'taxi.hail': '附近有人招手打车',
  'taxi.pickup': '去接乘客',
  'taxi.boarding': '乘客正在上车……',
  'taxi.fare': '乘客',
  'taxi.to': '送乘客去 {place}',
  'taxi.say1': '“师傅，去{place}。”',
  'taxi.say2': '“去{place}，赶时间，快点儿！”',
  'taxi.say3': '“去{place}，不着急，您开稳当点儿。”',
  'taxi.careful': '“师傅您慢点儿开！”',
  'taxi.paid': '车费 ¥{fare} · 小费 ¥{tip}',
  'taxi.late': '太慢了，乘客下车走了',
  'taxi.scared': '警察来了，乘客吓跑了',
  'taxi.left': '你把乘客扔下了',
  'taxi.gone': '乘客打了别的车',
  'ctl.enter': '上车 / 下车',
  'ctl.sprint': '冲刺（步行）',

  'settings.quality': '画质',
  'settings.q.low': '低',
  'settings.q.medium': '中',
  'settings.q.high': '高',

  'diag.title': '诊断（F9）',
  'diag.crashed': '上次会话异常结束',
  'err.context': '显卡驱动丢掉了页面（GPU 重置或显存不足），刷新后继续。',
  'nav.arrived': '已到达标记点',
  'nav.north': '北',
  'nav.waypoint': '标记点',
  'nav.mission': '任务',
  'nav.km': '{n} 公里',
  'nav.m': '{n} 米',
  'nav.noRoute': '无道路可达',
  'ctl.map': '地图',
  'map.title': '地图',
  'map.city': '北京中心城区',
  'map.legend': '图例',
  'map.you': '你',
  'map.waypoint': '标记点',
  'map.mission': '任务目标',
  'map.pickup': '乘客上车点',
  'map.dropoff': '下车点',
  'map.police': '警察',
  'map.car': '车辆',
  'map.landmark': '地标',
  'map.route': 'GPS 路线',
  'map.search': '警方搜索区域',
  'map.set': '设置标记点',
  'map.clear': '清除标记点',
  'map.pan': '移动',
  'map.zoom': '缩放',
  'map.close': '关闭',
  'map.key.click': '左键',
  'map.key.rclick': '右键',
  'map.key.drag': '拖动',
  'map.key.wheel': '滚轮',
  'map.left': '剩余 {d}',
  'map.loading': '正在加载地图细节 {n}%',
};

/** Both tables, for the placeholder-parity test. */
export const STRINGS: Readonly<Record<Lang, Readonly<Record<TKey, string>>>> = { en: EN, zh: ZH };

const isLang = (v: unknown): v is Lang => v === 'en' || v === 'zh';

function detect(): Lang {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  const fromUrl = q?.get('lang');
  if (isLang(fromUrl)) return fromUrl;
  if (q?.has('shot')) return 'en';
  try { const saved = localStorage.getItem(STORE_KEY); if (isLang(saved)) return saved; } catch { /* node, private mode */ }
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  return /^zh/i.test(nav ?? '') ? 'zh' : 'en';
}

let current: Lang = detect();
const listeners = new Set<(l: Lang) => void>();

function stampDocument(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en';
}
stampDocument();

export function lang(): Lang { return current; }

export function setLang(l: Lang): void {
  if (l === current) return;
  current = l;
  try { localStorage.setItem(STORE_KEY, l); } catch { /* session only */ }
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
