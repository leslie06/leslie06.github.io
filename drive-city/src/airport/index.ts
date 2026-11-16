import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { AIRPORT_BOX, loadAirfield, type AirfieldData } from './Data';
import { buildMarks } from './Marks';

/**
 * 首都机场（2026-11-16，设计见 docs/airport-design.md，第一批）：地面（跑道、滑行道、机坪、场内草地）、围界、航站楼的体块
 * 都在城市地块里（scripts/city/airfield.mjs）；这里是地块以外的东西。现在只有跑道和滑行道上的漆；第二批起加灯光、
 * 停着的飞机、起降的飞机。
 *
 * airfield.json 等镜头进到机场 `LOAD_R` 以内才取。漆只画在地块加载范围以内（再远处地上还没有跑道，漆会浮在空地上）。
 * `?airport=0` 关掉。
 */
export interface AirportApi extends System {
  readonly data: AirfieldData | null;
  /** 现在就取（probe、要去机场的任务）。 */
  load(): Promise<void>;
}

const LOAD_R = 3000;

export function install(engine: Engine): void {
  if (new URLSearchParams(location.search).get('airport') === '0') return;
  let data: AirfieldData | null = null;
  let loading: Promise<void> | null = null;
  const group = new THREE.Group();
  group.name = 'airport';
  const cells: THREE.Mesh[] = [];
  // 漆只在地块范围以内：片元离镜头（水平）超过 uFar 就丢掉
  const uFar = { value: engine.quality.tileRadius * 256 };
  const prepare = (o: THREE.Object3D) => (engine.get('render') as unknown as { prepare?(o: THREE.Object3D): void } | undefined)?.prepare?.(o);

  const build = (d: AirfieldData) => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 });
    mat.userData.wet = 'surface';
    mat.polygonOffset = true; mat.polygonOffsetFactor = -6; mat.polygonOffsetUnits = -6;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uFar = uFar;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vAirXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAirXZ = (modelMatrix * vec4(position, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vAirXZ;\nuniform float uFar;')
        .replace('void main() {', 'void main() {\n  if (distance(vAirXZ, cameraPosition.xz) > uFar) discard;');
    };
    mat.customProgramCacheKey = () => 'airport-marks';
    // 一公里一块（视锥剔除）；跑道最高一层地面在 1.6 厘米（city/Areas.ts），路面在 3 厘米
    for (const geo of buildMarks(d)) {
      const marks = new THREE.Mesh(geo, mat);
      marks.name = 'airport-marks';
      marks.position.y = 0.022;
      marks.receiveShadow = true;
      group.add(marks);
      cells.push(marks);
    }
    prepare(group);
    engine.scene.add(group);
  };

  const load = (): Promise<void> => {
    loading ??= loadAirfield().then((d) => { data = d; build(d); }).catch((e) => { console.warn('[airport] did not load', e); loading = null; });
    return loading;
  };

  const api: AirportApi = {
    name: 'airport',
    get data() { return data; },
    load,
    update() {
      const c = engine.camera.position;
      if (!loading) {
        const dx = Math.max(AIRPORT_BOX.x0 - c.x, 0, c.x - AIRPORT_BOX.x1), dz = Math.max(AIRPORT_BOX.z0 - c.z, 0, c.z - AIRPORT_BOX.z1);
        if (Math.hypot(dx, dz) < LOAD_R) void load();
      }
      uFar.value = engine.quality.tileRadius * 256;
      // 整块都在加载范围以外的不画
      for (const m of cells) {
        const b = m.geometry.boundingSphere!;
        m.visible = Math.hypot(b.center.x - c.x, b.center.z - c.z) < uFar.value + b.radius;
      }
    },
  };
  engine.add(api);
}
