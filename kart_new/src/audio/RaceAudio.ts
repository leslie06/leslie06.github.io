/**
 * 把"比赛里发生的事"翻译成"播哪个音"。
 *
 * 单独一层是为了让主循环干净：主循环只管把事件和状态转发过来，
 * "引擎声的音高怎么跟速度走"这种规则全在这里。
 * 这一层不 import three，只吃裸数字和已有的事件类型，所以能单测。
 *
 * 三条循环音一直在播（音量为 0 就是听不见），不反复启停：
 * 移动端每次 play() 都有几十毫秒的启动延迟，反复启停的漂移声会碎成一片。
 */
import type { KartEvent, KartState } from '../kart/kartStep';
import type { KartConfig } from '../kart/KartConfig';
import type { ItemEvent } from '../items/ItemSystem';
import type { RaceEvent } from '../race/RaceState';
import type { AudioManager, LoopHandle } from './AudioManager';
import { CHARGE_RATES } from './SoundDefs';

/** 引擎音高：怠速 0.75 倍，满速 2.35 倍。跨度要够大，不然听不出在加速 */
const ENGINE_RATE_IDLE = 0.75;
const ENGINE_RATE_TOP = 2.35;
/** boost 时额外拉高的音高 */
const ENGINE_RATE_BOOST = 0.35;
/** 引擎音量：怠速也要有声音，不然停车时像熄火了 */
const ENGINE_VOLUME_IDLE = 0.35;

export interface RaceAudioFrame {
  /** 插值后的玩家状态 */
  state: Readonly<KartState>;
  config: Readonly<KartConfig>;
  /** 玩家脚下的可行驶半宽，用来判断有没有蹭到护栏 */
  halfWidth: number;
  /** 这一帧车与车之间发生接触的对数（resolveKartCollisions 的返回值） */
  contacts: number;
  /** 比赛还没放行时把引擎压低一点，倒计时的读秒才听得清 */
  racing: boolean;
  frameDt: number;
}

export class RaceAudio {
  private engine: LoopHandle | null = null;
  private drift: LoopHandle | null = null;
  private charge: LoopHandle | null = null;

  /** 上一帧是不是已经贴着护栏了。用来把"一直蹭着"压成"撞上去那一下" */
  private onWall = false;
  private prevContacts = 0;
  /** 撞墙/撞车的冷却，防止贴着墙磨的时候每帧都响 */
  private hitCooldown = 0;
  private started = false;

  constructor(private readonly audio: AudioManager) {}

  /** 在用户手势里调（AudioManager.init 之后）。起三条循环音 */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.engine = this.audio.loop('engine', 0);
    this.drift = this.audio.loop('driftLoop', 0);
    this.charge = this.audio.loop('charge', 0);
    this.audio.loop('music', 1);
  }

  /** 每帧调一次 */
  update(frame: RaceAudioFrame): void {
    if (!this.started) return;
    const { state, config, frameDt } = frame;
    this.hitCooldown = Math.max(0, this.hitCooldown - frameDt);

    const speedRatio = clamp01(Math.abs(state.speed) / Math.max(config.maxSpeed, 0.001));

    // --- 引擎：音高跟速度走，boost 时再拔高一点 ---
    const boosting = state.boostTime > 0;
    const rate =
      ENGINE_RATE_IDLE +
      (ENGINE_RATE_TOP - ENGINE_RATE_IDLE) * speedRatio +
      (boosting ? ENGINE_RATE_BOOST : 0);
    this.engine?.setRate(rate);
    // 腾空时松一半油门的感觉：轮子不着地，引擎空转
    const airborneCut = state.airborne ? 0.6 : 1;
    this.engine?.setVolume(
      (ENGINE_VOLUME_IDLE + (1 - ENGINE_VOLUME_IDLE) * speedRatio) *
        airborneCut *
        (frame.racing ? 1 : 0.5),
    );

    // --- 漂移摩擦 + 蓄力 ---
    const drifting = state.driftPhase === 'drifting' && !state.airborne;
    this.drift?.setVolume(drifting ? 0.35 + 0.65 * speedRatio : 0);
    if (drifting) {
      // 蓄力音的音高按档位跳一级；还没成档时用最低档的音高、音量减半，
      // 表达"在充但还没到"
      const level = state.driftLevel;
      this.charge?.setRate(CHARGE_RATES[Math.max(0, level - 1)]!);
      this.charge?.setVolume(level > 0 ? 1 : 0.45);
    } else {
      this.charge?.setVolume(0);
    }

    // --- 撞墙。没有专门的事件，从"横向偏移顶到可行驶半宽"推出来 ---
    // 留 0.15m 余量：kartStep 把车推回来之后 lateral 会正好卡在边界上，
    // 严格相等的判断会在贴墙行驶时反复触发
    const hittingWall =
      frame.halfWidth > 0 && Math.abs(state.lateralOffset) >= frame.halfWidth - 0.15;
    if (hittingWall && !this.onWall && speedRatio > 0.15 && this.hitCooldown <= 0) {
      this.audio.play('wallHit', 0.9 + Math.random() * 0.2, 0.4 + 0.6 * speedRatio);
      this.hitCooldown = 0.18;
    }
    this.onWall = hittingWall;

    // --- 撞车。接触对数从 0 涨起来的那一帧才算"撞上"，之后是"挤着" ---
    if (frame.contacts > this.prevContacts && this.hitCooldown <= 0) {
      this.audio.play('kartHit', 0.9 + Math.random() * 0.25, 0.5 + 0.5 * speedRatio);
      this.hitCooldown = 0.12;
    }
    this.prevContacts = frame.contacts;
  }

  /** 玩家的漂移/boost 事件。AI 的不播 —— 八辆车一起响就成噪音了 */
  onKartEvent(event: KartEvent): void {
    if (!this.started) return;
    switch (event.type) {
      case 'boostStart':
        // 档位越高音高越低（听着更"重"），和火花从白到蓝是同一个意思
        this.audio.play('boost', 1.12 - event.level * 0.06);
        break;
      case 'driftLevelUp':
        // 成档那一下给一声短提示音，和持续的蓄力音叠在一起
        this.audio.play('uiClick', CHARGE_RATES[event.level - 1]!);
        break;
      case 'driftStart':
      case 'driftEnd':
      case 'boostEnd':
        // 这几个由循环音的音量变化表达，不再单独播一声
        break;
    }
  }

  /** 比赛事件。只播和玩家有关的 */
  onRaceEvent(event: RaceEvent, playerId: string): void {
    if (!this.started) return;
    switch (event.type) {
      case 'countdownTick':
        this.audio.play('countdown');
        break;
      case 'go':
        this.audio.play('countdownGo');
        break;
      case 'lap':
        if (event.id === playerId) this.audio.play(event.best ? 'record' : 'lap');
        break;
      case 'racerFinished':
        if (event.id === playerId) this.audio.play('finish');
        break;
      case 'raceFinished':
        break;
    }
  }

  /** 道具事件。玩家自己的响，别人的不响 */
  onItemEvent(event: ItemEvent, playerId: string): void {
    if (!this.started || event.kartId !== playerId) return;
    switch (event.type) {
      case 'pickup':
        this.audio.play('itemGet');
        break;
      case 'use':
        this.audio.play('itemUse');
        break;
      case 'hit':
        this.audio.play('itemHit');
        break;
      case 'blocked':
        this.audio.play('shieldBlock');
        break;
    }
  }

  /** 破纪录（不是比赛事件，由主循环单独告知） */
  onNewRecord(): void {
    if (this.started) this.audio.play('record');
  }

  /** 重开一局：把状态机清干净，不然新一局第一帧会误判成"刚撞上" */
  reset(): void {
    this.onWall = false;
    this.prevContacts = 0;
    this.hitCooldown = 0;
  }

  stop(): void {
    this.engine?.stop();
    this.drift?.stop();
    this.charge?.stop();
    this.engine = this.drift = this.charge = null;
    this.started = false;
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
