/**
 * 幽灵车：把最佳圈的行车轨迹记下来，下次跑的时候当半透明的车放出来。
 *
 * 纯逻辑（不 import three / DOM），所以编解码可以直接单测。
 *
 * ## 存储体积
 * 一圈 60 秒、20Hz 采样 = 1200 个点。直接存 JSON 的话
 * `{"x":123.4567,"y":8.9,"z":-45.6,"h":1.23}` 一个点就 40 多字节，一圈 50KB，
 * 四条赛道就把 localStorage 的 5MB 配额啃掉一块。所以做了三层压缩：
 *
 *   1. **定点数**：位置量化到厘米、朝向量化到 1/1000 弧度（0.06°）。
 *      幽灵车是个参照物不是回放验证，这个精度绰绰有余；
 *   2. **只存差值**：20Hz 下相邻两点最多差一两米，数值从六位数掉到三位数；
 *   3. **zigzag + varint**：差值有正有负，zigzag 把符号折进低位，
 *      varint 让小数值只占一个字节。
 *
 * 实测一圈 60 秒压到 8~10KB（base64 之后 11~14KB），比 JSON 小四五倍。
 *
 * ## 为什么是 20Hz
 * 物理跑 60Hz，全存下来体积翻三倍，而幽灵车是**看**的：20Hz 采样 + 播放时线性
 * 插值，肉眼完全看不出和 60Hz 的区别（车不会在 50ms 里做出什么急动作）。
 */

/** 采样率（Hz）。改了之后老存档还能读 —— 采样间隔是存在文件里的 */
export const GHOST_SAMPLE_RATE = 20;
/** 位置量化：1 = 1cm */
const POS_SCALE = 100;
/** 朝向量化：1 = 1/1000 弧度 ≈ 0.057° */
const HEADING_SCALE = 1000;
/** 存档格式版本。字段变了就 +1，老版本直接当没有（幽灵车丢了不是大事） */
export const GHOST_VERSION = 1;

/** 一个采样点。裸数字，不用 Vector3 */
export interface GhostSample {
  x: number;
  y: number;
  z: number;
  /** 弧度，不归一化（和 KartState.heading 一样） */
  heading: number;
}

export interface GhostRecording {
  version: number;
  /** 这一圈的用时（秒） */
  lapTime: number;
  /** 采样间隔（秒） */
  interval: number;
  /** base64 的压缩轨迹 */
  data: string;
}

// ============================================================================
// 录制
// ============================================================================

/**
 * 按固定间隔采样。
 *
 * 喂进来的 dt 是**真实帧间隔**，采样点却要落在等间隔的时间格上，
 * 所以用累加器而不是"每 N 帧存一次"——后者在掉帧时会把轨迹拉长，
 * 幽灵车就跑偏了。
 */
export class GhostRecorder {
  private readonly samples: GhostSample[] = [];
  private accumulator = 0;
  private elapsed = 0;

  constructor(private readonly interval = 1 / GHOST_SAMPLE_RATE) {}

  /** 这一圈已经采了几个点 */
  get length(): number {
    return this.samples.length;
  }

  /** 新的一圈开始。**每次过线都要调**，否则轨迹会把好几圈连成一条 */
  reset(): void {
    this.samples.length = 0;
    this.accumulator = 0;
    this.elapsed = 0;
  }

  /**
   * 推进一帧。第一帧无条件采一个点（起跑线上那个），之后按间隔补。
   * @param dt 真实帧间隔
   */
  push(dt: number, sample: Readonly<GhostSample>): void {
    if (this.samples.length === 0) {
      this.samples.push({ ...sample });
      return;
    }
    this.elapsed += dt;
    this.accumulator += dt;
    // while 而不是 if：一帧掉到 100ms 时要补两个点，不然轨迹会缺一段
    while (this.accumulator >= this.interval) {
      this.accumulator -= this.interval;
      this.samples.push({ ...sample });
    }
  }

  /**
   * 收尾，打包成可以存的东西。
   * @returns 点数太少（不足半秒）时返回 null —— 那种轨迹放出来只会是个抽搐的方块
   */
  finish(lapTime: number): GhostRecording | null {
    if (this.samples.length < GHOST_SAMPLE_RATE / 2) return null;
    return {
      version: GHOST_VERSION,
      lapTime,
      interval: this.interval,
      data: encodeSamples(this.samples),
    };
  }
}

// ============================================================================
// 播放
// ============================================================================

/**
 * 把录像放出来。按时间取样，两点之间线性插值。
 *
 * 朝向也直接线性插值：录的是**不归一化**的 heading（和 KartState 一样），
 * 所以不存在 -π/π 跳变的问题，直接 lerp 就是对的。
 */
export class GhostPlayback {
  readonly samples: readonly GhostSample[];
  readonly interval: number;
  readonly lapTime: number;
  private readonly out: GhostSample = { x: 0, y: 0, z: 0, heading: 0 };

  constructor(recording: GhostRecording) {
    this.samples = decodeSamples(recording.data);
    this.interval = recording.interval > 0 ? recording.interval : 1 / GHOST_SAMPLE_RATE;
    this.lapTime = recording.lapTime;
  }

  get duration(): number {
    return Math.max(0, (this.samples.length - 1) * this.interval);
  }

  get valid(): boolean {
    return this.samples.length >= 2;
  }

  /**
   * 取 t 秒时的位置和朝向。**返回的是复用的对象**，别长期持有。
   * 超出录像长度就停在最后一个点上（幽灵车已经冲线了，停在那儿等着）。
   */
  sampleAt(t: number): Readonly<GhostSample> {
    const n = this.samples.length;
    if (n === 0) return this.out;
    if (t <= 0) return this.samples[0]!;

    const index = t / this.interval;
    const i = Math.floor(index);
    if (i >= n - 1) return this.samples[n - 1]!;

    const a = this.samples[i]!;
    const b = this.samples[i + 1]!;
    const f = index - i;
    this.out.x = a.x + (b.x - a.x) * f;
    this.out.y = a.y + (b.y - a.y) * f;
    this.out.z = a.z + (b.z - a.z) * f;
    this.out.heading = a.heading + (b.heading - a.heading) * f;
    return this.out;
  }
}

// ============================================================================
// 编解码
// ============================================================================

/** 采样点 -> base64。定点数 + 差值 + zigzag varint，见文件顶上的说明 */
export function encodeSamples(samples: readonly GhostSample[]): string {
  const bytes: number[] = [];
  let px = 0;
  let py = 0;
  let pz = 0;
  let ph = 0;
  for (const s of samples) {
    const x = Math.round(s.x * POS_SCALE);
    const y = Math.round(s.y * POS_SCALE);
    const z = Math.round(s.z * POS_SCALE);
    const h = Math.round(s.heading * HEADING_SCALE);
    writeVarint(bytes, zigzag(x - px));
    writeVarint(bytes, zigzag(y - py));
    writeVarint(bytes, zigzag(z - pz));
    writeVarint(bytes, zigzag(h - ph));
    px = x;
    py = y;
    pz = z;
    ph = h;
  }
  return toBase64(Uint8Array.from(bytes));
}

/** base64 -> 采样点。数据坏了返回空数组，不抛 —— 幽灵车没了就没了 */
export function decodeSamples(data: string): GhostSample[] {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(data);
  } catch {
    return [];
  }

  const out: GhostSample[] = [];
  let px = 0;
  let py = 0;
  let pz = 0;
  let ph = 0;
  let i = 0;
  while (i < bytes.length) {
    const read = () => {
      const [value, next] = readVarint(bytes, i);
      i = next;
      return unzigzag(value);
    };
    // 一个点是四个 varint，读不齐就说明数据被截断了，停在这儿
    const before = i;
    px += read();
    py += read();
    pz += read();
    ph += read();
    if (i === before || i > bytes.length) break;
    out.push({
      x: px / POS_SCALE,
      y: py / POS_SCALE,
      z: pz / POS_SCALE,
      heading: ph / HEADING_SCALE,
    });
  }
  return out;
}

/** zigzag：把符号折进最低位，负的小数值也能只占一个字节 */
function zigzag(v: number): number {
  return v < 0 ? -v * 2 - 1 : v * 2;
}

function unzigzag(v: number): number {
  return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
}

/** LEB128：每字节 7 位数据 + 1 位"还有下一字节" */
function writeVarint(out: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v & 0x7f);
}

function readVarint(bytes: Uint8Array, offset: number): [value: number, next: number] {
  let value = 0;
  let shift = 1;
  let i = offset;
  while (i < bytes.length) {
    const b = bytes[i]!;
    i++;
    value += (b & 0x7f) * shift;
    if ((b & 0x80) === 0) return [value, i];
    shift *= 128;
  }
  return [value, i];
}

/** Uint8Array -> base64。分块喂给 btoa，一次性 apply 几万字节会爆调用栈 */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ============================================================================
// 存储
// ============================================================================

export interface GhostStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 每条赛道一份幽灵。和圈速纪录一样，不同赛道之间没有可比性 */
export function ghostKey(trackId: string): string {
  return `kart-new.ghost.v${GHOST_VERSION}.${trackId}`;
}

export class GhostStore {
  constructor(
    private readonly storage: GhostStorage | null,
    private readonly trackId: string,
  ) {}

  load(): GhostRecording | null {
    try {
      const raw = this.storage?.getItem(ghostKey(this.trackId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<GhostRecording>;
      if (parsed.version !== GHOST_VERSION) return null;
      if (typeof parsed.data !== 'string' || typeof parsed.lapTime !== 'number') return null;
      if (!Number.isFinite(parsed.lapTime) || parsed.lapTime <= 0) return null;
      const interval =
        typeof parsed.interval === 'number' && parsed.interval > 0
          ? parsed.interval
          : 1 / GHOST_SAMPLE_RATE;
      return { version: GHOST_VERSION, lapTime: parsed.lapTime, interval, data: parsed.data };
    } catch {
      return null;
    }
  }

  /**
   * 只在**更快**的时候写。
   * @returns 真的写进去了返回 true
   */
  saveIfFaster(recording: GhostRecording): boolean {
    const existing = this.load();
    if (existing && existing.lapTime <= recording.lapTime) return false;
    try {
      this.storage?.setItem(ghostKey(this.trackId), JSON.stringify(recording));
      return true;
    } catch {
      // 配额满了（幽灵车是这里面最占地方的东西）：存不下就算了，不影响比赛
      return false;
    }
  }

  clear(): void {
    try {
      this.storage?.removeItem(ghostKey(this.trackId));
    } catch {
      /* 同上 */
    }
  }
}

export function browserGhostStorage(): GhostStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
