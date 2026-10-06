// The dialogue's CosyVoice recordings (assets/voice/dialogue-raw, tools/voice-gen --lines assets/voice/dialogue.json)
// -> public/voice/zh/<voice>/<key>.mp3 + public/voice/manifest.json, which audio/VoiceClips.ts plays: one file a
// line and voice, fetched the first time it is said (a line is said rarely: a sprite would load hundreds for one).
// Each is trimmed and normalised as the barks are (norm.mjs) and encoded as 32 kbit/s mono mp3. Files from
// before (the Edge voices) that this run does not write are removed.
//   node scripts/voice/dialogue-pack.mjs
import fs from 'node:fs';
import path from 'node:path';
import { eachParallel, normalise, RATE, root, run } from './norm.mjs';

const VOICE = path.join(root, 'assets/voice');
const RAW = path.join(VOICE, 'dialogue-raw'), OUT = path.join(root, 'public/voice');
const GENERAL = ['my', 'mm', 'mo', 'fy', 'fm', 'fo'];
const d = JSON.parse(fs.readFileSync(path.join(VOICE, 'dialogue.json'), 'utf8'));

const jobs = [], missing = [];
for (const l of d.lines) {
  const voice = d.archetypes[l.archetype].voices[0];
  const src = voice && path.join(RAW, `${l.id}_${voice}_1.mp3`);
  if (src && fs.existsSync(src)) jobs.push({ key: l.id, cls: l.archetype, src, dst: path.join(OUT, 'zh', l.archetype, `${l.id}.mp3`) });
  else missing.push(`${l.archetype}/${l.id}`);
}
if (missing.length) console.log(`${missing.length} not recorded yet (left out), e.g. ${missing[0]}`);

await eachParallel(jobs, async (j) => {
  const wav = await normalise(j.src);
  fs.mkdirSync(path.dirname(j.dst), { recursive: true });
  const stamp = path.join(root, '.cache/voice/dpack', j.cls, j.key);   // which wav dst was made from
  fs.mkdirSync(path.dirname(stamp), { recursive: true });
  if (fs.existsSync(j.dst) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === wav) return;
  await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', wav, '-ar', String(RATE), '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '32k', j.dst]);
  fs.writeFileSync(stamp, wav);
});

// Whatever this run did not write goes (the Edge recordings and their .src stamps, lines since removed).
const keep = new Set(jobs.map((j) => j.dst));
for (const dir of fs.readdirSync(path.join(OUT, 'zh'))) {
  for (const f of fs.readdirSync(path.join(OUT, 'zh', dir))) {
    const p = path.join(OUT, 'zh', dir, f);
    if (!keep.has(p)) fs.rmSync(p);
  }
  if (!fs.readdirSync(path.join(OUT, 'zh', dir)).length) fs.rmdirSync(path.join(OUT, 'zh', dir));
}

// The manifest: which keys there are, and the ones said by particular voices only (a contact, the foreigner).
const byKey = new Map();
for (const j of jobs) { if (!byKey.has(j.key)) byKey.set(j.key, []); byKey.get(j.key).push(j.cls); }
const only = {};
for (const [k, cs] of byKey) if (!GENERAL.every((g) => cs.includes(g))) only[k] = cs;
const characters = Object.keys(d.archetypes).filter((a) => !GENERAL.includes(a));
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ v: 2, engine: 'cosyvoice', zh: { classes: GENERAL, characters, keys: [...byKey.keys()].sort(), only } }) + '\n');
let bytes = 0;
for (const p of keep) bytes += fs.statSync(p).size;
console.log(`${byKey.size} lines, ${jobs.length} files, ${(bytes / 1e6).toFixed(1)} MB -> public/voice/`);
