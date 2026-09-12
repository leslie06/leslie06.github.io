import type { Engine } from '../core/Engine';
import { registerPose } from '../debug/PoseRegistry';
import type { UiApi } from '.';
import type { RenderSystem } from '../render/RenderSystem';

/** The title screen in the city: the attract drive along Chang'an Avenue, 10 s in. */
export function registerTitlePose(): void {
  registerPose({
    name: 'city_title', description: 'Title screen over the city attract drive (10 s in), menu visible.',
    async apply(e: Engine) {
      // Poses share one page, so an earlier night pose leaves its clock behind.
      const r = e.get<RenderSystem>('render');
      if (r) { r.timeOfDay = r.defaultTime; r.settle(); }
      e.get<UiApi>('ui')!.showTitle();
      for (let i = 0; i < 9 * 60; i++) e.stepFixed(1 / 60);
      for (let i = 0; i < 60; i++) e.tick(1 / 60);
    },
  });
}
