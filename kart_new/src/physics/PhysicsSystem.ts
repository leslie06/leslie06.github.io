import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { GroundSample } from '../kart/GroundSample';
import { drivableHalfWidth, type TrackConfig } from '../track/TrackConfig';
import { DEFAULT_TRACK_CONFIG } from '../track/TrackConfig';
import type { TrackCollision } from '../track/TrackMesh';
import type { TrackProgress, TrackSpline } from '../track/TrackSpline';

/** 射线起点比车高多少（车可能已经陷进路面一点，往上挪一段再往下打） */
const RAY_UP = 3;
/** 射线最多往下探多少。超过就算脚下没路 = 掉出赛道了 */
const RAY_DOWN = 6;

/**
 * 地形查询。
 *
 * 这里**只**用 rapier 的 raycast：赛道注册成一个静态 trimesh collider，
 * 每帧从车身中心往下打一条射线，拿接触点高度和地面法线。
 * 车本身没有刚体，也没用车辆控制器 —— 车的运动全在 kartStep 那个纯函数里，
 * rapier 在这套里就是一个"射线加速结构"。
 *
 * 坑：castRay 走的是 broad phase 的加速结构，而那个结构是在 world.step() 里建的。
 * 建完 collider 不 step 一次的话，**每一条射线都会 MISS**（实测），
 * 于是车会一直判定为掉出赛道。所以下面 create() 里有一次且仅有一次 step。
 */
export class PhysicsSystem {
  private readonly world: RAPIER.World;
  private readonly ray: RAPIER.Ray;
  private readonly progress: TrackProgress = {
    t: 0,
    lateral: 0,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    heading: 0,
  };
  /** 复用的结果对象，避免每帧新建 */
  private readonly sampleOut: GroundSample = {
    onTrack: true,
    height: 0,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    progress: 0,
    lateral: 0,
    halfWidth: 0,
    toCenterX: 0,
    toCenterZ: 0,
    respawnX: 0,
    respawnY: 0,
    respawnZ: 0,
    respawnHeading: 0,
  };
  private readonly halfWidth: number;
  /** 重生点查询的复用向量 */
  private readonly respawnPoint = new THREE.Vector3();

  private constructor(
    private readonly spline: TrackSpline,
    collision: TrackCollision,
    cfg: Readonly<TrackConfig>,
  ) {
    this.halfWidth = drivableHalfWidth(cfg);
    // 重力给 0：这个 world 里没有任何会动的东西，step 只是为了建加速结构
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(collision.vertices, collision.indices));
    this.world.step();
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  /** rapier 是 wasm，用之前必须 await 一次 init。 */
  static async create(
    spline: TrackSpline,
    collision: TrackCollision,
    cfg: Readonly<TrackConfig> = DEFAULT_TRACK_CONFIG,
  ): Promise<PhysicsSystem> {
    await RAPIER.init();
    return new PhysicsSystem(spline, collision, cfg);
  }

  /**
   * 探一次地面。结果直接喂给 stepKart。
   * @param y 当前车高。射线从 y + RAY_UP 往下打，所以车沉下去一点也能打到
   * @param respawnT 指定重生点在样条上的位置（RaceProgress.getLastCheckpoint().t）。
   *   不传就退回"最近的样条点"。之所以要能指定：从赛道外面横着摔出去时，
   *   最近样条点可能落在赛道**另一段**上，那等于摔一跤白送一大截近道。
   */
  sample(x: number, y: number, z: number, respawnT?: number): GroundSample {
    const out = this.sampleOut;

    this.ray.origin.x = x;
    this.ray.origin.y = y + RAY_UP;
    this.ray.origin.z = z;
    const hit = this.world.castRayAndGetNormal(this.ray, RAY_UP + RAY_DOWN, true);

    out.onTrack = hit !== null;
    if (hit) {
      out.height = this.ray.origin.y - hit.timeOfImpact;
      // 从下面穿上来的时候法线是朝下的，翻过来，不然车身姿态会倒过来
      const flip = hit.normal.y < 0 ? -1 : 1;
      out.normalX = hit.normal.x * flip;
      out.normalY = hit.normal.y * flip;
      out.normalZ = hit.normal.z * flip;
    } else {
      out.height = 0;
      out.normalX = 0;
      out.normalY = 1;
      out.normalZ = 0;
    }

    const p = this.spline.getProgress(x, z, this.progress);
    out.progress = p.t;
    out.lateral = p.lateral;
    out.halfWidth = this.halfWidth;

    // 指向中心线的水平方向。用 heading 推出来的"右"取反，
    // 直接拿 (center - pos) 归一化的话，人贴在中心线上时会除以 0
    const sign = p.lateral > 0 ? -1 : 1;
    out.toCenterX = Math.sin(p.heading - Math.PI / 2) * sign;
    out.toCenterZ = Math.cos(p.heading - Math.PI / 2) * sign;

    if (respawnT === undefined) {
      out.respawnX = p.centerX;
      out.respawnY = p.centerY;
      out.respawnZ = p.centerZ;
      out.respawnHeading = p.heading;
    } else {
      // getPointAt 写的是自己的 target，不碰 spline 内部的 tmp；getHeadingAt 才用 tmpA，
      // 所以必须先取点再取朝向（上面的 getProgress 已经把要用的值拷出来了）
      const rp = this.spline.getPointAt(respawnT, this.respawnPoint);
      out.respawnX = rp.x;
      out.respawnY = rp.y;
      out.respawnZ = rp.z;
      out.respawnHeading = this.spline.getHeadingAt(respawnT);
    }
    return out;
  }
}
