/**
 * 城市声音的台词（2026-11-09，docs/beijing-immersion-design.md B1/B2）：「B城交通台」的主持人（报时、路况、天气、
 * 插播玩家闹出来的事、段子、广告），公交报站和「倒车请注意」，胡同里的吆喝。录音脚本 `scripts/voice/city.mts`
 * 从这里生成 assets/voice/city.json（tools/voice-gen 录），`scripts/voice/city-pack.mjs` 打包到
 * public/voice/city/<id>.mp3；游戏（audio/Talk.ts、audio/Soundscape.ts）按 id 取。改了台词：重跑这两个脚本，
 * 录过的旧文件要先删（synth 按文件名跳过已有的）。真实电台名不用（调频 99.6 是编的）。
 */
export type CityVoice = 'dj' | 'bus' | 'hawker';

/** 路况里说的路：电台的说法、匹配地图上路名（RoadChain）的规则、录音 id。 */
export interface RadioRoad { id: string; say: string; match: RegExp; ring: boolean }
const ring = (id: string, say: string): RadioRoad => ({ id, say, match: new RegExp(`^${say}`), ring: true });
const road = (id: string, say: string, match: RegExp): RadioRoad => ({ id, say, match, ring: false });
export const RADIO_ROADS: readonly RadioRoad[] = [
  ring('e2', '东二环'), ring('w2', '西二环'), ring('s2', '南二环'), ring('n2', '北二环'),
  ring('e3', '东三环'), ring('w3', '西三环'), ring('s3', '南三环'), ring('n3', '北三环'),
  ring('e4', '东四环'), ring('w4', '西四环'), ring('s4', '南四环'), ring('n4', '北四环'),
  ring('e5', '东五环'), ring('w5', '西五环'), ring('s5', '南五环'), ring('n5', '北五环'),
  road('changan', '长安街', /长安街$|^建国门(内|外)大街$|^复兴门内大街$/), road('jianguo', '建国路', /^建国路$/),
  road('chaoyang', '朝阳路', /^朝阳路$/), road('chaoyangbei', '朝阳北路', /^朝阳北路$/), road('guangqu', '广渠路', /^广渠(快速)?路$/),
  road('jingtong', '京通快速路', /^京通快速路$/), road('airport', '机场高速', /机场高速/), road('jingzang', '京藏高速', /^京藏高速/),
  road('jingcheng', '京承高速', /^京承高速/), road('jingkai', '京开高速', /^京开高速$/), road('jinggangao', '京港澳高速', /港澳高速/),
  road('jinghu', '京沪高速', /^京沪高速/), road('jingha', '京哈高速', /^京哈高速/), road('fuxing', '复兴路', /^复兴路$/),
  road('fushi', '阜石路', /^阜石路$/), road('lianshi', '莲石路', /^莲石(东|西)?路$/), road('fucheng', '阜成路', /^阜成路$/),
  road('xizhimenwai', '西直门外大街', /^西直门外大街$/), road('xueyuan', '学院路', /^学院路$/), road('zhongguancun', '中关村大街', /^中关村(北|南)?大街$/),
  road('zhichun', '知春路', /^知春路$/), road('anli', '安立路', /^安立路$/), road('beichen', '北辰路', /^北辰(东|西)路$/),
  road('yaojiayuan', '姚家园路', /^姚家园路$/), road('xidawang', '西大望路', /^西大望路$/), road('lianhuachi', '莲花池东路', /^莲花池东路$/),
  road('jingliang', '京良路', /^京良路$/), road('nanyuan', '南苑路', /^南苑路$/),
];

/** 路况的三种说法（录音 id 的后缀）。 */
export const ROAD_STATUS = ['slow', 'jam', 'ok'] as const;
export type RoadStatus = (typeof ROAD_STATUS)[number];
const STATUS_SAY: Record<RoadStatus, (r: string) => string> = {
  slow: (r) => `${r}车多缓行。`,
  jam: (r) => `${r}拥堵比较严重，能绕就绕。`,
  ok: (r) => `${r}通行顺畅。`,
};

const HOURS = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十', '二十一', '二十二', '二十三'];

export interface CityLine { id: string; voice: CityVoice; text: string; instruct: string }

/** Every line, in recording order. */
export function cityLines(): CityLine[] {
  const L: CityLine[] = [];
  const dj = (id: string, text: string, instruct = '电台主持人播报，自然流畅，带点儿京味儿。') => L.push({ id: `radio.${id}`, voice: 'dj', text, instruct });
  dj('id1', '您正在收听的是B城交通台，调频九十九点六。', '台呼，热情饱满。');
  dj('id2', 'B城交通台，陪您一路畅通。', '台呼，轻快。');
  for (let h = 0; h < 24; h++) dj(`time.${h}`, `B城时间，${HOURS[h]}点整。`, '整点报时，字正腔圆，干脆。');
  dj('tr.intro1', '来看看路面上的情况。');
  dj('tr.intro2', '下面是实时路况。');
  dj('tr.intro3', '最新路况，大家听好了。');
  for (const r of RADIO_ROADS) for (const s of ROAD_STATUS) dj(`tr.${r.id}.${s}`, STATUS_SAY[s](r.say), s === 'ok' ? '播报路况，语气轻松。' : '播报路况，语速稍快，略带提醒。');
  dj('tr.out1', '开车的朋友注意保持车距。');
  dj('tr.out2', '着急的朋友可以走辅路。');
  dj('tr.out3', '以上是实时路况。');
  dj('tr.rain', '雨天路滑，大家慢点儿开，记得打开车灯。', '关切地提醒。');
  dj('wx.clear', '今儿天儿不错，能见度挺好，开车的朋友注意防晒。', '轻松愉快。');
  dj('wx.rain', '外头下着雨呢，路面湿滑，跟车别太近。', '关切地提醒。');
  dj('wx.autumn', '这两天银杏正黄，赏叶的车多，开车可别光顾着看景儿。', '轻松，带点儿调侃。');
  dj('wx.heat', '供暖季开始了，家里暖和了，出门可别忘了添衣服。', '温和地提醒。');
  dj('wx.winter', '天儿冷了，早晚桥面容易结冰，过桥的时候慢点儿。', '认真地提醒。');
  dj('wx.spring', '杨絮又飘起来了，开车把车窗关好，别让它糊一脸。', '轻松调侃。');
  dj('wx.summer', '天儿热，车里可别放打火机和充电宝。', '认真地提醒。');
  dj('wx.night', '夜深了，开夜车的朋友注意休息，可别疲劳驾驶。', '低沉温柔，深夜电台的感觉。');
  dj('news.chase', '插播一条消息：警方正在追捕一辆可疑车辆，附近的司机朋友注意避让。', '新闻插播，严肃紧张。');
  dj('news.crazy', '刚接到听众报料，有辆车在马路上横冲直撞，大伙儿离它远点儿。', '新闻插播，有点儿着急。');
  dj('news.drift', '又有听众打电话说，看见有人在路口漂移。哥们儿，这是马路，不是赛道！', '哭笑不得地调侃。');
  dj('news.escaped', '最新消息，那辆可疑车辆甩掉了警车，下落不明。警方提醒：开车别跟警察较劲。', '新闻插播，略带无奈。');
  dj('news.busted', '刚才那辆横冲直撞的车，已经被警方拦下来了，大家可以放心了。', '新闻插播，松了口气。');
  dj('chat1', '开车不喝酒，喝酒不开车。这话我天天说，您天天听，咱都记住了啊。', '语重心长，带京腔。');
  dj('chat2', '北京的路啊，您记住一条：二环看运气，三环看心情，四环看缘分。', '说段子，带笑。');
  dj('chat3', '有听众问，为什么一到周五就堵？您想啊，全城的人都着急回家呢。', '说段子，轻松。');
  dj('chat4', '停车别占消防通道，这可不是闹着玩儿的。', '认真地提醒。');
  dj('chat5', '遇上加塞儿的别着急，深呼吸，咱不跟别人置气。', '温和地劝。');
  dj('ad1', '蛮牛跑车，现在只要五万块！开出去，倍儿有面儿。详情就近找车行。', '夸张的广告腔，语速快。');
  dj('ad2', '开车累了？南锣鼓巷的饺子馆儿，皮薄馅儿大，进去坐坐。', '热情的广告腔。');
  dj('ad3', '车坏了别发愁，光华路大刘修车，手艺地道，价钱公道。', '热情的广告腔。');
  dj('bye', 'B城交通台，陪您一路平安。', '台呼，温暖。');
  const st = (id: string, voice: CityVoice, text: string, instruct: string) => L.push({ id: `street.${id}`, voice, text, instruct });
  st('bus.arrive', 'bus', '车辆进站，请注意安全。', '公交车报站录音，平稳清晰。');
  st('bus.leave', 'bus', '车辆起步，请站稳扶好。', '公交车报站录音，平稳清晰。');
  st('reverse', 'bus', '倒车，请注意。倒车，请注意。', '机械的提示音录音，平稳，一字一顿。');
  st('recycle', 'hawker', '收——旧冰箱、旧彩电、旧洗衣机——旧电脑、旧手机——高价回收——', '用喇叭吆喝，拖长音，懒洋洋的。');
  st('knife', 'hawker', '磨剪子嘞——戗菜刀——', '老北京吆喝，拖长音，有韵味。');
  st('tanghulu', 'hawker', '冰糖葫芦——哎——冰糖葫芦——', '老北京吆喝，拖长音，响亮。');
  return L;
}
