import * as THREE from 'three';
import type { EnvUniforms } from '../../../game/Contracts';
import { Parts, box, extrude } from './geo';
import { nightGlow } from './mats';
import { textTex, CJK_SERIF } from './tex';

const plaqueMats = new WeakMap<EnvUniforms, Map<string, THREE.Material>>();

/** 匾额 material: blue board, gilt frame, vertical gilt characters. */
export function plaqueMaterial(env: EnvUniforms, text: string): THREE.Material {
  let m = plaqueMats.get(env);
  if (!m) { m = new Map(); plaqueMats.set(env, m); }
  let mat = m.get(text);
  if (!mat) {
    const tex = textTex('plaque.' + text, 128, 256, (g, w, h) => {
      g.fillStyle = '#c9a045'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#7d5a1c'; g.fillRect(8, 8, w - 16, h - 16);
      g.fillStyle = '#d8b25a'; g.fillRect(14, 14, w - 28, h - 28);
      g.fillStyle = '#1f3a6e'; g.fillRect(20, 20, w - 40, h - 40);
      g.fillStyle = '#f0c75a'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const n = text.length, fs = Math.min((h - 60) / n, w - 50);
      g.font = `700 ${fs}px ${CJK_SERIF}`;
      for (let i = 0; i < n; i++) g.fillText(text[i], w / 2, 30 + (i + 0.5) * (h - 60) / n);
    });
    mat = nightGlow(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.2 }), env, 'flood', '#ffd8a8');
    m.set(text, mat);
  }
  return mat;
}

/** A plaque facing +z at (x, y, z), w x h. Material key must be registered by the caller. */
export function plaque(P: Parts, key: string, x: number, y: number, z: number, w: number, h: number): void {
  P.get(key).poly([[x - w / 2, y - h / 2, z], [x + w / 2, y - h / 2, z], [x + w / 2, y + h / 2, z], [x - w / 2, y + h / 2, z]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  box(P.get('gold'), x, y, z - 0.08, w + 0.2, h + 0.2, 0.14, { faces: 'xXzZYy' });
}

/** Semicircular hood moulding (the 1915 white arches over arrow windows), in the local +z face plane. */
export function archHood(P: Parts, key: string, x: number, y: number, z: number, r: number, depth = 0.3): void {
  const s = new THREE.Shape();
  s.absarc(0, 0, r, 0, Math.PI, false);
  s.lineTo(-r * 0.78, 0);
  s.absarc(0, 0, r * 0.78, Math.PI, 0, true);
  s.closePath();
  extrude(P.get(key), s, depth, new THREE.Matrix4().makeTranslation(x, y, z + depth / 2), 8);
}
