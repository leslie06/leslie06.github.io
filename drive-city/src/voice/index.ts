import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { AudioApi } from '../audio';
import type { NpcVoice, PeopleApi, VoiceApi, WorldApi } from '../game/Contracts';
import { lang, t } from '../core/I18n';
import { ARCHETYPES, Director, TRIGGERS, type Archetype, type Line, type Output, type Speaker, type Sprite, type Trigger } from './Director';
import spriteUrl from '../../assets/voice/dist/sprite.json?url';

/** The archetypes' sprites, by file name (Vite hashes and emits them; fetched when first needed). */
const MP3: Record<string, string> = Object.fromEntries(Object.entries(
  import.meta.glob('../../assets/voice/dist/*.mp3', { query: '?url', import: 'default', eager: true }) as Record<string, string>,
).map(([k, v]) => [k.slice(k.lastIndexOf('/') + 1), v]));

/** Positional audio voices (the speakers are capped lower, by `maxConcurrentSpeakers`; the rest fade out). */
const POOL = 8;
/** Mouth height over the feet / the car's centre. */
const MOUTH = 1.55;
const VOLUME = 1.0;
/** Fetch every archetype this long after the game starts (the first lines of one not in yet are not said). */
const PREFETCH_AFTER = 15;
/** Passers-by near a landmark speak as tourists (half of the adults under 60). */
const TOURIST_RADIUS = 160;

interface Slot { audio: THREE.PositionalAudio; line: Line | null; pos: { x: number; y: number; z: number } | null; until: number }
interface Entry { speaker: Speaker; seed: number; voice: NpcVoice; pos: { readonly x: number; readonly y: number; readonly z: number } }

/**
 * VoiceManager (2026-10-06): the NPC barks recorded with CosyVoice, one mp3 sprite per archetype
 * (assets/voice/dist, scripts/voice/sprite.mjs), played through a pool of THREE.PositionalAudio attached to
 * the scene, heard from an AudioListener on the camera in the audio system's own context and through its
 * master bus (mute covers it). Director.ts holds the rules (which line, cooldowns, priorities, the speaker
 * cap, rates); this binds them to the game: `npc(key, archetype, pos)` hands out a voice per person, and
 * `say(trigger)` on it plays a line where they stand. people/ drives the passers-by (hit, bumped, near_miss,
 * police_call, greet, idle), the drivers honk here (`traffic:horn`), a carjacked driver and a thrown
 * delivery rider speak through spawnFleeing. F9 shows a test panel (pick an archetype and an event).
 */
export async function install(engine: Engine): Promise<void> {
  let sprite: Sprite | null = null;
  let director: Director | null = null;
  let listener: THREE.AudioListener | null = null;
  const slots: Slot[] = [];
  const buffers = new Map<string, AudioBuffer | Promise<AudioBuffer | null>>();
  const entries = new WeakMap<object, Entry>();
  let unlocked = false, startedAt = -1, prefetched = false;
  const audio = () => engine.get<AudioApi>('audio');
  const clock = () => performance.now() / 1000;

  void fetch(spriteUrl).then((r) => (r.ok ? r.json() : null)).then((s: Sprite | null) => {
    if (!s) return;
    sprite = s;
    director = new Director(s, output);
  }).catch(() => { /* no barks: people/ falls back to its shouts */ });

  const ctxOf = () => audio()?.context ?? null;
  const load = (arch: Archetype): AudioBuffer | null => {
    const a = sprite?.archetypes[arch], c = ctxOf();
    if (!a || !c) return null;
    const b = buffers.get(arch);
    if (b instanceof AudioBuffer) return b;
    if (!b) {
      const url = MP3[a.file];
      if (!url) return null;
      buffers.set(arch, fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((ab) => c.decodeAudioData(ab)).then((buf) => { buffers.set(arch, buf); return buf; })
        .catch(() => { buffers.delete(arch); return null; }));
    }
    return null;
  };

  const output: Output = {
    ready(arch) {
      if (!unlocked || audio()?.muted || engine.paused) return false;
      return load(arch) !== null;
    },
    play(line) {
      const buf = load(line.speaker.archetype);
      if (!buf || !listener) return;
      const now = clock();
      // A free voice; else one fading out; else the oldest.
      let slot = slots.find((s) => !s.line && now >= s.until) ?? slots.find((s) => !s.line) ?? slots.reduce((a, b) => (a.until < b.until ? a : b));
      const a = slot.audio;
      if (a.isPlaying) a.stop();
      a.setBuffer(buf);
      a.offset = line.clip.start;
      a.duration = line.clip.end - line.clip.start;
      a.setPlaybackRate(line.rate);
      const g = a.gain.gain, ct = a.context.currentTime;
      g.cancelScheduledValues(ct); g.setValueAtTime(VOLUME, ct);
      const e = entryOf(line.speaker);
      slot.line = line; slot.pos = e ? (e.pos as Slot['pos']) : null;
      place(slot);
      a.play();
      slot.until = now + a.duration / line.rate + 0.1;
      const src = a.source as AudioBufferSourceNode | null;
      if (src) src.onended = () => {
        a.onEnded();
        if (slot.line === line) { slot.line = null; director?.ended(line); }
      };
    },
    stop(line) {
      const slot = slots.find((s) => s.line === line);
      if (!slot) return;
      slot.line = null;
      const a = slot.audio, ct = a.context.currentTime;
      if (!a.isPlaying) return;
      a.gain.gain.setTargetAtTime(0, ct, 0.03);
      a.stop(0.15);
      slot.until = clock() + 0.2;
    },
  };

  /** Which entry a speaker belongs to (for its position). */
  const speakerPos = new WeakMap<Speaker, Entry>();
  const entryOf = (s: Speaker) => speakerPos.get(s) ?? null;

  const place = (slot: Slot) => {
    if (slot.pos) slot.audio.position.set(slot.pos.x, slot.pos.y + MOUTH, slot.pos.z);
  };

  const heard = (pos: { x: number; z: number }) => {
    const cam = engine.camera.position, max = sprite?.playback.maxDistance ?? 45;
    return Math.hypot(pos.x - cam.x, pos.z - cam.z) <= max;
  };

  const makeVoice = (e: Entry): NpcVoice => ({
    get archetype() { return e.speaker.archetype; },
    get rate() { return e.speaker.rate; },
    get speaking() { return !!e.speaker.line && !e.speaker.line.cut; },
    say(trigger, onDone) {
      if (!director || !heard(e.pos)) return null;
      director.now = clock();
      const line = director.say(e.speaker, trigger, onDone);
      return line ? line.clip.text : null;
    },
    stop() { director?.silence(e.speaker); },
  });

  // Landmarks' centres, for the tourists.
  let landmarkPts: [number, number][] | null = null;
  const nearLandmark = (x: number, z: number) => {
    if (!landmarkPts) {
      const areas = engine.get<WorldApi>('world')?.landmarkAreas;
      if (!areas) return false;
      landmarkPts = areas.filter((a) => a.id !== 'home').map((a) => {
        let sx = 0, sz = 0, n = 0;
        for (const r of a.rings) for (let i = 0; i < r.length; i += 2) { sx += r[i]; sz += r[i + 1]; n++; }
        return [sx / Math.max(1, n), sz / Math.max(1, n)] as [number, number];
      });
    }
    return landmarkPts.some(([lx, lz]) => (lx - x) ** 2 + (lz - z) ** 2 < TOURIST_RADIUS ** 2);
  };

  const api: VoiceApi & { debug: Record<string, unknown> } = {
    name: 'voices',
    get ready() { return unlocked && !!director; },
    unlock() {
      if (unlocked) return;
      const c = ctxOf(), out = audio()?.output;
      if (!c || !out) return;
      // three's audio objects all use THREE.AudioContext's context: make it the game's own.
      THREE.AudioContext.setContext(c);
      listener = new THREE.AudioListener();
      listener.gain.disconnect();
      listener.gain.connect(out);
      engine.camera.add(listener);
      for (let i = 0; i < POOL; i++) {
        const a = new THREE.PositionalAudio(listener);
        a.setDistanceModel('inverse');
        a.setRefDistance(sprite?.playback.refDistance ?? 4);
        a.setRolloffFactor(sprite?.playback.rolloffFactor ?? 1.5);
        a.setMaxDistance(sprite?.playback.maxDistance ?? 45);
        a.panner.panningModel = 'HRTF';
        a.name = 'voice';
        engine.scene.add(a);
        slots.push({ audio: a, line: null, pos: null, until: 0 });
      }
      unlocked = true;
    },
    npc(key, archetype, pos, opts) {
      const seed = opts?.seed ?? 0;
      let e = entries.get(key);
      if (!e || e.seed !== seed || e.speaker.archetype !== archetype || !director) {
        if (e && director) director.silence(e.speaker);
        const speaker: Speaker = director?.speaker(archetype, opts?.sex ?? null, seed)
          ?? { archetype, voiceIndex: 0, rate: 1, said: new Map(), line: null };
        const ne: Entry = { speaker, seed, pos, voice: null as unknown as NpcVoice };
        ne.voice = makeVoice(ne);
        if (director) { entries.set(key, ne); speakerPos.set(speaker, ne); }
        e = ne;
      }
      e.pos = pos;
      return e.voice;
    },
    archetypeFor(look, seed, x, z) {
      const fem = (look.fem ?? 0) > 0.5, age = look.age ?? 0.4;
      const h = Math.abs(Math.sin(seed * 91.17 + 3.3) * 43758.5453) % 1;
      if (!fem && age >= 0.72) return 'uncle';
      if (fem && age >= 0.45) return 'auntie';
      if (age < 0.6 && h < 0.5 && nearLandmark(x, z)) return 'tourist';
      if (!fem && age >= 0.33 && look.cap && h < 0.35) return 'guard';
      return 'office';
    },
    update() {
      panel.update();
      if (!unlocked || !director) return;
      if (startedAt >= 0 && !prefetched && clock() - startedAt > PREFETCH_AFTER) {
        prefetched = true;
        for (const a of ARCHETYPES) load(a);
      }
      for (const s of slots) if (s.line) place(s);
    },
    debug: {
      get slots() { return slots.map((s) => (s.line ? `${s.line.clip.id}#${s.line.clip.variant} x${s.line.rate.toFixed(2)}` : '-')); },
      get speakers() { return director?.speakers ?? 0; },
      get loaded() { return [...buffers.entries()].filter(([, b]) => b instanceof AudioBuffer).map(([k]) => k); },
      load,
    },
  };

  engine.events.on('game:start', () => { if (startedAt < 0) startedAt = clock(); });
  engine.events.on('game:pause', ({ paused }) => { if (paused) director?.silenceAll(); });

  // A driver held up or hit leans on the horn, and now and then shouts out of the window too.
  const hornKeys = new WeakMap<object, number>();
  let hornSeed = 1;
  engine.events.on('traffic:horn', ({ x, z, car }) => {
    if (!api.ready || Math.random() > 0.55) return;
    const key = car ?? null;
    if (!key) return;
    if (!hornKeys.has(key)) hornKeys.set(key, hornSeed++);
    const pos = (car as { pos?: { x: number; y: number; z: number } }).pos ?? { x, y: 0, z };
    api.npc(key, 'driver', pos, { sex: 'm', seed: hornKeys.get(key)! }).say('honk');
  });

  // ---------------------------------------------------------------- F9 test panel
  const panel = (() => {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:8px;top:200px;z-index:9999;padding:8px 10px;background:rgba(6,8,12,.86);color:#dfe6f2;' +
      'font:12px/1.5 ui-monospace,Menlo,monospace;border-left:2px solid #f3b50f;display:grid;gap:5px;min-width:250px';
    el.hidden = !new URLSearchParams(location.search).has('diag');
    el.style.display = el.hidden ? 'none' : 'grid';
    for (const ev of ['pointerdown', 'mousedown', 'keydown'] as const) el.addEventListener(ev, (e) => e.stopPropagation());
    const title = document.createElement('div');
    const who = document.createElement('select'), what = document.createElement('select'), go = document.createElement('button');
    const status = document.createElement('div');
    status.style.cssText = 'white-space:pre;color:#9aa6b8;font-size:11px';
    for (const s of [who, what, go]) s.style.cssText = 'font:12px ui-monospace,Menlo,monospace;background:#1b2028;color:#dfe6f2;border:1px solid #3a4250;border-radius:4px;padding:3px 5px';
    const row = (label: HTMLElement, field: HTMLElement) => { const r = document.createElement('label'); r.style.cssText = 'display:flex;gap:6px;align-items:center;justify-content:space-between'; r.append(label, field); return r; };
    const whoL = document.createElement('span'), whatL = document.createElement('span');
    el.append(title, row(whoL, who), row(whatL, what), go, status);
    document.body.appendChild(el);
    let builtFor = '';
    const fill = () => {
      const key = `${lang()}|${!!sprite}`;
      if (builtFor === key) return;
      builtFor = key;
      title.textContent = t('diag.voice.title');
      whoL.textContent = t('diag.voice.who'); whatL.textContent = t('diag.voice.trigger'); go.textContent = t('diag.voice.play');
      const keep = [who.value, what.value];
      who.textContent = ''; what.textContent = '';
      const o = (sel: HTMLSelectElement, v: string, text: string) => { const op = document.createElement('option'); op.value = v; op.textContent = text; sel.appendChild(op); };
      o(who, 'near', t('diag.voice.nearest'));
      for (const a of ARCHETYPES) o(who, a, `${a}${sprite?.archetypes[a] && lang() === 'zh' ? ` ${sprite.archetypes[a]!.name}` : ''}`);
      for (const tr of TRIGGERS) o(what, tr, `${tr}${sprite && lang() === 'zh' ? ` ${sprite.triggers[tr].desc}` : ''}`);
      if (keep[0]) who.value = keep[0];
      if (keep[1]) what.value = keep[1];
    };
    // The test speaker: 6 m in front of the camera, one per archetype (so its cooldowns are its own).
    const testKeys = new Map<string, object>();
    const testPos = new THREE.Vector3();
    let last = '';
    const fire = () => {
      if (!api.ready) { last = t('diag.voice.locked'); return; }
      const trigger = what.value as Trigger;
      const cam = engine.camera, dir = new THREE.Vector3();
      cam.getWorldDirection(dir);
      let v: NpcVoice | null = null;
      if (who.value === 'near') v = engine.get<PeopleApi>('people')?.voiceNear?.(cam.position.x, cam.position.z, 40) ?? null;
      else {
        testPos.set(cam.position.x + dir.x * 6, cam.position.y - MOUTH, cam.position.z + dir.z * 6);
        if (!testKeys.has(who.value)) testKeys.set(who.value, {});
        v = api.npc(testKeys.get(who.value)!, who.value as Archetype, testPos, { seed: testKeys.size + Math.floor(Math.random() * 1000) });
      }
      if (!v) { last = t('diag.voice.nobody'); return; }
      const at = who.value === 'near' ? null : testPos.clone();
      const text = v.say(trigger, trigger === 'police_call' ? (done) => {
        // The call made: one more star (as a witness's report does).
        if (!done) return;
        const p = at ?? engine.camera.position;
        engine.events.emit('people:report', { x: p.x, z: p.z });
      } : undefined);
      last = text ? `${v.archetype}: ${text}` : t('diag.voice.dropped');
      if (!text) load(v.archetype);
    };
    go.addEventListener('click', fire);
    what.addEventListener('change', fire);
    return {
      update() {
        if (engine.input.state.diagPressed) {
          el.hidden = !el.hidden;
          el.style.display = el.hidden ? 'none' : 'grid';
        }
        if (el.hidden) return;
        fill();
        const loaded = (api.debug.loaded as string[]).join(',') || '-';
        status.textContent = `${t('diag.voice.speakers')} ${director?.speakers ?? 0}/${sprite?.playback.maxConcurrentSpeakers ?? 3}  ${t('diag.voice.loaded')} ${loaded}\n${last}`;
      },
    };
  })();

  engine.add(api);
}
