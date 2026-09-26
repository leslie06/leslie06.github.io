import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Cruising height over the street, and how far above a roof it keeps. */
const ALT = 58, ROOF_CLEAR = 26;
/** m/s. */
const TOP = 44;
/** A police helicopter sees this far (3-D, and only with nothing solid in between). */
export const HELI_SIGHT = 170;

const tint = (g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry => {
  const geo = g.index ? g.toNonIndexed() : g, n = geo.getAttribute('position').count, c = new THREE.Color(hex);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  return geo;
};

/** A soft round spot for the searchlight's pool on the ground. */
function spotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!, gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The police helicopter (three stars and up): a white-and-blue light helicopter that flies over the
 * chase, keeps the player in its searchlight, and while it can see them the police always know
 * where they are - it is what makes a big chase hard to shake. Out of sight it circles the search
 * area sweeping the light. Kinematic, no collider: it holds ROOF_CLEAR over whatever is below it.
 * Always in the scene (hidden when off duty) so it never recompiles a material mid-chase.
 */
export class PoliceHeli {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3(0, -500, 0);
  readonly vel = new THREE.Vector3();
  active = false;
  /** Sees the player right now (set by police/). */
  sees = false;
  private body = new THREE.Group();
  private rotor: THREE.Mesh;
  private disc: THREE.Mesh;
  private tail: THREE.Mesh;
  private beam: THREE.Mesh;
  private pool: THREE.Mesh;
  private beamMat: THREE.ShaderMaterial;
  private poolMat: THREE.MeshBasicMaterial;
  private beaconR: THREE.MeshBasicMaterial;
  private beaconB: THREE.MeshBasicMaterial;
  private yaw = 0;
  private spin = 0;
  private orbit = 0;
  private floor = 0;
  private floorT = 0;
  private leaving = false;
  /** Where the light points (smoothed). */
  readonly aim = new THREE.Vector3();
  private sweep = 0;
  private _d = new THREE.Vector3();
  private _v = new THREE.Vector3();
  private _q = new THREE.Quaternion();
  private _e = new THREE.Euler();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    const hull = mergeGeometries([
      tint(new THREE.SphereGeometry(1, 20, 14).scale(1.15, 1.05, 2.1).translate(0, 1.35, 0.3), '#f2f3f1'),
      tint(new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45).scale(1.17, 1.07, 2.12).translate(0, 1.35, 0.3), '#1c47a8'),
      tint(new THREE.CylinderGeometry(0.16, 0.34, 5.2, 10).rotateX(Math.PI / 2).translate(0, 1.75, -3.6), '#f2f3f1'),
      tint(new THREE.BoxGeometry(0.12, 1.3, 0.9).translate(0, 2.3, -6.0), '#1c47a8'),
      tint(new THREE.BoxGeometry(1.5, 0.08, 0.5).translate(0, 1.75, -5.4), '#1c47a8'),
      tint(new THREE.CylinderGeometry(0.5, 0.6, 0.45, 12).translate(0, 2.55, 0), '#2a2d31'),
      tint(new THREE.CylinderGeometry(0.07, 0.07, 3.0, 6).rotateX(Math.PI / 2).translate(0.85, 0.12, 0.2), '#2a2d31'),
      tint(new THREE.CylinderGeometry(0.07, 0.07, 3.0, 6).rotateX(Math.PI / 2).translate(-0.85, 0.12, 0.2), '#2a2d31'),
      tint(new THREE.BoxGeometry(0.06, 0.55, 0.06).rotateZ(-0.35).translate(0.72, 0.42, 0.9), '#2a2d31'),
      tint(new THREE.BoxGeometry(0.06, 0.55, 0.06).rotateZ(0.35).translate(-0.72, 0.42, 0.9), '#2a2d31'),
      tint(new THREE.BoxGeometry(0.06, 0.55, 0.06).rotateZ(-0.35).translate(0.72, 0.42, -0.6), '#2a2d31'),
      tint(new THREE.BoxGeometry(0.06, 0.55, 0.06).rotateZ(0.35).translate(-0.72, 0.42, -0.6), '#2a2d31'),
      // The searchlight pod under the nose.
      tint(new THREE.CylinderGeometry(0.2, 0.2, 0.4, 10).rotateX(Math.PI / 2).translate(0, 0.35, 1.9), '#2a2d31'),
    ])!;
    const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.2 });
    const hullMesh = new THREE.Mesh(hull, paint);
    hullMesh.castShadow = true;
    const glass = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.18, Math.PI * 0.42).scale(1.18, 1.08, 2.14).translate(0, 1.35, 0.32),
      new THREE.MeshStandardMaterial({ color: '#0d1a24', roughness: 0.08, metalness: 0.6 }));
    const dark = new THREE.MeshStandardMaterial({ color: '#1b1d20', roughness: 0.6 });
    // Four blades, and a faint disc for the blur they make at speed.
    this.rotor = new THREE.Mesh(mergeGeometries([new THREE.BoxGeometry(10.4, 0.05, 0.3), new THREE.BoxGeometry(0.3, 0.05, 10.4)])!, dark);
    this.rotor.position.set(0, 2.85, 0);
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(5.2, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#202326', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
    this.disc.position.set(0, 2.84, 0);
    this.tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.5, 0.16), dark);
    this.tail.position.set(0.12, 2.3, -6.05);
    this.beaconR = new THREE.MeshBasicMaterial({ color: '#ff2020' });
    this.beaconB = new THREE.MeshBasicMaterial({ color: '#2050ff' });
    const bR = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), this.beaconR); bR.position.set(0.3, 0.4, -1.2);
    const bB = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), this.beaconB); bB.position.set(-0.3, 0.4, -1.2);
    this.body.add(hullMesh, glass, this.rotor, this.disc, this.tail, bR, bB);
    this.group.add(this.body);

    // The beam: an open cone, apex at the pod, fading along its length (vertex alpha via colour).
    const cone = new THREE.CylinderGeometry(0.2, 1, 1, 24, 1, true).translate(0, -0.5, 0);
    const pos = cone.getAttribute('position'), col = new Float32Array(pos.count * 3);
    // Bright at the lamp, gone by the far end: the beam stops short of the ground (the pool lights
    // that), or a camera near the target sits inside its additive glow and the whole frame washes out.
    for (let i = 0; i < pos.count; i++) { const k = Math.pow(1 + pos.getY(i), 1.6); col.set([k, k, k * 0.95], i * 3); }
    cone.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // Soft edges: the cone's walls glow where they face the camera and fade at its silhouette, so it
    // reads as a shaft of light in the haze, not a flat wedge.
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color('#fff6dc') }, uOpacity: { value: 0.1 } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying float vK; attribute vec3 color;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vK = color.r; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec3 vN; varying vec3 vV; varying float vK;
        void main() { float f = abs(dot(normalize(vN), normalize(vV))); gl_FragColor = vec4(uColor, uOpacity * vK * f * f); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.beam = new THREE.Mesh(cone, this.beamMat);
    this.beam.frustumCulled = false;
    this.poolMat = new THREE.MeshBasicMaterial({ map: spotTexture(), color: '#fff3d6', transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4 });
    this.pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.poolMat);
    this.pool.frustumCulled = false;
    this.group.add(this.beam, this.pool);
    this.group.visible = false;
    this.group.name = 'police-heli';
    scene.add(this.group);
  }

  /** Come in from `dist` metres behind (x, z) along (hx, hz). */
  spawn(x: number, z: number, hx: number, hz: number, dist = 380): void {
    const h = Math.hypot(hx, hz) || 1;
    this.pos.set(x - hx / h * dist, ALT + 20, z - hz / h * dist);
    this.vel.set(hx / h * TOP * 0.8, 0, hz / h * TOP * 0.8);
    this.yaw = Math.atan2(hx, hz);
    this.aim.set(x, 0, z);
    this.orbit = Math.atan2(-hx, -hz);
    this.active = true; this.leaving = false; this.sees = false;
    this.group.visible = true;
  }

  /** Fly off and vanish (`done` once it is gone). */
  leave(): void { if (this.active) this.leaving = true; }

  despawn(): void { this.active = false; this.leaving = false; this.sees = false; this.group.visible = false; this.pos.set(0, -500, 0); }

  /**
   * One fixed step. `roof(x, z)`: height of whatever stands there (a ray, asked a few times a
   * second). Tracking: hold station off the target's shoulder, orbiting slowly, the light on it.
   * Searching: circle (cx, cz) at radius r, the light sweeping the ground ahead of the orbit.
   */
  step(dt: number, track: boolean, tx: number, ty: number, tz: number, tvx: number, tvz: number, r: number, roof: (x: number, z: number) => number): boolean {
    if (!this.active) return false;
    const d = this._d, v = this._v;
    if (this.leaving) {
      v.set(this.vel.x, 0, this.vel.z);
      if (v.lengthSq() < 1) v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      v.normalize().multiplyScalar(TOP); v.y = 6;
      if (Math.hypot(this.pos.x - tx, this.pos.z - tz) > 520) { this.despawn(); return false; }
    } else {
      this.orbit += dt * (track ? 0.12 : 0.22);
      const R = track ? 30 : Math.max(40, r * 0.55);
      const lead = track ? 1.6 : 0;
      d.set(tx + tvx * lead + Math.sin(this.orbit) * R, 0, tz + tvz * lead + Math.cos(this.orbit) * R);
      this.floorT -= dt;
      if (this.floorT <= 0) { this.floorT = 0.3; this.floor = Math.max(roof(this.pos.x + this.vel.x * 2, this.pos.z + this.vel.z * 2), roof(d.x, d.z)); }
      d.y = Math.max(ALT + ty, this.floor + ROOF_CLEAR);
      v.subVectors(d, this.pos).multiplyScalar(0.7);
      if (track) { v.x += tvx; v.z += tvz; }
      const s = Math.hypot(v.x, v.z);
      if (s > TOP) { v.x *= TOP / s; v.z *= TOP / s; }
      v.y = Math.max(-8, Math.min(12, v.y));
    }
    this.vel.lerp(v, Math.min(1, dt * 1.1));
    this.pos.addScaledVector(this.vel, dt);
    // The light: on the target while tracking, sweeping a figure of eight round the circle's centre otherwise.
    this.sweep += dt;
    if (track) d.set(tx, ty, tz);
    else d.set(tx + Math.sin(this.sweep * 0.37) * r * 0.6, ty, tz + Math.sin(this.sweep * 0.74) * r * 0.45);
    this.aim.lerp(d, Math.min(1, dt * (track ? 5 : 1.2)));
    return true;
  }

  /** Draw: `alpha`-free (it moves slowly next to the frame rate), `night` 0..1, `time` for the rotor and beacons. */
  render(dt: number, night: number, time: number): void {
    if (!this.active) { this.group.visible = false; return; }
    this.group.visible = true;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 3) {
      const want = Math.atan2(this.vel.x, this.vel.z);
      let dy = want - this.yaw; dy -= Math.round(dy / (Math.PI * 2)) * Math.PI * 2;
      this.yaw += dy * Math.min(1, dt * 1.5);
    }
    // Nose down with speed, a bank into the orbit.
    this._e.set(Math.min(0.28, sp * 0.007), this.yaw, -0.12 * Math.min(1, sp / 20), 'YXZ');
    this.body.position.copy(this.pos);
    this.body.quaternion.setFromEuler(this._e);
    this.spin += dt * 42;
    this.rotor.rotation.y = this.spin;
    this.tail.rotation.x = this.spin * 2.3;
    const ph = (time * 1.7) % 1;
    this.beaconR.color.setRGB(ph < 0.12 ? 6 : 0.25, 0.02, 0.02);
    this.beaconB.color.setRGB(0.02, 0.05, ph > 0.5 && ph < 0.62 ? 6 : 0.25);
    // Beam from the pod to the aim point.
    const pod = this._d.set(0, 0.35, 1.9).applyQuaternion(this.body.quaternion).add(this.pos);
    const to = this._v.subVectors(this.aim, pod);
    const len = to.length();
    const spread = 0.085;
    this.beam.position.copy(pod);
    this.beam.quaternion.copy(this._q.setFromUnitVectors(PoliceHeli.UP, to.divideScalar(-len || 1)));
    const bl = Math.max(1, len - 14);
    this.beam.scale.set(bl * spread, bl, bl * spread);
    const k = 0.25 + 0.75 * night;
    this.beamMat.uniforms.uOpacity.value = 0.04 + 0.22 * night;
    this.poolMat.opacity = 0.12 * k + 0.35 * night;
    this.pool.position.set(this.aim.x, this.aim.y + 0.08, this.aim.z);
    const pr = Math.max(4, len * spread * 1.2);
    this.pool.scale.set(pr * 2, 1, pr * 2);
  }
}
