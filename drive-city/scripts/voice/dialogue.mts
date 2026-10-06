/**
 * The dialogue box's and the passers-by's spoken lines for CosyVoice (2026-10-06, 「把对话框里的台词也换成
 * CosyVoice」): writes assets/voice/dialogue.json in lines.json's shape, so tools/voice-gen records it
 * (`run.sh design|synth --lines assets/voice/dialogue.json`) and scripts/voice/dialogue-pack.mjs packs it.
 *  - The lines are scripts/voice/lines.mts's (every NPC line and shout, less HUD text; parameters said
 *    generically).
 *  - Voices: six by sex and age (my mm mo / fy fm fo, picked at runtime from the speaker's VoiceSpec), five of
 *    them the barks' own designed voices; a foreigner (xm) for the lost tourist; one per contact for their
 *    own lines (con.<id>.*, and con.noTask in all of them). A voice already designed (its id in this file's
 *    `voices`) is kept when the file is written again.
 *  - Each line's delivery: `INSTRUCT` (by key, else by its prefix), after its voice's `style`.
 *   npx tsx scripts/voice/dialogue.mts
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OUT = path.join(root, 'assets/voice/dialogue.json');
const barks = JSON.parse(fs.readFileSync(path.join(root, 'assets/voice/lines.json'), 'utf8'));
const lines: { key: string; text: string }[] = JSON.parse(execFileSync('npx', ['tsx', path.join(root, 'scripts/voice/lines.mts')], { cwd: root, encoding: 'utf8' }));
const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;

/** A bark voice reused: archetype and which of its voices. */
const reuse = (arch: string, i: number) => ({ voice: barks.archetypes[arch].voices[i] as string, design: barks.archetypes[arch].voiceDesign[i] });
const design = (prompt: string, previewText: string) => ({ voice: null as string | null, design: { prompt, previewText } });

const GENERAL = ['my', 'mm', 'mo', 'fy', 'fm', 'fo'];
const CHARACTERS = ['laok', 'xiaoyu', 'daliu', 'wang', 'laozhang', 'liujie', 'feilong'];
const VOICES: Record<string, { name: string; style: string; v: ReturnType<typeof reuse> | ReturnType<typeof design> }> = {
  my: { name: '青年男', style: '二十多岁的北京小伙子，说话自然、口语化。', v: reuse('tourist', 0) },
  mm: { name: '中年男', style: '四十来岁的北京爷们儿，京腔，说话直来直去。', v: reuse('driver', 0) },
  mo: { name: '老年男', style: '七十岁左右的北京老大爷，京腔儿化音重，说话慢悠悠。', v: reuse('uncle', 0) },
  fy: { name: '青年女', style: '二十多岁的年轻姑娘，普通话，说话自然、口语化。', v: reuse('tourist', 1) },
  fm: { name: '中年女', style: '四十来岁的北京大姐，京腔，说话爽快。', v: design('中年女性，40 岁左右，北京口音，中音，音色明亮温和，语速中等，说话爽快利落、有亲和力。', '来啦？今儿吃点儿什么？这雨下的，出门忘带伞了。') },
  fo: { name: '老年女', style: '六十多岁的北京大妈，嗓门大，说话热络。', v: reuse('auntie', 0) },
  xm: { name: '外国游客', style: '来北京旅游的外国小伙子，中文不太流利，带明显的外国口音，英文部分是美式英语。', v: design('青年男性，25 岁左右，母语是英语的外国人，说中文发音生硬、声调不准，带明显的美式英语口音，语气热情友好、充满好奇。', 'Excuse me，请问，您能带我去天安门吗？Thank you so much！') },
  laok: { name: '老K', style: '老K，六十岁上下的北京老江湖，做中间人生意，京腔，说话慢条斯理、不怒自威。', v: design('老年男性，60 岁左右，北京口音，音色低沉沙哑、有磁性，语速缓慢，说话沉稳，带江湖气。', '小子，来了？坐。这北京城啊，钱都在路上跑。') },
  xiaoyu: { name: '小雨', style: '小雨，二十出头的技术宅姑娘，说话快、机灵、带点儿调皮。', v: design('青年女性，22 岁左右，音色清亮偏甜，语速偏快，说话机灵俏皮，标准普通话。', '哟，你怎么来了？我这正刷机呢，等会儿。') },
  daliu: { name: '大刘', style: '大刘，四十多岁的修车师傅、老司机，京腔，憨厚爽快，爱吹当年。', v: design('中年男性，45 岁左右，北京口音，音色浑厚略粗，嗓门大，说话憨厚爽朗，语速中等。', '来啦！车怎么样？齐活儿！车给你弄好了。') },
  wang: { name: '王队', style: '王队，五十岁的老刑警队长，声音沉稳威严，说话简短，略带警告。', v: design('中年男性，50 岁左右，音色低沉有力，吐字清晰，语速偏慢，严肃威严，带命令口吻。', '又是你。别给我惹事儿。我盯着你呢，好好开车。') },
  laozhang: { name: '老张', style: '老张，七十岁的老出租车司机，京腔儿化音重，慢悠悠，和蔼爱唠叨。', v: design('老年男性，70 岁左右，北京口音很重，儿化音多，音色温和略沙哑，语速缓慢，和蔼爱唠叨。', '小伙子，跑出租啦？开出租就两条：嘴要甜，车要稳。') },
  liujie: { name: '刘姐', style: '刘姐，四十多岁摆煎饼摊的大姐，京腔，热情麻利。', v: design('中年女性，45 岁左右，北京口音，嗓门亮，音色明快，语速偏快，热情麻利。', '来啦？今儿吃点儿什么？加个蛋不？薄脆给你多放点儿。') },
  feilong: { name: '小飞龙', style: '小飞龙，十九岁的飙车小子，嚣张、语速快、爱挑衅。', v: design('青年男性，19 岁左右，音色清亮偏高，语速很快，语气嚣张、爱挑衅，带点儿痞气。', '哟，开出租的也敢来找我？三环上我叫小飞龙。') },
};

/** How each line is said: by key, else by the longest matching prefix. */
const INSTRUCT: Record<string, string> = {
  // contacts
  'con.laok.greet': '慢悠悠地招呼，带点儿江湖气。', 'con.laok.chat1': '意味深长地感慨。', 'con.laok.chat2': '语重心长地教导。',
  'con.xiaoyu.greet': '有点儿惊讶，手上忙着，语气随意。', 'con.xiaoyu.chat1': '得意地小声透露。', 'con.xiaoyu.chat2': '轻快地许诺。',
  'con.daliu.greet': '热情地大声招呼。', 'con.daliu.chat1': '得意地吹当年。', 'con.daliu.chat2': '认真地叮嘱。', 'con.daliu.repaired': '干脆利落，透着得意。',
  'con.wang.greet': '冷淡，带着警告。', 'con.wang.chat1': '严肃地警告。', 'con.wang.chat2': '压低声音，提醒。',
  'con.laozhang.greet': '和蔼地打招呼。', 'con.laozhang.chat1': '传授经验，慢悠悠。', 'con.laozhang.chat2': '笑呵呵地传授心得。',
  'con.liujie.greet': '热情地招呼客人。', 'con.liujie.chat1': '得意地说，带点儿神秘。', 'con.liujie.free': '大方爽快地把东西塞过去。',
  'con.feilong.greet': '轻蔑地挑衅。', 'con.feilong.chat1': '嚣张地炫耀。', 'con.feilong.duelOn': '兴奋地应战。', 'con.feilong.lost': '嘲讽地大笑。',
  'con.feilong.noCar': '不屑地嘲笑。', 'con.feilong.pink': '不甘心地认输，最后爽快起来。', 'con.feilong.won': '不服气，嘴硬。',
  'con.noTask': '随意地说。',
  // street events and life
  'event.blackShout': '探出车窗吆喝揽客。',
  'life.bbq.buy': '吆喝着应声。', 'life.bbq.toast': '举杯，豪爽地。', 'life.busker.thanks': '开心地道谢。', 'life.chess.none': '头也不抬，不耐烦。',
  'life.dance.bad': '和气地安慰。', 'life.dance.good': '开心地夸奖。', 'life.dance.join': '热情地招呼。', 'life.dance.scatter1': '受惊后大声埋怨。', 'life.dance.scatter2': '惊魂未定，拍着胸口。',
  'life.jianbing.buy': '麻利热情地问。', 'life.police.stop': '吹完哨子大声喝止。', 'life.taichi.join': '慢悠悠、平和地指点。',
  'life.tour.ask': '礼貌地请求。', 'life.tour.guide': '拿着小喇叭大声招呼。', 'life.tour.thanks': '开心地道谢。',
  'npc.bark.praise': '兴奋地叫好。', 'npc.bark.wanted': '指着大声喊。',
  'npc.chat.day1': '悠闲地搭话。', 'npc.chat.day2': '热心又自豪。', 'npc.chat.day3': '絮叨地抱怨。', 'npc.chat.day4': '神秘地透露。', 'npc.chat.day5': '好心提醒。', 'npc.chat.day6': '客气地让路。',
  'npc.chat.morning': '热情地打招呼。', 'npc.chat.night': '有点儿意外地问。', 'npc.chat.rain': '无奈地抱怨。', 'npc.chat.wanted': '紧张，结结巴巴。',
  // encounters
  'npc.courier.ask': '疼得龇牙，又急又恳切。', 'npc.courier.thanks': '如释重负，急切地催。',
  'npc.daijia.wave': '醉醺醺地招手喊。', 'npc.daijia.bump': '心疼地叫。', 'npc.daijia.done': '醉醺醺，含糊地道谢。', 'npc.daijia.ride1': '醉醺醺地嘟囔。', 'npc.daijia.ride2': '醉醺醺，开始絮叨。', 'npc.daijia.ride3': '打着嗝，迷迷糊糊。',
  'npc.foreigner.ask': '礼貌又有点儿紧张。', 'npc.foreigner.done': '非常感激，热情。', 'npc.foreigner.wave': '大声招手。', 'npc.foreigner.wow': '惊叹，非常兴奋。',
  'npc.preg.ask': '焦急万分地喊。', 'npc.preg.wave': '慌张地拦车。', 'npc.preg.air': '又惊又气。', 'npc.preg.bump1': '疼得直哼哼。', 'npc.preg.bump2': '紧张地央求。',
  'npc.preg.done': '激动、感激。', 'npc.preg.late': '痛苦地喘着气。', 'npc.preg.ride1': '跟着节奏深呼吸。', 'npc.preg.ride2': '焦急地问。', 'npc.preg.ride3': '害怕，声音发抖。', 'npc.preg.ride4': '强装镇定地安慰。',
  'npc.rage.ask': '咄咄逼人地质问。', 'npc.rage.down': '捂着脸，不甘心。', 'npc.rage.film': '气急败坏地威胁。', 'npc.rage.left': '冲着车尾大吼。',
  'npc.rage.out1': '暴怒地吼。', 'npc.rage.out2': '拍着车窗大吼。', 'npc.rage.out3': '心疼又愤怒。', 'npc.rage.paid': '余怒未消，数落。', 'npc.rage.punch': '恶狠狠地。',
  'npc.scam.cam1': '不慌不忙，带点儿得意。', 'npc.scam.cam2': '尴尬地改口，讪讪地。', 'npc.scam.demand': '蛮横地嚷嚷。', 'npc.scam.fall1': '夸张地哀嚎。', 'npc.scam.fall2': '夸张地嚎叫。',
  'npc.scam.hit': '真被撞了，又惊又疼。', 'npc.scam.paid': '得意地堆笑。', 'npc.scam.paidShort': '嫌少，嘟囔。', 'npc.scam.report': '撒泼地嚷嚷。',
  'npc.tail.ask': '压低声音，紧张又急切。', 'npc.tail.close': '紧张地压低声音提醒。', 'npc.tail.done': '咬牙切齿，然后松一口气。', 'npc.tail.far': '着急地催。', 'npc.tail.spotted': '惊慌。', 'npc.tail.wave': '大声拦车。',
  'npc.thief.angry': '气愤地指责。', 'npc.thief.ask': '平静地说。', 'npc.thief.cry': '惊慌地大喊。', 'npc.thief.down': '求饶，慌忙。', 'npc.thief.taunt': '边跑边得意地挑衅。',
  'npc.thief.thanks1': '感激涕零。', 'npc.thief.thanks2': '诚恳地塞钱。',
  // passengers
  'pax.normal.board': '普通乘客上车报地方。', 'pax.normal.board2': '着急地催。', 'pax.normal.board3': '客气地叮嘱。', 'pax.normal.air': '吓得尖叫。', 'pax.normal.arrive': '客气地道谢。',
  'pax.normal.crash': '吓了一跳，埋怨。', 'pax.normal.drift': '惊叹。', 'pax.normal.near': '惊呼。', 'pax.normal.redlight': '紧张地喊。',
  'pax.rush': '焦急，语速快。', 'pax.rush.arrive': '如释重负，狂喜。', 'pax.rush.near': '兴奋地叫好。', 'pax.rush.drift': '兴奋地叫好。', 'pax.rush.redlight': '激动地叫好。', 'pax.rush.slow2': '急得直跺脚，嘟囔。',
  'pax.queasy': '晕车难受，有气无力。', 'pax.queasy.calm': '缓过来了，真心道谢。', 'pax.queasy.air': '要吐了，干呕。',
  'pax.chatty': '话痨，慢悠悠地唠嗑。', 'pax.chatty.air': '吓一跳，捂着腰。', 'pax.chatty.near': '惊叹，然后夸奖。', 'pax.chatty.drift': '笑着嗔怪。', 'pax.chatty.redlight': '摇头数落。', 'pax.chatty.arrive': '心满意足。', 'pax.chatty.crash': '摆摆手，满不在乎。',
  'pax.streamer': '对着手机直播，兴奋夸张。', 'pax.streamer.crash': '慌张地对着镜头。', 'pax.streamer.redlight': '心虚，小声。',
  'pax.drunk': '醉醺醺，口齿不清，大舌头。', 'pax.drunk.vomit': '呕吐。', 'pax.drunk.air': '打嗝。', 'pax.drunk.crash': '醉醺醺地傻笑。', 'pax.drunk.near': '醉醺醺地起哄。',
  'pax.mystery': '冷淡低沉，惜字如金。',
  // shouts
  'shout.call': '对着电话大声喊。', 'shout.hit': '被撞，疼得大叫。', 'shout.scare': '受惊后大声骂。', 'shout.shove': '被推了一把，不满地喊。',
};
const instructOf = (key: string) => {
  if (INSTRUCT[key]) return INSTRUCT[key];
  let best = '';
  for (const k of Object.keys(INSTRUCT)) if (key.startsWith(k) && k.length > best.length) best = k;
  if (!best) throw new Error(`no delivery for ${key}`);
  return INSTRUCT[best];
};

/** Who says a line: one contact (and the foreigner) in their own voice; everything else in the six. */
const voicesOf = (key: string) => {
  const m = /^con\.([a-z]+)\./.exec(key);
  if (m && CHARACTERS.includes(m[1])) return [m[1]];
  if (key === 'con.noTask') return CHARACTERS;
  if (key.startsWith('npc.foreigner.')) return ['xm'];
  return GENERAL;
};

const archetypes: Record<string, unknown> = {};
for (const [id, v] of Object.entries(VOICES)) {
  const kept = old?.archetypes?.[id]?.voices as string[] | undefined;
  archetypes[id] = {
    name: v.name,
    voiceHint: id in { laok: 1, xiaoyu: 1, daliu: 1, wang: 1, laozhang: 1, liujie: 1, feilong: 1 } ? '熟人专属音色' : v.v.voice ? `复用路人原型的音色` : '新设计',
    voices: kept?.length ? kept : v.v.voice ? [v.v.voice] : [],
    voiceDesign: [v.v.design],
    style: v.style,
    rateRange: [1, 1],
  };
}
const out = {
  version: 1,
  _note: '对话框和路人台词（由 scripts/voice/dialogue.mts 生成，别手改：改台词改 core/i18n，改语气改脚本里的 INSTRUCT）。每句 × 说它的音色各录 1 个版本。',
  tts: { ...barks.tts, variantsDefault: 1 },
  archetypes,
  lines: lines.flatMap((l) => voicesOf(l.key).map((v) => ({ id: l.key, archetype: v, trigger: 'dialogue', emotion: 'neutral', text: l.text, instruct: instructOf(l.key) }))),
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`${lines.length} lines, ${out.lines.length} recordings, ${Object.keys(VOICES).length} voices -> ${path.relative(root, OUT)}`);
