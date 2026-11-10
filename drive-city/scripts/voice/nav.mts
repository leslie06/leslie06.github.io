/**
 * 语音导航的台词表（2026-11-10，src/audio/NavLines.ts）：写 assets/voice/nav.json（lines.json 的格式），tools/voice-gen 录：
 * `tools/voice-gen/run.sh design --lines assets/voice/nav.json`（两个新音色：导航女声、京腔的哥），
 * `... synth --lines assets/voice/nav.json`（录到 assets/voice/nav-raw/），再 `node scripts/voice/nav-pack.mjs` 打包到
 * public/voice/nav/。已经设计好的音色 id 重写时保留。
 *   npx tsx scripts/voice/nav.mts
 */
import fs from 'node:fs';
import path from 'node:path';
import { navLines } from '../../src/audio/NavLines';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OUT = path.join(root, 'assets/voice/nav.json');
const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
const kept = (a: string) => (old?.archetypes?.[a]?.voices ?? []) as string[];

const archetypes = {
  navf: {
    name: '导航（普通话）', voices: kept('navf'),
    voiceDesign: [{ prompt: '年轻女性，26 岁左右，手机导航软件的语音播报，标准普通话，音色清亮甜美，吐字清晰，语速适中，温和亲切。', previewText: '前方五百米右转，进入东三环。您已偏离路线，已为您重新规划。' }],
    style: '手机导航的女声语音提示，标准普通话，清晰温和。', styleEn: 'A satnav voice prompt.', rateRange: [1, 1],
  },
  navj: {
    name: '导航（京腔的哥）', voices: kept('navj'),
    voiceDesign: [{ prompt: '中年男性，50 岁左右，开了二十多年出租车的老北京的哥，一口地道京腔，儿化音重，嗓音醇厚略带沙哑，语速稍快，热心幽默，爱贫嘴。', previewText: '前边儿二百米往右拐，上东三环。您走岔了，没事儿，我给您重新规划。到地儿了您呐！' }],
    style: '老北京出租车司机给乘客指路，地道京腔，热心随和。', styleEn: 'An old Beijing cabbie giving directions.', rateRange: [1, 1],
  },
};
const doc = {
  version: 1,
  _note: '语音导航的台词：由 scripts/voice/nav.mts 从 src/audio/NavLines.ts 生成，别手改。',
  tts: { provider: 'aliyun-bailian', model: 'cosyvoice-v3.5-plus', format: 'mp3', sampleRate: 24000, variantsDefault: 1, languageHints: ['zh'], voiceListUrl: 'https://help.aliyun.com/zh/model-studio/cosyvoice-voice-list', emotions: ['neutral', 'fearful', 'angry', 'sad', 'surprised', 'happy', 'disgusted'] },
  archetypes,
  lines: navLines().map((l) => ({ id: l.id, archetype: l.voice, trigger: 'nav', emotion: 'neutral', text: l.text, instruct: l.instruct, textEn: '', instructEn: '' })),
};
fs.writeFileSync(OUT, JSON.stringify(doc, null, 1));
console.log(`${OUT}: ${doc.lines.length} lines`);
