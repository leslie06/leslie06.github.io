// 城市声音的录音（assets/voice/city-raw，tools/voice-gen --lines assets/voice/city.json）-> public/voice/city/<id>.mp3，
// 和对话一样裁掉首尾静音、响度归一（norm.mjs），32 kbit/s 单声道 mp3；游戏用到哪句才下载哪句（audio/Talk.ts、Soundscape.ts）。
//   node scripts/voice/city-pack.mjs
import fs from 'node:fs';
import path from 'node:path';
import { eachParallel, normalise, RATE, root, run } from './norm.mjs';

const VOICE = path.join(root, 'assets/voice'), RAW = path.join(VOICE, 'city-raw'), OUT = path.join(root, 'public/voice/city');
const d = JSON.parse(fs.readFileSync(path.join(VOICE, 'city.json'), 'utf8'));
const jobs = [], missing = [];
for (const l of d.lines) {
  const voice = d.archetypes[l.archetype].voices[0];
  const src = voice && path.join(RAW, `${l.id}_${voice}_1.mp3`);
  if (src && fs.existsSync(src)) jobs.push({ key: l.id, src, dst: path.join(OUT, `${l.id}.mp3`) });
  else missing.push(l.id);
}
if (missing.length) console.log(`${missing.length} not recorded yet (left out), e.g. ${missing[0]}`);
fs.mkdirSync(OUT, { recursive: true });
await eachParallel(jobs, async (j) => {
  const wav = await normalise(j.src);
  const stamp = path.join(root, '.cache/voice/cpack', j.key);
  fs.mkdirSync(path.dirname(stamp), { recursive: true });
  if (fs.existsSync(j.dst) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === wav) return;
  await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', wav, '-ar', String(RATE), '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '32k', j.dst]);
  fs.writeFileSync(stamp, wav);
});
const keep = new Set(jobs.map((j) => path.basename(j.dst)));
for (const f of fs.readdirSync(OUT)) if (!keep.has(f)) fs.rmSync(path.join(OUT, f));
let bytes = 0;
for (const f of fs.readdirSync(OUT)) bytes += fs.statSync(path.join(OUT, f)).size;
console.log(`public/voice/city: ${jobs.length} clips, ${(bytes / 1024).toFixed(0)} KB`);
