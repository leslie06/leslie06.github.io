// Shared by scripts/voice/sprite.mjs (the barks' sprites) and dialogue-pack.mjs (the dialogue's files): each
// recording trimmed of its leading and trailing silence and brought to one loudness - measured with EBU R128
// loudnorm, then one gain to the target and a limiter under the true-peak ceiling (loudnorm's own second pass
// falls back to its dynamic mode whenever the linear gain would break the ceiling, and on clips of one to three
// seconds that left them 3-7 LU short and some peaks at +1 dBFS) - into a 24 kHz mono 16-bit wav, cached in
// .cache/voice/norm by the source's size and time and the settings.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

export const run = promisify(execFile);
export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const CACHE = path.join(root, '.cache/voice/norm');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : def; };
export const LUFS = arg('lufs', -16), TP = arg('tp', -1.5), LRA = 11, RATE = 24000;
// Trim: anything under -45 dB at either end goes, then silence is put back inside each clip's span: 40 ms before
// (the onset is not clipped) and 100 ms after - a decoder that does not drop the mp3 encoder's delay (~46 ms at
// 24 kHz) plays everything that much later, and the tail must still fit inside [start, end]. Chromium drops it
// (checked: onsets land 40 ms after start, as in ffmpeg); WebKit could not be checked here.
const TRIM = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,areverse';

/** Trim and normalise one recording; returns the cached wav's path. */
export async function normalise(file) {
  fs.mkdirSync(CACHE, { recursive: true });
  const st = fs.statSync(file);
  const key = createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}|${LUFS}|${TP}|${LRA}|${TRIM}|v4`).digest('hex').slice(0, 16);
  const out = path.join(CACHE, `${key}.wav`);
  if (fs.existsSync(out)) return out;
  // Pass 1: measure the trimmed clip. Integrated loudness is gated in 400 ms blocks, so a word shorter than that
  // (「走一个！」 trimmed) measures -inf: it is measured again played four times over (the same loudness).
  const measure = async (loops) => {
    const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', ...(loops ? ['-stream_loop', String(loops)] : []), '-i', file, '-af', `${TRIM},loudnorm=I=${LUFS}:TP=${TP}:LRA=${LRA}:print_format=json`, '-f', 'null', '-'], { maxBuffer: 1 << 24 });
    return JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1));
  };
  let m = await measure(0);
  if (!Number.isFinite(Number(m.input_i))) m = await measure(3);
  if (!Number.isFinite(Number(m.input_i))) throw new Error(`cannot measure the loudness of ${file}`);
  // Pass 2: one gain to the target (the delivery is not reshaped), and a fast limiter 1.5 dB under the ceiling
  // for the few shouts whose peaks it would push over (the mp3 encoder adds a little overshoot of its own).
  const gain = (LUFS - Number(m.input_i)).toFixed(2), ceiling = Math.pow(10, (TP - 1.5) / 20).toFixed(4);
  const norm = `volume=${gain}dB,alimiter=limit=${ceiling}:attack=1:release=60:level=false`;
  await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', file, '-af', `${TRIM},${norm},adelay=40:all=1,apad=pad_dur=0.1`, '-ar', String(RATE), '-ac', '1', '-c:a', 'pcm_s16le', out + '.tmp.wav']);
  fs.renameSync(out + '.tmp.wav', out);
  return out;
}

/** fn over every item, a few at a time (ffmpeg is single-threaded per clip). */
export async function eachParallel(items, fn) {
  const done = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(2, os.cpus().length - 2) }, async () => {
    while (next < items.length) { const i = next++; done[i] = await fn(items[i], i); }
  }));
  return done;
}
