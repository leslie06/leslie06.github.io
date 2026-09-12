import * as THREE from 'three';

/** GTA-style corona at a mission point: a glowing column fading upwards and a ring on the ground. */
export class Marker {
  private readonly group = new THREE.Group();
  private readonly col: THREE.ShaderMaterial;
  private readonly ring: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.col = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color('#ffc21f') }, uTime: { value: 0 } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
        void main() {
          float a = pow(1.0 - vUv.y, 1.6) * (0.62 + 0.18 * sin(uTime * 3.0));
          a *= 0.75 + 0.25 * sin(vUv.x * 6.2832 * 12.0 - uTime * 2.0);
          gl_FragColor = vec4(uColor * a * 2.6, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const column = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 6, 48, 1, true).translate(0, 3, 0), this.col);
    column.renderOrder = 3;
    this.ring = new THREE.MeshBasicMaterial({ color: '#ffc21f', transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.85, 2.2, 64).rotateX(-Math.PI / 2), this.ring);
    ring.position.y = 0.07;
    this.group.add(column, ring);
    this.group.visible = false;
    scene.add(this.group);
  }

  show(x: number, z: number, color: string): void {
    this.group.position.set(x, 0, z);
    this.col.uniforms.uColor.value.set(color);
    this.ring.color.set(color);
    this.group.visible = true;
  }

  hide(): void { this.group.visible = false; }

  update(dt: number): void { this.col.uniforms.uTime.value += dt; }
}
