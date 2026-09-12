import type { Engine } from '../core/Engine';
import type { VehicleApi } from '../game/Contracts';
import { t } from '../core/I18n';
import { BlackBox } from './BlackBox';

/**
 * F9 (or `?diag=1`): frame time, GPU, draw calls, resolution scale, and the car's live numbers.
 * Performance problems are machine-specific; this is how a player reads them off their machine.
 */
export class Diagnostics {
  name = 'diagnostics';
  private el: HTMLDivElement;
  private acc = 0;
  readonly blackBox: BlackBox;

  constructor(private engine: Engine, container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:fixed;right:8px;top:8px;z-index:9999;padding:8px 10px;background:rgba(6,8,12,.82);color:#dfe6f2;' +
      'font:11px/1.5 ui-monospace,Menlo,monospace;white-space:pre;pointer-events:none;border-left:2px solid #f3b50f';
    this.el.hidden = !new URLSearchParams(location.search).has('diag');
    container.appendChild(this.el);
    this.blackBox = new BlackBox(engine);
    if (this.blackBox.crashed) console.warn('[drive-city] ' + this.blackBox.report());
  }

  update(dt: number): void {
    this.blackBox.update(dt);
    if (this.engine.input.state.diagPressed) this.el.hidden = !this.el.hidden;
    if (this.el.hidden) return;
    this.acc += dt;
    if (this.acc < 0.25) return;
    this.acc = 0;
    const e = this.engine, info = e.renderer.info, r = e.renderer.domElement;
    const v = e.get<VehicleApi>('vehicle');
    const car = v?.car;
    const lines = [
      t('diag.title'),
      `frame  ${e.frameMs.toFixed(1)} ms  (${(1000 / e.frameMs).toFixed(0)} fps)`,
      `gpu    ${e.gpu.renderer.slice(0, 60)} [${e.gpu.kind}]`,
      `tier   ${e.quality.tier}  buffer ${r.width}x${r.height}  scale ${e.renderScale.toFixed(2)}`,
      `calls  ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k  tex ${info.memory.textures}  geo ${info.memory.geometries}`,
    ];
    if (car) {
      lines.push(
        `speed  ${(car.forwardSpeed * 3.6).toFixed(0)} km/h  gear ${car.gear}  rpm ${car.rpm.toFixed(0)}`,
        `slip   ${(car.bodySlip * 57.3).toFixed(1)}°  yaw ${car.yawRate.toFixed(2)} rad/s  steer ${(car.steerAngle * 57.3).toFixed(1)}°`,
        `load   ${car.wheels.map((w) => (w.load / 1000).toFixed(1)).join(' ')} kN`,
        `skid   ${car.wheels.map((w) => w.skid.toFixed(2)).join(' ')}`,
      );
    }
    const crash = this.blackBox.summary();
    if (crash) lines.push(crash);
    this.el.textContent = lines.join('\n');
  }
}
