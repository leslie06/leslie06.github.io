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
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const VOICE = path.join(root, 'assets/voice');
const RAW = path.join(VOICE, 'raw'), DIST = path.join(VOICE, 'dist'), CACHE = path.join(root, '.cache/voice/norm');

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : def; };
const LUFS = arg('lufs', -16), TP = arg('tp', -1.5), LRA = 11, KBPS = arg('kbps', 48), GAP = arg('gap', 0.3);
const RATE = 24000;
// Trim: anything under -45 dB at either end goes, then silence is put back inside each clip's span: 40 ms before
// (the onset is not clipped) and 100 ms after - a decoder that does not drop the mp3 encoder's delay (~46 ms at
// 24 kHz) plays everything that much later, and the tail must still fit inside [start, end]. Chromium drops it
// (checked: onsets land 40 ms after start, as in ffmpeg); WebKit could not be checked here.
const TRIM = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,areverse';

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

/** Trim and loudnorm one clip into a 24 kHz mono 16-bit wav in the cache; returns its path. */
async function normalise(c) {
  const st = fs.statSync(c.file);
  const key = createHash('sha1').update(`${c.file}|${st.size}|${st.mtimeMs}|${LUFS}|${TP}|${LRA}|${TRIM}|v4`).digest('hex').slice(0, 16);
  const out = path.join(CACHE, `${key}.wav`);
  if (fs.existsSync(out)) return out;
  // Pass 1: measure the trimmed clip.
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', c.file, '-af', `${TRIM},loudnorm=I=${LUFS}:TP=${TP}:LRA=${LRA}:print_format=json`, '-f', 'null', '-'], { maxBuffer: 1 << 24 });
  const m = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1));
  // Pass 2: one gain to the target (the delivery is not reshaped), and a fast limiter 1.5 dB under the ceiling
  // for the few shouts whose peaks it would push over (the mp3 encoder adds a little overshoot of its own).
  const gain = (LUFS - Number(m.input_i)).toFixed(2), ceiling = Math.pow(10, (TP - 1.5) / 20).toFixed(4);
  const norm = `volume=${gain}dB,alimiter=limit=${ceiling}:attack=1:release=60:level=false`;
  await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', c.file, '-af', `${TRIM},${norm},adelay=40:all=1,apad=pad_dur=0.1`, '-ar', String(RATE), '-ac', '1', '-c:a', 'pcm_s16le', out + '.tmp.wav']);
  fs.renameSync(out + '.tmp.wav', out);
  return out;
}

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
let next = 0;
const done = new Array(clips.length);
await Promise.all(Array.from({ length: Math.max(2, os.cpus().length - 2) }, async () => {
  while (next < clips.length) { const i = next++; done[i] = await normalise(clips[i]); }
}));

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
