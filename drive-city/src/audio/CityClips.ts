/**
 * 城市声音的录音（public/voice/city/<id>.mp3，scripts/voice/city-pack.mjs）：用到哪句才下载、解码，解码好的留着。
 * 下载失败就当没有（交通台跳过这句，吆喝不出）：从不阻塞什么。
 */
const BASE: string = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

export class CityClips {
  private bufs = new Map<string, AudioBuffer | null>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  /** `dir`: the folder under public/voice/ (city: the radio and the street; nav: the satnav). */
  constructor(private ctx: AudioContext, private dir = 'city') {}

  /** The decoded clip, or null while it loads or when it failed (call `load` first to start it). */
  get(id: string): AudioBuffer | null { return this.bufs.get(id) ?? null; }

  /** Tried and failed (not found, or would not decode). */
  failed(id: string): boolean { return this.bufs.has(id) && this.bufs.get(id) === null; }

  load(id: string): Promise<AudioBuffer | null> {
    if (this.bufs.has(id)) return Promise.resolve(this.bufs.get(id)!);
    let p = this.loading.get(id);
    if (!p) {
      p = fetch(`${BASE}voice/${this.dir}/${id}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => this.ctx.decodeAudioData(b)).catch(() => null).then((buf) => { this.bufs.set(id, buf); this.loading.delete(id); return buf; });
      this.loading.set(id, p);
    }
    return p;
  }
}
