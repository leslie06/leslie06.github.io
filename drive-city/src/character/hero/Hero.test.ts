import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Gait, jointMatrices } from '../Animator';
import { ANKLE_H, J, JOINT_COUNT, type Look } from '../Body';
import { Hero } from './Hero';

const DIR = path.resolve(__dirname, '../../../public/models/hero');
// three's FileLoader (used for the inlined buffer) reports progress with a browser-only event class.
(globalThis as { ProgressEvent?: unknown }).ProgressEvent ??= class extends Event { constructor(type: string, public init: object = {}) { super(type); } };

/** Parse a published glTF in Node: the buffer inlined, the textures dropped (no image decoder here). */
async function parse(name: string): Promise<THREE.Group> {
  const g = JSON.parse(fs.readFileSync(path.join(DIR, `${name}.gltf`), 'utf8'));
  g.buffers[0].uri = `data:application/octet-stream;base64,${fs.readFileSync(path.join(DIR, g.buffers[0].uri)).toString('base64')}`;
  delete g.images; delete g.textures; delete g.samplers;
  for (const m of g.materials ?? []) { delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture; if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; } }
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(g), '');
  return gltf.scene;
}

const C = (h: string) => new THREE.Color(h);
const LOOK: Look = { skin: C('#e2bd98'), shirt: C('#39424e'), pants: C('#1b2536'), shoes: C('#1a1a1a'), hair: C('#141212'), top: 'jacket', inner: C('#e8e6df'), height: 1.78 };

async function hero(): Promise<Hero> { return Hero.build(await parse('body'), await parse('hair'), LOOK); }

function boneWorld(h: Hero, name: string): THREE.Vector3 {
  h.root.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(h.root.getObjectByName(name)!.matrixWorld);
}

describe('hero model', () => {
  it('is dressed: garments built, covered skin dropped, no NaN', async () => {
    const h = await hero();
    const names: string[] = [];
    let exposed = -1, bodyTris = 0;
    h.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      names.push(m.name);
      const pos = m.geometry.getAttribute('position');
      for (const v of pos.array as Float32Array) expect(Number.isFinite(v)).toBe(true);
      if (m.name.startsWith('hero-') || pos.count < 3000) return;
      // The base body (bind pose, T-pose arms): no skin triangle may be left wholly on the trunk
      // or the legs, where the clothes are.
      const I = m.geometry.getIndex()!.array;
      bodyTris = I.length / 3;
      exposed = 0;
      for (let t = 0; t < I.length; t += 3) {
        let inside = 0;
        for (let k = 0; k < 3; k++) { const i = I[t + k]; if (Math.abs(pos.getX(i)) < 0.3 && pos.getY(i) > 0.15 && pos.getY(i) < 1.35) inside++; }
        if (inside === 3) exposed++;
      }
    });
    for (const g of ['hero-tee', 'hero-trousers', 'hero-shoes', 'hero-jacket']) expect(names).toContain(g);
    expect(bodyTris).toBeLessThan(12566 * 0.6);
    expect(exposed).toBe(0);
  });

  it('stands with its feet on the ground and its head where the crowd skeleton puts it', async () => {
    const h = await hero();
    const g = new Gait();
    for (let i = 0; i < 120; i++) g.update({ speed: 0, action: 'move', t: 0 }, 1 / 60, 0.4);
    const at = new THREE.Vector3(3, 0.5, -2);
    h.draw(at, 0.7, g);
    for (const s of ['l', 'r']) {
      const foot = boneWorld(h, `foot_${s}`);
      expect(Math.abs(foot.y - at.y - ANKLE_H * g.scale)).toBeLessThan(0.02);
    }
    const M = Array.from({ length: JOINT_COUNT }, () => new THREE.Matrix4());
    jointMatrices(at, 0.7, g, M);
    const head = new THREE.Vector3().setFromMatrixPosition(M[J.head]);
    expect(boneWorld(h, 'Head').distanceTo(head)).toBeLessThan(0.1);
  });

  it('keeps each planted foot where the gait plants it while walking and running', async () => {
    const h = await hero();
    const M = Array.from({ length: JOINT_COUNT }, () => new THREE.Matrix4());
    for (const speed of [1.4, 3.9]) {
      const g = new Gait();
      const root = new THREE.Vector3();
      let worst = 0;
      for (let i = 0; i < 180; i++) {
        root.z += speed / 60;
        g.update({ speed, action: 'move', t: 0 }, 1 / 60, 0.3);
        if (i < 60) continue;
        h.draw(root, 0, g);
        jointMatrices(root, 0, g, M);
        for (const [bone, j] of [['foot_l', J.ankleL], ['foot_r', J.ankleR]] as const) {
          const want = new THREE.Vector3().setFromMatrixPosition(M[j]);
          // The hero's hips are wider: compare along the walk and in height only.
          const got = boneWorld(h, bone);
          worst = Math.max(worst, Math.hypot(got.y - want.y, got.z - want.z));
        }
      }
      expect(worst).toBeLessThan(0.03);
    }
  });
});
