"""
Record the NPCs' lines with Microsoft's neural voices (edge-tts) - 2026-10-05, 「说话不自然，一听就是机器人说的」.
Six voices, by sex and age (`VOICES`; the game picks one from the speaker's VoiceSpec: audio/VoiceClips.ts):
every line in `.cache/voice/lines.json` (scripts/voice/lines.mts) is recorded in each, trimmed of silence and
encoded as 32 kbit/s mono mp3 into public/voice/zh/<class>/<key>.mp3, with public/voice/manifest.json.
Raw recordings are cached by voice and text in .cache/voice/raw, so a re-run only records what changed.
  python3 -m venv .cache/voice-venv && .cache/voice-venv/bin/pip install edge-tts
  npx tsx scripts/voice/lines.mts > .cache/voice/lines.json && .cache/voice-venv/bin/python scripts/voice/render.py
"""
import asyncio, hashlib, json, os, subprocess, sys
import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(ROOT, '.cache/voice/raw')
OUT = os.path.join(ROOT, 'public/voice')

# class: (voice, rate, pitch). There are no old voices: the old are the mature ones, slower and lower.
VOICES = {
  'my': ('zh-CN-YunxiNeural', '+0%', '+0Hz'),     # young man
  'mm': ('zh-CN-YunjianNeural', '+0%', '+0Hz'),   # man
  'mo': ('zh-CN-YunyangNeural', '-12%', '-8Hz'),  # old man
  'fy': ('zh-CN-XiaoyiNeural', '+0%', '+0Hz'),    # young woman
  'fm': ('zh-CN-XiaoxiaoNeural', '+0%', '-4Hz'),  # woman
  'fo': ('zh-CN-XiaoxiaoNeural', '-10%', '-14Hz'),  # old woman
  'xm': ('en-US-AndrewMultilingualNeural', '+0%', '+0Hz'),  # a foreigner's Chinese
}
# Lines only one kind of speaker says, recorded in that voice alone (the game plays it whoever says it).
ONLY = {'npc.foreigner.': ['xm']}
GENERAL = [c for c in VOICES if c != 'xm']

def classes_of(key):
  for pre, cs in ONLY.items():
    if key.startswith(pre): return cs
  return GENERAL

def raw_path(cls, text):
  v, r, p = VOICES[cls]
  h = hashlib.sha1(f'{v}|{r}|{p}|{text}'.encode()).hexdigest()[:16]
  return os.path.join(RAW, f'{h}.mp3')

async def record(sem, cls, text):
  path = raw_path(cls, text)
  if os.path.exists(path) and os.path.getsize(path) > 0: return path
  v, r, p = VOICES[cls]
  async with sem:
    for attempt in range(10):
      try:
        await edge_tts.Communicate(text, v, rate=r, pitch=p).save(path + '.part')
        if os.path.getsize(path + '.part') > 0:
          os.replace(path + '.part', path); return path
      except Exception as e:
        pass   # Yunxi often answers nothing the first time
      await asyncio.sleep(1 + attempt * 2)
  raise RuntimeError(f'no audio for {cls} {text}')

def encode(src, dst):
  os.makedirs(os.path.dirname(dst), exist_ok=True)
  # Trim the silence the service leaves at both ends (the dialogue box is already typing).
  trim = 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,apad=pad_dur=0.08'
  subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-af', trim, '-ac', '1', '-ar', '24000', '-b:a', '32k', dst], check=True)

async def main():
  lines = json.load(open(os.path.join(ROOT, '.cache/voice/lines.json')))
  os.makedirs(RAW, exist_ok=True)
  sem = asyncio.Semaphore(6)
  jobs = [(cls, l) for l in lines for cls in classes_of(l['key'])]
  paths = await asyncio.gather(*(record(sem, cls, l['text']) for cls, l in jobs))
  keep = set()
  for (cls, l), src in zip(jobs, paths):
    dst = os.path.join(OUT, 'zh', cls, l['key'] + '.mp3')
    keep.add(dst)
    stamp = os.path.join(ROOT, '.cache/voice/stamps', cls, l['key'])   # which recording dst was made from
    os.makedirs(os.path.dirname(stamp), exist_ok=True)
    if os.path.exists(dst) and os.path.exists(stamp) and open(stamp).read() == src: continue
    encode(src, dst); open(stamp, 'w').write(src)
  for d, _, fs in os.walk(os.path.join(OUT, 'zh')):   # lines that are gone
    for f in fs:
      p = os.path.join(d, f)
      if p not in keep: os.remove(p)
  only = {l['key']: classes_of(l['key']) for l in lines if classes_of(l['key']) is not GENERAL}
  json.dump({'v': 1, 'zh': {'classes': GENERAL, 'keys': sorted(l['key'] for l in lines), 'only': only}}, open(os.path.join(OUT, 'manifest.json'), 'w'), ensure_ascii=False)
  total = sum(os.path.getsize(p) for p in keep)
  print(f'{len(lines)} lines, {len(keep)} clips, {total / 1e6:.1f} MB')

asyncio.run(main())
