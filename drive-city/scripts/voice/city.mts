/**
 * 城市声音的台词表（2026-11-09，src/audio/CityLines.ts）：写 assets/voice/city.json（lines.json 的格式），
 * tools/voice-gen 录：`tools/voice-gen/run.sh design --lines assets/voice/city.json`（新音色：交通台主持人、
 * 公交报站），`... synth --lines assets/voice/city.json`（录到 assets/voice/city-raw/），再
 * `node scripts/voice/city-pack.mjs` 打包到 public/voice/city/。已经设计好的音色 id 重写时保留。
 *   npx tsx scripts/voice/city.mts
 */
import fs from 'node:fs';
import path from 'node:path';
import { cityLines } from '../../src/audio/CityLines';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const OUT = path.join(root, 'assets/voice/city.json');
const barks = JSON.parse(fs.readFileSync(path.join(root, 'assets/voice/lines.json'), 'utf8'));
const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
const kept = (a: string) => (old?.archetypes?.[a]?.voices ?? []) as string[];

const archetypes = {
  dj: {
    name: '交通台主持人', voices: kept('dj'),
    voiceDesign: [{ prompt: '青年男性，32 岁左右，北京交通广播电台主持人，普通话标准、带一点儿京腔儿化音，音色明亮浑厚，语速偏快，热情幽默，播音腔但不死板。', previewText: '您正在收听的是B城交通台。东三环车多缓行，着急的朋友可以走辅路。' }],
    style: '北京交通广播的男主持人，京腔，热情幽默，播音自然。', styleEn: 'A Beijing traffic radio host.', rateRange: [1, 1],
  },
  bus: {
    name: '公交报站', voices: kept('bus'),
    voiceDesign: [{ prompt: '女性，30 岁左右，标准普通话播音腔，音色清亮柔和，语速平稳，吐字清晰，像公交车上的报站录音。', previewText: '车辆进站，请注意安全。车辆起步，请站稳扶好。' }],
    style: '公交车上的报站录音，女声，标准普通话，平稳清晰。', styleEn: 'A recorded bus announcement.', rateRange: [1, 1],
  },
  hawker: {
    name: '吆喝', voiceHint: '复用路人原型的音色（中年男）', voices: barks.archetypes.driver.voices.slice(0, 1),
    voiceDesign: barks.archetypes.driver.voiceDesign.slice(0, 1),
    style: '胡同里吆喝的北京爷们儿，嗓门大，拖长音。', styleEn: 'A Beijing hawker calling out in the lanes.', rateRange: [1, 1],
  },
};
const doc = {
  version: 1,
  _note: '城市声音的台词（交通台、公交报站、吆喝）：由 scripts/voice/city.mts 从 src/audio/CityLines.ts 生成，别手改。',
  tts: { provider: 'aliyun-bailian', model: 'cosyvoice-v3.5-plus', format: 'mp3', sampleRate: 24000, variantsDefault: 1, languageHints: ['zh'], voiceListUrl: 'https://help.aliyun.com/zh/model-studio/cosyvoice-voice-list', emotions: ['neutral', 'fearful', 'angry', 'sad', 'surprised', 'happy', 'disgusted'] },
  archetypes,
  lines: cityLines().map((l) => ({ id: l.id, archetype: l.voice, trigger: 'city', emotion: 'neutral', text: l.text, instruct: l.instruct, textEn: '', instructEn: '' })),
};
fs.writeFileSync(OUT, JSON.stringify(doc, null, 1));
console.log(`${OUT}: ${doc.lines.length} lines`);
