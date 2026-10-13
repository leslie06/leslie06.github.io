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
const lines: { key: string; text: string; textEn: string }[] = JSON.parse(execFileSync('npx', ['tsx', path.join(root, 'scripts/voice/lines.mts')], { cwd: root, encoding: 'utf8' }));
const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;

/** A bark voice reused: archetype and which of its voices. */
const reuse = (arch: string, i: number) => ({ voice: barks.archetypes[arch].voices[i] as string, design: barks.archetypes[arch].voiceDesign[i] });
const design = (prompt: string, previewText: string) => ({ voice: null as string | null, design: { prompt, previewText } });

const GENERAL = ['my', 'mm', 'mo', 'fy', 'fm', 'fo'];
const CHARACTERS = ['laok', 'xiaoyu', 'daliu', 'wang', 'laozhang', 'liujie', 'feilong'];
const VOICES: Record<string, { name: string; style: string; styleEn?: string; v: ReturnType<typeof reuse> | ReturnType<typeof design> }> = {
  my: { name: '青年男', style: '二十多岁的北京小伙子，说话自然、口语化。', styleEn: "A Beijing guy in his twenties, talking naturally and casually.", v: reuse('tourist', 0) },
  mm: { name: '中年男', style: '四十来岁的北京爷们儿，京腔，说话直来直去。', styleEn: "A Beijing man in his forties, blunt and down to earth.", v: reuse('driver', 0) },
  mo: { name: '老年男', style: '七十岁左右的北京老大爷，京腔儿化音重，说话慢悠悠。', styleEn: "An old Beijing man around seventy, speaking slowly and leisurely.", v: reuse('uncle', 0) },
  fy: { name: '青年女', style: '二十多岁的年轻姑娘，普通话，说话自然、口语化。', styleEn: "A young woman in her twenties, talking naturally and casually.", v: reuse('tourist', 1) },
  fm: { name: '中年女', style: '四十来岁的北京大姐，京腔，说话爽快。', styleEn: "A Beijing woman in her forties, brisk and straightforward.", v: design('中年女性，40 岁左右，北京口音，中音，音色明亮温和，语速中等，说话爽快利落、有亲和力。', '来啦？今儿吃点儿什么？这雨下的，出门忘带伞了。') },
  fo: { name: '老年女', style: '六十多岁的北京大妈，嗓门大，说话热络。', styleEn: "A Beijing auntie in her sixties, loud and friendly.", v: reuse('auntie', 0) },
  xm: { name: '外国游客', style: '来北京旅游的外国小伙子，中文不太流利，带明显的外国口音，英文部分是美式英语。', styleEn: "A young American tourist in Beijing, speaking his native American English, friendly and curious.", v: design('青年男性，25 岁左右，母语是英语的外国人，说中文发音生硬、声调不准，带明显的美式英语口音，语气热情友好、充满好奇。', 'Excuse me，请问，您能带我去天安门吗？Thank you so much！') },
  laok: { name: '老K', style: '老K，六十岁上下的北京老江湖，做中间人生意，京腔，说话慢条斯理、不怒自威。', styleEn: "Old K, a Beijing fixer around sixty, unhurried, quietly menacing.", v: design('老年男性，60 岁左右，北京口音，音色低沉沙哑、有磁性，语速缓慢，说话沉稳，带江湖气。', '小子，来了？坐。这北京城啊，钱都在路上跑。') },
  xiaoyu: { name: '小雨', style: '小雨，二十出头的技术宅姑娘，说话快、机灵、带点儿调皮。', styleEn: "Xiaoyu, a techie girl in her early twenties, quick, clever and a little cheeky.", v: design('青年女性，22 岁左右，音色清亮偏甜，语速偏快，说话机灵俏皮，标准普通话。', '哟，你怎么来了？我这正刷机呢，等会儿。') },
  daliu: { name: '大刘', style: '大刘，四十多岁的修车师傅、老司机，京腔，憨厚爽快，爱吹当年。', styleEn: "Big Liu, a mechanic and veteran driver in his forties, hearty and plain-spoken, loves to brag about the old days.", v: design('中年男性，45 岁左右，北京口音，音色浑厚略粗，嗓门大，说话憨厚爽朗，语速中等。', '来啦！车怎么样？齐活儿！车给你弄好了。') },
  wang: { name: '王队', style: '王队，五十岁的老刑警队长，声音沉稳威严，说话简短，略带警告。', styleEn: "Captain Wang, a veteran police captain of fifty, calm, stern, few words, a hint of warning.", v: design('中年男性，50 岁左右，音色低沉有力，吐字清晰，语速偏慢，严肃威严，带命令口吻。', '又是你。别给我惹事儿。我盯着你呢，好好开车。') },
  laozhang: { name: '老张', style: '老张，七十岁的老出租车司机，京腔儿化音重，慢悠悠，和蔼爱唠叨。', styleEn: "Old Zhang, a cab driver of seventy, slow, kindly and chatty.", v: design('老年男性，70 岁左右，北京口音很重，儿化音多，音色温和略沙哑，语速缓慢，和蔼爱唠叨。', '小伙子，跑出租啦？开出租就两条：嘴要甜，车要稳。') },
  liujie: { name: '刘姐', style: '刘姐，四十多岁摆煎饼摊的大姐，京腔，热情麻利。', styleEn: "Sister Liu, a jianbing stall owner in her forties, warm and brisk.", v: design('中年女性，45 岁左右，北京口音，嗓门亮，音色明快，语速偏快，热情麻利。', '来啦？今儿吃点儿什么？加个蛋不？薄脆给你多放点儿。') },
  chenye: { name: '陈野', style: '陈野，二十八岁的前地下车手，主角，话少、嘴毒、沉着，北京口音不重。', styleEn: "Chen Ye, a former street racer of twenty-eight, the hero: few words, dry and sharp, unflappable.", v: design('青年男性，28 岁左右，音色低沉偏冷、略带沙哑，语速偏慢，话少、冷静，语气淡淡的带点儿嘲讽，普通话略带北京口音。', '街没变，人变了。你们找错人了，我只管开车。') },
  baoge: { name: '豹哥', style: '豹哥，四十多岁的东郊黑帮头目，黑豹帮老大，京腔，阴沉狠辣，说话慢、带笑也带威胁。', styleEn: "Panther, the East Side gang boss in his forties: slow, smiling and menacing.", v: design('中年男性，45 岁左右，北京口音，音色低沉粗哑、有压迫感，语速偏慢，说话阴沉带笑，透着狠劲儿。', '身手不错啊。回去告诉老K，东郊这片儿，姓豹。') },
  feilong: { name: '小飞龙', style: '小飞龙，十九岁的飙车小子，嚣张、语速快、爱挑衅。', styleEn: "Little Dragon, a nineteen-year-old street racer, cocky, fast-talking and provocative.", v: design('青年男性，19 岁左右，音色清亮偏高，语速很快，语气嚣张、爱挑衅，带点儿痞气。', '哟，开出租的也敢来找我？三环上我叫小飞龙。') },
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
  // the main story, chapter 1 《回京》
  'cmp.m1.k1': '慢悠悠地开口，像在试探，带一点儿感慨。', 'cmp.m1.c1': '淡淡地，带点儿自嘲。',
  'cmp.m1.k2': '不紧不慢，给人情也给压力。', 'cmp.m1.c2': '简短，冷静。',
  'cmp.m1.k3': '压低声音交代，最后一句加重语气。', 'cmp.m1.k4': '提醒，带着警告的意味，然后轻描淡写。',
  'cmp.m1.k5': '电话里，半开玩笑地叮嘱，心疼自己的车。', 'cmp.m1.c3': '随口一句，满不在乎。',
  'cmp.m1.y1': '上下打量，好奇又带点儿挑衅。', 'cmp.m1.c4': '淡淡地。', 'cmp.m1.y2': '撇撇嘴，然后干脆地说正事。',
  'cmp.m1.y3': '惊慌，大声喊。', 'cmp.m1.c5': '冷静，低沉，咬着牙。',
  'cmp.m1.y4': '惊叫，紧张。', 'cmp.m1.y5': '兴奋地叫好。', 'cmp.m1.y6': '急促地大喊提醒。', 'cmp.m1.y7': '喘着气，又后怕又佩服。',
  'cmp.m1.y8': '轻松，有点儿得意，夸人也不好意思明说。',
  'cmp.m1.k6': '慢条斯理，听得出压着火，最后一句意味深长。', 'cmp.m1.c6': '小声嘀咕，无奈又早有预料。',
  'npc.gang': '痞里痞气地挑衅，带着狠劲儿。',
  // chapter 2 《讨货》
  'cmp.m2.k1': '慢悠悠，带着满意。', 'cmp.m2.c1': '淡淡地，不绕弯子。',
  'cmp.m2.k2': '压着火，一字一句地交代。', 'cmp.m2.c2': '简短，冷静。',
  'cmp.m2.k3': '轻描淡写，胸有成竹。', 'cmp.m2.k4': '不容商量地叮嘱。',
  'cmp.m2.y1': '电话里，语速快，有点儿紧张。', 'cmp.m2.c3': '淡淡地。', 'cmp.m2.y2': '电话里，干脆利落地补充。',
  'cmp.m2.g1': '吊儿郎当，挑衅地笑。', 'cmp.m2.c4': '冷冷地，不紧不慢。', 'cmp.m2.g2': '先一愣，然后恶狠狠地招呼同伙。',
  'cmp.m2.g3': '扯着嗓子大喊，又惊又怒。',
  'cmp.m2.b1': '阴沉地笑着，慢悠悠地打量。', 'cmp.m2.c5': '平静，不容置疑。', 'cmp.m2.b2': '冷笑，最后一声厉喝。', 'cmp.m2.b3': '慢条斯理，透着威胁。',
  'cmp.m2.y3': '电话里，急促地大喊。', 'cmp.m2.c6': '低沉，笃定。',
  'cmp.m2.y4': '惊叫，紧张。', 'cmp.m2.c7': '无奈地自嘲，咬着牙。', 'cmp.m2.y5': '兴奋地叫好。', 'cmp.m2.y6': '松了口气，难以置信。',
  'cmp.m2.d1': '又惊又乐，嗓门大。', 'cmp.m2.d2': '边翻边嘀咕，最后一句压低声音，透着吃惊。', 'cmp.m2.c8': '一愣，追问。',
  'cmp.m2.d3': '认真起来，压低声音。', 'cmp.m2.k5': '电话里，慢条斯理，意味深长。', 'cmp.m2.c9': '冷静地提醒。', 'cmp.m2.k6': '电话里，不慌不忙，带着底气。',
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
/** The same deliveries for the English recordings (CosyVoice takes them better in the text's own language). */
const INSTRUCT_EN: Record<string, string> = {
  'con.laok.greet': 'Unhurried greeting, a streetwise edge.', 'con.laok.chat1': 'Musing, meaningfully.', 'con.laok.chat2': 'Earnest advice.',
  'con.xiaoyu.greet': 'A little surprised, busy with her hands, casual.', 'con.xiaoyu.chat1': 'Smugly, half whispering.', 'con.xiaoyu.chat2': 'Breezy promise.',
  'con.daliu.greet': 'Loud, warm greeting.', 'con.daliu.chat1': 'Bragging about the old days.', 'con.daliu.chat2': 'Serious advice.', 'con.daliu.repaired': 'Brisk and a bit proud.',
  'con.wang.greet': 'Cold, with a warning.', 'con.wang.chat1': 'A stern warning.', 'con.wang.chat2': 'Low voice, a reminder.',
  'con.laozhang.greet': 'Kindly greeting.', 'con.laozhang.chat1': 'Passing on experience, slowly.', 'con.laozhang.chat2': 'Chuckling, sharing his wisdom.',
  'con.liujie.greet': 'Warmly welcoming a customer.', 'con.liujie.chat1': 'Proud, a little mysterious.', 'con.liujie.free': 'Generously pressing it into your hands.',
  'con.feilong.greet': 'Sneering challenge.', 'con.feilong.chat1': 'Cocky bragging.', 'con.feilong.duelOn': 'Excited, accepting the challenge.', 'con.feilong.lost': 'Mocking laughter.',
  'con.feilong.noCar': 'Scornful.', 'con.feilong.pink': 'Grudgingly conceding, then wholehearted.', 'con.feilong.won': 'Sore loser, defiant.',
  'con.noTask': 'Casual.',
  'cmp.m1.k1': 'Slow and probing, a little wistful.', 'cmp.m1.c1': 'Flat, a touch of self-mockery.',
  'cmp.m1.k2': 'Unhurried, a favour with pressure behind it.', 'cmp.m1.c2': 'Short and calm.',
  'cmp.m1.k3': 'Low voice, giving instructions, the last sentence firm.', 'cmp.m1.k4': 'A warning, then offhand.',
  'cmp.m1.k5': 'On the phone, half joking, protective of his car.', 'cmp.m1.c3': 'Offhand, unbothered.',
  'cmp.m1.y1': 'Sizing him up, curious and a little provocative.', 'cmp.m1.c4': 'Flat.', 'cmp.m1.y2': 'A dry pout, then straight to business.',
  'cmp.m1.y3': 'Alarmed, shouting.', 'cmp.m1.c5': 'Calm, low, through gritted teeth.',
  'cmp.m1.y4': 'Shrieking, tense.', 'cmp.m1.y5': 'Cheering excitedly.', 'cmp.m1.y6': 'Urgent shouted warning.', 'cmp.m1.y7': 'Out of breath, shaken and impressed.',
  'cmp.m1.y8': 'Relaxed, a little smug, praising him without quite saying so.',
  'cmp.m1.k6': 'Measured, anger held in check, the last line pointed.', 'cmp.m1.c6': 'Muttered, resigned, saw it coming.',
  'npc.gang': 'Thuggish, taunting, menacing.',
  'cmp.m2.k1': 'Unhurried, pleased.', 'cmp.m2.c1': 'Flat, straight to the point.',
  'cmp.m2.k2': 'Anger held in, word by word.', 'cmp.m2.c2': 'Short and calm.',
  'cmp.m2.k3': 'Offhand, confident.', 'cmp.m2.k4': 'Firm, not up for discussion.',
  'cmp.m2.y1': 'On the phone, fast, a little tense.', 'cmp.m2.c3': 'Flat.', 'cmp.m2.y2': 'On the phone, brisk.',
  'cmp.m2.g1': 'Swaggering, a mocking grin.', 'cmp.m2.c4': 'Cold and unhurried.', 'cmp.m2.g2': 'Taken aback, then nastily rallying his mates.',
  'cmp.m2.g3': 'Bellowing, shocked and furious.',
  'cmp.m2.b1': 'A dark smile, slowly sizing him up.', 'cmp.m2.c5': 'Calm, final.', 'cmp.m2.b2': 'A sneer, then a sharp shout.', 'cmp.m2.b3': 'Slow and menacing.',
  'cmp.m2.y3': 'On the phone, urgent shouting.', 'cmp.m2.c6': 'Low and certain.',
  'cmp.m2.y4': 'Shrieking, tense.', 'cmp.m2.c7': 'Wry, through gritted teeth.', 'cmp.m2.y5': 'Cheering excitedly.', 'cmp.m2.y6': 'Relieved, disbelieving.',
  'cmp.m2.d1': 'Surprised and amused, loud.', 'cmp.m2.d2': 'Muttering as he looks, the last sentence hushed and startled.', 'cmp.m2.c8': 'Caught off guard, asking.',
  'cmp.m2.d3': 'Serious now, voice lowered.', 'cmp.m2.k5': 'On the phone, measured and pointed.', 'cmp.m2.c9': 'A calm warning.', 'cmp.m2.k6': 'On the phone, unhurried, sure of himself.',
  'event.blackShout': 'Leaning out of a car window, touting for fares.',
  'life.bbq.buy': 'Calling back cheerfully.', 'life.bbq.toast': 'Raising a glass, hearty.', 'life.busker.thanks': 'Happy thanks.', 'life.chess.none': "Without looking up, impatient.",
  'life.dance.bad': 'Kind reassurance.', 'life.dance.good': 'Happy praise.', 'life.dance.join': 'Warm invitation.', 'life.dance.scatter1': 'Startled, complaining loudly.', 'life.dance.scatter2': 'Still shaken, hand on her chest.',
  'life.jianbing.buy': 'Brisk and friendly.', 'life.police.stop': 'After a whistle, a loud order to stop.', 'life.taichi.join': 'Slow, calm guidance.',
  'life.tour.ask': 'Polite request.', 'life.tour.guide': 'Calling out through a little megaphone.', 'life.tour.thanks': 'Happy thanks.',
  'npc.bark.praise': 'Cheering excitedly.', 'npc.bark.wanted': 'Pointing and shouting.',
  'npc.chat.day1': 'Idle small talk.', 'npc.chat.day2': 'Helpful and proud.', 'npc.chat.day3': 'Grumbling.', 'npc.chat.day4': 'Letting you in on a secret.', 'npc.chat.day5': 'A friendly warning.', 'npc.chat.day6': 'Politely making way.',
  'npc.chat.morning': 'Warm greeting.', 'npc.chat.night': 'A little surprised.', 'npc.chat.rain': 'Resigned complaint.', 'npc.chat.wanted': 'Nervous, stammering.',
  'npc.courier.ask': 'Wincing in pain, urgent and pleading.', 'npc.courier.thanks': 'Relieved, then hurrying you.',
  'npc.daijia.wave': 'Drunk, waving and calling out.', 'npc.daijia.bump': 'Crying out, worried about his car.', 'npc.daijia.done': 'Drunk, mumbled thanks.', 'npc.daijia.ride1': 'Drunk mumbling.', 'npc.daijia.ride2': 'Drunk, starting to ramble.', 'npc.daijia.ride3': 'Hiccupping, groggy.',
  'npc.foreigner.ask': 'Polite, a little nervous.', 'npc.foreigner.done': 'Very grateful and warm.', 'npc.foreigner.wave': 'Waving and calling out.', 'npc.foreigner.wow': 'Amazed, very excited.',
  'npc.preg.ask': 'Frantic shouting.', 'npc.preg.wave': 'Flagging down a cab in a panic.', 'npc.preg.air': 'Shocked and angry.', 'npc.preg.bump1': 'Moaning in pain.', 'npc.preg.bump2': 'Nervously pleading.',
  'npc.preg.done': 'Overjoyed and grateful.', 'npc.preg.late': 'Panting in pain.', 'npc.preg.ride1': 'Breathing deeply in rhythm.', 'npc.preg.ride2': 'Anxious question.', 'npc.preg.ride3': 'Scared, voice shaking.', 'npc.preg.ride4': 'Forcing calm, reassuring.',
  'npc.rage.ask': 'Aggressive demand.', 'npc.rage.down': 'Holding his face, bitter.', 'npc.rage.film': 'Furious threat.', 'npc.rage.left': 'Roaring after the car.',
  'npc.rage.out1': 'Raging.', 'npc.rage.out2': 'Banging on the window, roaring.', 'npc.rage.out3': 'Heartbroken and furious.', 'npc.rage.paid': 'Still angry, lecturing.', 'npc.rage.punch': 'Vicious.',
  'npc.scam.cam1': 'Unhurried, a little smug.', 'npc.scam.cam2': 'Awkwardly backpedalling.', 'npc.scam.demand': 'Bullying, loud.', 'npc.scam.fall1': 'Wailing theatrically.', 'npc.scam.fall2': 'Howling theatrically.',
  'npc.scam.hit': 'Actually hit this time, shocked and hurting.', 'npc.scam.paid': 'Smug, all smiles.', 'npc.scam.paidShort': 'Muttering that it is not enough.', 'npc.scam.report': 'Throwing a tantrum.',
  'npc.tail.ask': 'Low voice, tense and urgent.', 'npc.tail.close': 'Tense, hushed warning.', 'npc.tail.done': 'Through gritted teeth, then relieved.', 'npc.tail.far': 'Anxious, hurrying.', 'npc.tail.spotted': 'Alarmed.', 'npc.tail.wave': 'Hailing a cab loudly.',
  'npc.thief.angry': 'Angry accusation.', 'npc.thief.ask': 'Calm.', 'npc.thief.cry': 'Panicked shouting.', 'npc.thief.down': 'Begging, flustered.', 'npc.thief.taunt': 'Taunting smugly while running.',
  'npc.thief.thanks1': 'Overwhelmed with gratitude.', 'npc.thief.thanks2': 'Sincerely pressing money on you.',
  'pax.normal.board': 'An ordinary passenger giving the address.', 'pax.normal.board2': 'In a hurry.', 'pax.normal.board3': 'Polite request.', 'pax.normal.air': 'Screaming in fright.', 'pax.normal.arrive': 'Polite thanks.',
  'pax.normal.crash': 'Startled, complaining.', 'pax.normal.drift': 'Impressed.', 'pax.normal.near': 'Exclaiming.', 'pax.normal.redlight': 'Nervous shout.',
  'pax.rush': 'Anxious, talking fast.', 'pax.rush.arrive': 'Hugely relieved, overjoyed.', 'pax.rush.near': 'Excited cheering.', 'pax.rush.drift': 'Excited cheering.', 'pax.rush.redlight': 'Thrilled cheering.', 'pax.rush.slow2': 'Fretting, muttering.',
  'pax.queasy': 'Carsick and miserable, weak.', 'pax.queasy.calm': 'Recovered, sincere thanks.', 'pax.queasy.air': 'About to throw up, retching.',
  'pax.chatty': 'A talkative old man, chatting leisurely.', 'pax.chatty.air': 'Startled, clutching his back.', 'pax.chatty.near': 'Amazed, then praising.', 'pax.chatty.drift': 'Laughing, scolding gently.', 'pax.chatty.redlight': 'Shaking his head, lecturing.', 'pax.chatty.arrive': 'Contented.', 'pax.chatty.crash': 'Waving it off, unbothered.',
  'pax.streamer': 'Livestreaming to her phone, excited and over the top.', 'pax.streamer.crash': 'Flustered, talking to the camera.', 'pax.streamer.redlight': 'Guilty, quietly.',
  'pax.drunk': 'Very drunk, slurring.', 'pax.drunk.vomit': 'Vomiting.', 'pax.drunk.air': 'Hiccup.', 'pax.drunk.crash': 'Drunk giggling.', 'pax.drunk.near': 'Drunk, egging you on.',
  'pax.mystery': 'Cold and low, few words.',
  'shout.call': 'Shouting into a phone.', 'shout.hit': 'Hit, crying out in pain.', 'shout.scare': 'Startled, swearing loudly.', 'shout.shove': 'Shoved, complaining.',
};
const instructOf = (key: string, table = INSTRUCT) => {
  if (table[key]) return table[key];
  let best = '';
  for (const k of Object.keys(table)) if (key.startsWith(k) && k.length > best.length) best = k;
  if (!best) throw new Error(`no delivery for ${key}`);
  return table[best];
};

/** Who says a line: one contact (and the foreigner) in their own voice; everything else in the six. */
const voicesOf = (key: string) => {
  const m = /^con\.([a-z]+)\./.exec(key);
  if (m && CHARACTERS.includes(m[1])) return [m[1]];
  if (key === 'con.noTask') return CHARACTERS;
  if (key.startsWith('npc.foreigner.')) return ['xm'];
  // Panther's thugs (the street brawl's taunts) in one voice, the one chapter 2's thugs speak in
  if (key.startsWith('npc.gang.')) return ['mm'];
  const story = /^cmp\.m\d+\.([kycdbg])\d+$/.exec(key);
  if (story) return [{ k: 'laok', y: 'xiaoyu', c: 'chenye', d: 'daliu', b: 'baoge', g: 'mm' }[story[1]]!];
  return GENERAL;
};

const archetypes: Record<string, unknown> = {};
for (const [id, v] of Object.entries(VOICES)) {
  const kept = old?.archetypes?.[id]?.voices as string[] | undefined;
  archetypes[id] = {
    name: v.name,
    voiceHint: id in { laok: 1, xiaoyu: 1, daliu: 1, wang: 1, laozhang: 1, liujie: 1, feilong: 1, chenye: 1, baoge: 1 } ? '熟人专属音色' : v.v.voice ? `复用路人原型的音色` : '新设计',
    voices: kept?.length ? kept : v.v.voice ? [v.v.voice] : [],
    voiceDesign: [v.v.design],
    style: v.style,
    styleEn: v.styleEn,
    rateRange: [1, 1],
  };
}
const out = {
  version: 1,
  _note: '对话框和路人台词（由 scripts/voice/dialogue.mts 生成，别手改：改台词改 core/i18n，改语气改脚本里的 INSTRUCT）。每句 × 说它的音色各录 1 个版本。',
  tts: { ...barks.tts, variantsDefault: 1 },
  archetypes,
  lines: lines.flatMap((l) => voicesOf(l.key).map((v) => ({ id: l.key, archetype: v, trigger: 'dialogue', emotion: 'neutral', text: l.text, instruct: instructOf(l.key), textEn: l.textEn, instructEn: instructOf(l.key, INSTRUCT_EN) }))),
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`${lines.length} lines, ${out.lines.length} recordings, ${Object.keys(VOICES).length} voices -> ${path.relative(root, OUT)}`);
