// NPC voice sprites: assets/voice/raw/*.mp3 (tools/voice-gen) -> one mp3 per archetype + sprite.json in
// assets/voice/dist/. Each clip has its leading and trailing silence trimmed and is loudness-normalised
// (measured with EBU R128 loudnorm, then one gain to the target and a limiter under the true-peak ceiling:
// loudnorm's own second pass falls back to its dynamic mode whenever the linear gain would break the ceiling,
// and on clips of one to three seconds that left them 3-7 LU short and some peaks at +1 dBFS), then the clips
// of an archetype are laid end to end with a gap of
// silence between them as 16-bit PCM and encoded once - so every start and end in sprite.json is exact to the
// sample. MP3, not Opus: iOS Safari's Opus support is poor.
//   node scripts/voice/sprite.mjs [--lufs -16] [--tp -1.5] [--kbps 48] [--gap 0.3]
// Processed clips are cached in .cache/voice/norm (by the raw file's size, time and the settings), so a
// re-run after adding clips only processes the new ones.
import fs from 'node:fs';
import path from 'node:path';
import { eachParallel, LUFS, normalise, RATE, root, run, TP } from './norm.mjs';

const LRA = 11;
const VOICE = path.join(root, 'assets/voice');
const RAW = path.join(VOICE, 'raw'), DIST = path.join(VOICE, 'dist'), CACHE = path.join(root, '.cache/voice/norm');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : def; };
const KBPS = arg('kbps', 48), GAP = arg('gap', 0.3);

const lines = JSON.parse(fs.readFileSync(path.join(VOICE, 'lines.json'), 'utf8'));
const variantsDefault = lines.tts.variantsDefault;

/** Every clip lines.json asks for, in its order: line, then voice, then variant. */
const clips = [];
const missing = [];
for (const l of lines.lines) {
  const voices = lines.archetypes[l.archetype].voices ?? [];
  voices.forEach((voice, vi) => {
    for (let n = 1; n <= (l.variants ?? variantsDefault); n++) {
      const file = path.join(RAW, `${l.id}_${voice}_${n}.mp3`);
      if (fs.existsSync(file)) clips.push({ id: l.id, archetype: l.archetype, trigger: l.trigger, emotion: l.emotion, text: l.text, voice, voiceIndex: vi, variant: n, file });
      else missing.push(path.basename(file));
    }
  });
}
if (missing.length) console.log(`${missing.length} clips not generated yet (skipped), e.g. ${missing[0]}`);

/** The samples of a 16-bit mono wav (its data chunk). */
function pcm(file) {
  const b = fs.readFileSync(file);
  let o = 12;
  while (o < b.length - 8) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === 'data') return b.subarray(o + 8, o + 8 + size);
    o += 8 + size + (size & 1);
  }
  throw new Error(`no data chunk in ${file}`);
}

fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });
const done = await eachParallel(clips, (c) => normalise(c.file));

// Everything the game needs to play them comes along (src/voice/ reads only this file): the playback rules, the
// triggers' priorities and cooldowns, each archetype's speaking-rate range and its voices' sex (from the design
// prompts: office and tourist have one man and one woman), and each clip's trigger and text (the speech bubble).
const playback = Object.fromEntries(Object.entries(lines.playback).filter(([k]) => !k.startsWith('_')));
const triggers = Object.fromEntries(Object.entries(lines.triggers).map(([k, v]) => [k, { priority: v.priority, cooldownSec: v.cooldownSec, desc: v.desc }]));
const sprite = { version: 1, format: 'mp3', sampleRate: RATE, channels: 1, kbps: KBPS, gap: GAP, loudness: { I: LUFS, TP, LRA }, playback, triggers, archetypes: {} };
const gap = Buffer.alloc(Math.round(GAP * RATE) * 2);
for (const arch of Object.keys(lines.archetypes)) {
  const mine = clips.map((c, i) => [c, done[i]]).filter(([c]) => c.archetype === arch);
  if (!mine.length) continue;
  const parts = [gap];   // a gap first too: an mp3 decoder's first frames are the least reliable
  let at = gap.length / 2;
  const entries = [];
  for (const [c, wav] of mine) {
    const s = pcm(wav);
    entries.push({ id: c.id, voice: c.voice, voiceIndex: c.voiceIndex, variant: c.variant, start: +(at / RATE).toFixed(4), end: +((at + s.length / 2) / RATE).toFixed(4), trigger: c.trigger, emotion: c.emotion, text: c.text });
    parts.push(s, gap);
    at += s.length / 2 + gap.length / 2;
  }
  const raw = path.join(CACHE, `${arch}.pcm`);
  fs.writeFileSync(raw, Buffer.concat(parts));
  const file = `${arch}.mp3`;
  await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 's16le', '-ar', String(RATE), '-ac', '1', '-i', raw, '-c:a', 'libmp3lame', '-b:a', `${KBPS}k`, '-write_xing', '1', path.join(DIST, file)]);
  fs.rmSync(raw);
  const A = lines.archetypes[arch];
  const voiceSex = (A.voiceDesign ?? []).slice(0, A.voices.length).map((d) => (/女/.test(d.prompt) ? 'f' : 'm'));
  sprite.archetypes[arch] = { name: A.name, rateRange: A.rateRange, voiceSex, file, duration: +(at / RATE).toFixed(4), clips: entries };
  console.log(`${arch}: ${entries.length} clips, ${(at / RATE).toFixed(1)} s, ${(fs.statSync(path.join(DIST, file)).size / 1024).toFixed(0)} KB`);
}
fs.writeFileSync(path.join(DIST, 'sprite.json'), JSON.stringify(sprite, null, 1) + '\n');
console.log(`wrote ${path.relative(root, DIST)}/sprite.json (${clips.length} clips)`);
