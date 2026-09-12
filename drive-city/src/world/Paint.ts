import * as THREE from 'three';

/**
 * Road paint as flat geometry laid a hair above the ground: straight lines, dashes, arcs and boxes,
 * collected into one mesh per colour (one draw call each).
 */
export class PaintBuilder {
  private pos: number[] = [];
  private uv: number[] = [];
  private idx: number[] = [];

  private quad(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): void {
    const i = this.pos.length / 3;
    this.pos.push(ax, 0, az, bx, 0, bz, cx, 0, cz, dx, 0, dz);
    this.uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    // Counter-clockwise seen from above (+Y), so the paint faces up.
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  line(x0: number, z0: number, x1: number, z1: number, w: number): this {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz) || 1;
    const nx = -dz / L * w / 2, nz = dx / L * w / 2;
    this.quad(x0 + nx, z0 + nz, x1 + nx, z1 + nz, x1 - nx, z1 - nz, x0 - nx, z0 - nz);
    return this;
  }

  dashed(x0: number, z0: number, x1: number, z1: number, w: number, dash: number, gap: number): this {
    const L = Math.hypot(x1 - x0, z1 - z0);
    for (let s = 0; s < L; s += dash + gap) {
      const e = Math.min(L, s + dash);
      this.line(x0 + (x1 - x0) * s / L, z0 + (z1 - z0) * s / L, x0 + (x1 - x0) * e / L, z0 + (z1 - z0) * e / L, w);
    }
    return this;
  }

  /** Ring strip from angle a0 to a1 (radians, measured from +X towards +Z). */
  arc(cx: number, cz: number, r: number, a0: number, a1: number, w: number, dash = 0, gap = 0): this {
    const segs = Math.max(8, Math.ceil(Math.abs(a1 - a0) * r / 1.5));
    const ri = r - w / 2, ro = r + w / 2;
    for (let k = 0; k < segs; k++) {
      const t0 = a0 + (a1 - a0) * k / segs, t1 = a0 + (a1 - a0) * (k + 1) / segs;
      if (dash > 0) {
        const s = (k / segs) * Math.abs(a1 - a0) * r;
        if (s % (dash + gap) > dash) continue;
      }
      const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      this.quad(cx + ri * c0, cz + ri * s0, cx + ri * c1, cz + ri * s1, cx + ro * c1, cz + ro * s1, cx + ro * c0, cz + ro * s0);
    }
    return this;
  }

  /** Outline of a rectangle centred on (x, z), rotated by yaw. */
  box(x: number, z: number, w: number, d: number, lw: number, yaw = 0, openSide = -1): this {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const p = (u: number, v: number): [number, number] => [x + u * c + v * s, z - u * s + v * c];
    const pts = [p(-w / 2, -d / 2), p(w / 2, -d / 2), p(w / 2, d / 2), p(-w / 2, d / 2)];
    for (let k = 0; k < 4; k++) {
      if (k === openSide) continue;
      const a = pts[k], b = pts[(k + 1) % 4];
      this.line(a[0], a[1], b[0], b[1], lw);
    }
    return this;
  }

  build(material: THREE.Material, y = 0.012): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setIndex(this.idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, material);
    m.position.y = y;
    m.receiveShadow = true;
    return m;
  }
}

export function paintMaterial(color: string): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.userData.wet = 'ground';
  return m;
}
