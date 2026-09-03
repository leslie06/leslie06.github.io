/**
 * 可选赛道表。**加一条赛道 = 同目录下加一个文件，再在这里挂上**。
 *
 * 别处不许写 `if (trackId === ...)`：难度、圈数、路宽、天空配色、装饰物
 * 全是 TrackDefinition 的字段（见 types.ts）。这和 ItemDefs / SoundDefs 是同一个路子。
 */
import { DUNES } from './dunes';
import { MEADOW } from './meadow';
import { RIDGE } from './ridge';
import { SUNSET } from './sunset';
import type { TrackDefinition, TrackId } from './types';

export type { TrackDecor, TrackDefinition, TrackId, TrackSkyColors } from './types';

export const TRACKS: Readonly<Record<TrackId, TrackDefinition>> = Object.freeze({
  meadow: MEADOW,
  sunset: SUNSET,
  ridge: RIDGE,
  dunes: DUNES,
});

/** 选择界面上的显示顺序：由易到难 */
export const TRACK_IDS: readonly TrackId[] = ['meadow', 'sunset', 'ridge', 'dunes'] as const;

export const DEFAULT_TRACK_ID: TrackId = 'sunset';

/** localStorage 和 URL 参数里的值都可能是乱写的，进来先过这一关 */
export function isTrackId(value: unknown): value is TrackId {
  return typeof value === 'string' && Object.hasOwn(TRACKS, value);
}

export function trackAt(id: TrackId): TrackDefinition {
  return TRACKS[id];
}
