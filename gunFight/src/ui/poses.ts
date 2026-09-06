/**
 * Screenshot poses for the UI. Every one fakes its state through Hud.debug so it renders the same
 * regardless of which other modules exist, and freezes animations at a chosen time so the
 * capture is deterministic.
 */
import type { Engine } from '../core/Engine';
import type { LevelApi, PlayerApi, WeaponState } from '../game/Contracts';
import { registerPose } from '../debug/Poses';
import type { Hud } from './Hud';
import type { HudOverride } from './HudState';

const M4: WeaponState = { id: 'm4', name: 'M4A1', ammoInMag: 6, magSize: 30, reserveAmmo: 120, reloading: false, aiming: false, aimBlend: 0, spread: 0.028, firing: true, kind: 'rifle', fireMode: 'auto' };
const SPAS: WeaponState = { id: 'spas', name: 'SPAS-12', ammoInMag: 8, magSize: 8, reserveAmmo: 32, reloading: false, aiming: false, aimBlend: 0, spread: 0.06, firing: false, kind: 'shotgun', fireMode: 'pump' };
const M1911: WeaponState = { id: 'm1911', name: 'M1911', ammoInMag: 7, magSize: 7, reserveAmmo: 42, reloading: false, aiming: false, aimBlend: 0, spread: 0.02, firing: false, kind: 'pistol', fireMode: 'semi' };

function combatState(engine: Engine): HudOverride {
  const level = engine.get<LevelApi>('level');
  // Read the *real* camera back rather than faking coordinates: the minimap, the compass heading
  // and the enemy diamonds are all derived from these, so a hard-coded position put the map, the
  // bearings and the frame out of sync with each other.
  const pl = engine.get<PlayerApi>('player');
  const px = pl?.position.x ?? 0, pz = pl?.position.z ?? 20, yaw = pl?.yaw ?? 0.35;
  return {
    weapon: M4, slots: [M4, SPAS, M1911],
    player: { x: px, y: 1, z: pz, yaw, pitch: -0.05, health: 64, maxHealth: 100, alive: true, sprinting: false, aiming: false },
    game: { wave: 3, kills: 12, score: 4250, running: true, grenades: 2, remaining: 4, interact: '[E] RESUPPLY' },
    enemies: [
      { id: 1, x: px - 14, z: pz - 22, alive: true }, { id: 2, x: px + 9, z: pz - 30, alive: true },
      { id: 3, x: px + 26, z: pz - 12, alive: true }, { id: 4, x: px - 30, z: pz + 6, alive: true },
    ],
    level, fakeMap: !level || level.navPoints.length === 0,
  };
}

/**
 * Park the camera on a lit hero angle. Menus blur whatever is behind them and blurring a flat
 * shadowed frame is what made them read as dead grey; the combat HUD needs it for a different
 * reason — respawn drops the player wherever the spawn point happens to be, which last round was
 * a wall 1.5 m from the lens, and a HUD is judged against what it has to stay legible over.
 */
function heroCamera(engine: Engine, pitch = 0.09): void {
  const level = engine.get<LevelApi>('level');
  const lm = level?.landmarks?.street ?? level?.landmarks?.intersection;
  const player = engine.get<PlayerApi>('player');
  if (lm && player) player.teleport(lm.position.clone(), lm.yaw, pitch);
  // Settle: respawn re-draws the weapon, so a 1-frame settle captured the gun mid-raise.
  for (let i = 0; i < 26; i++) engine.tick(1 / 60);
}

export function registerUiPoses(engine: Engine, hud: Hud): void {
  // Order matters: the hero camera has to settle BEFORE stampPose(), because Hud auto-clears a
  // pose override 28 frames after the stamp. Settling first and stamping second cost a whole
  // capture the first time round - the HUD reverted to the live game's zeros mid-pose.
  const setup = (fn: () => void, pitch?: number) => () => {
    hud.debug.reset();
    heroCamera(engine, pitch);
    hud.debug.stampPose();
    fn();
  };

  registerPose({
    name: 'ui_hud_combat', description: 'Full combat HUD: hitmarker, damage arc, killfeed, score popup, wave banner mid-sweep', settleFrames: 8,
    apply: setup(() => {
      const st = combatState(engine);
      hud.debug.override(st);
      hud.debug.screen('none');
      engine.tick(1 / 60); // one frame so components lay out before the one-shots fire
      hud.debug.hitmarker({ headshot: true, kill: true });
      hud.debug.damage([-9, 1, 34]);
      hud.debug.kill(false, 1, M4);
      hud.debug.kill(true, 2, M4);
      hud.debug.wave(3);
      hud.debug.enemyFired(1, -14, -2);
      hud.debug.enemyFired(2, 9, -10);
      hud.debug.switchPopup(st.slots!, M4);
      hud.debug.freeze(320);
    }),
  });

  registerPose({
    name: 'ui_menu', description: 'Main menu over the live scene', settleFrames: 8,
    apply: setup(() => { hud.debug.screen('menu'); hud.debug.freeze(300); }),
  });

  registerPose({
    name: 'ui_pause', description: 'Pause screen', settleFrames: 8,
    apply: setup(() => { hud.debug.pauseInfo(3, 12); hud.debug.screen('pause'); hud.debug.freeze(300); }),
  });

  registerPose({
    name: 'ui_death', description: 'KIA screen with stats and deploy countdown', settleFrames: 8,
    apply: setup(() => {
      hud.debug.deadStats({ kills: 12, wave: 3, score: 4250, streak: 4 });
      hud.debug.screen('dead');
      hud.debug.countdown(2);
      hud.debug.freeze(320);
    }),
  });

  registerPose({
    name: 'ui_controls', description: 'Controls screen', settleFrames: 8,
    apply: setup(() => { hud.debug.screen('controls'); hud.debug.freeze(300); }),
  });

  registerPose({
    name: 'ui_settings', description: 'Settings screen', settleFrames: 8,
    apply: setup(() => { hud.debug.screen('settings'); hud.debug.freeze(300); }),
  });
}
