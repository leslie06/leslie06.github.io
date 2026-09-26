import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Engine } from '../../core/Engine';
import { CG, groups } from '../../core/Physics';
import type { DeadEndApi, EnvUniforms } from '../../game/Contracts';
import type { Network } from '../Data';
import type { DeadEnds } from '../DeadEnds';
import { CJK } from '../landmarks/kit/tex';

/** Face of the plate in the atlas; the rest is the grey of the post and the plate's back. */
const FACE_W = 256, FACE_H = 320, ATLAS_W = 288;
const GREY_U = (FACE_W + 16) / ATLAS_W;
/** Plate size in metres (the face's aspect), its centre height, and the post. */
const PLATE_W = 0.76, PLATE_H = 0.95, PLATE_Y = 2.35, POST_R = 0.045, POST_H = 2.85;

/**
 * The GB 5768 此路不通 sign drawn on a canvas: blue, a white stem under a red bar, the words under
 * it, and English below as on Beijing's bilingual street signs.
 */
function signAtlas(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = ATLAS_W; c.height = FACE_H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8b9197'; g.fillRect(0, 0, ATLAS_W, FACE_H);
  const round = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  };
  g.fillStyle = '#f4f6f8'; round(0, 0, FACE_W, FACE_H, 18); g.fill();
  g.fillStyle = '#1e4fa6'; round(7, 7, FACE_W - 14, FACE_H - 14, 13); g.fill();
  g.fillStyle = '#f4f6f8'; g.fillRect(FACE_W / 2 - 19, 88, 38, 118);
  g.fillStyle = '#d8262c'; g.fillRect(FACE_W / 2 - 74, 50, 148, 40);
  g.fillStyle = '#f4f6f8'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 48px ${CJK}`; g.fillText('此路不通', FACE_W / 2, 250);
  g.font = '700 19px system-ui, "Helvetica Neue", Arial, sans-serif'; g.fillText('NO THROUGH ROAD', FACE_W / 2, 291);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Post and plate as one geometry: the plate's front face takes the sign, everything else the grey. */
function signGeometry(): THREE.BufferGeometry {
  const grey = (geo: THREE.BufferGeometry, keep?: (i: number) => boolean) => {
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      if (keep?.(i)) uv.setX(i, uv.getX(i) * FACE_W / ATLAS_W);
      else uv.setXY(i, GREY_U, 0.5);
    }
    return geo;
  };
  // BoxGeometry's faces are +x, -x, +y, -y, +z, -z, four vertices each: the +z face is 16..19.
  const plate = grey(new THREE.BoxGeometry(PLATE_W, PLATE_H, 0.03), (i) => i >= 16 && i < 20)
    .translate(0, PLATE_Y, POST_R + 0.02);
  const post = grey(new THREE.CylinderGeometry(POST_R, POST_R, POST_H, 8)).translate(0, POST_H / 2, 0);
  return mergeGeometries([plate, post])!;
}

/**
 * The 此路不通 signs from `findDeadEnds`, one instanced mesh for the whole city (a few hundred
 * posts, one draw call and its shadow) and a thin fixed collider per post, like a lamp's. The face
 * glows a little at night, as retroreflective sheeting does in headlights.
 */
export function placeDeadEndSigns(engine: Engine, net: Network, dead: DeadEnds, env: EnvUniforms): DeadEndApi {
  const { signs } = dead;
  const map = signAtlas();
  const mat = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.45, metalness: 0.15 });
  mat.userData.wet = 'surface';
  const mesh = new THREE.InstancedMesh(signGeometry(), mat, Math.max(1, signs.length));
  mesh.name = 'deadend-signs';
  mesh.count = signs.length;
  mesh.castShadow = true; mesh.receiveShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const { R, world } = engine.physics;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const g = groups(CG.WORLD, CG.ALL);
  signs.forEach((s, i) => {
    mesh.setMatrixAt(i, m.compose(p.set(s.x, 0, s.z), q.setFromAxisAngle(up, s.yaw), one));
    const c = world.createCollider(R.ColliderDesc.cylinder(POST_H / 2, POST_R + 0.02).setTranslation(s.x, POST_H / 2, s.z).setCollisionGroups(g), body);
    engine.physics.tag(c, { surface: 'metal', tag: 'sign' });
  });
  mesh.computeBoundingSphere();
  engine.scene.add(mesh);
  // Heading in, per directed node pair (node indices fit in 16 bits many times over).
  const inward = new Set<number>();
  net.edges.forEach((e, i) => { const o = dead.out[i]; if (o >= 0) inward.add(o * 65536 + (o === e.a ? e.b : e.a)); });
  const sys: DeadEndApi = {
    name: 'deadEnds',
    signs,
    inward: (from, to) => inward.has(from * 65536 + to),
    update() { mat.emissiveIntensity = 0.35 * env.uNight.value; },
  };
  engine.add(sys);
  return sys;
}
