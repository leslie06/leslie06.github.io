# GUNFIGHT — three.js first-person shooter

Target: visual and gameplay quality that holds up next to a current Call of Duty title. Everything is judged by screenshots from `npm run shot`.

## Stack
- Vite 8 + TypeScript (strict), three r185, @dimforge/rapier3d-compat 0.20 (physics), pmndrs `postprocessing` 6.39.
- Dev server: `npx vite --port 5180` (usually already running at http://127.0.0.1:5180). Typecheck: `npx tsc --noEmit`.
- Assets: CC0 Polyhaven PBR sets in `public/textures/<name>/` (diffuse/normal/rough/ao/disp/arm, some metal) and HDRIs in `public/hdri/`. Fetch more with `node scripts/fetch-assets.mjs` (edit the list). Load via `engine.assets.pbr(name, {repeat})` / `engine.assets.hdri(name)`.
- No external CDN/script loads at runtime. npm packages are fine (`npm install --no-audit --no-fund <pkg>`).

## Architecture (src/)
- `core/Engine.ts` — renderer, `scene` + `camera` (world), `viewmodelScene` + `viewmodelCamera` (first-person weapon, drawn after a depth clear so it never clips), fixed 60Hz `fixedUpdate` + per-frame `update(dt, alpha)`. Systems register with `engine.add(system)`; look others up with `engine.get<Api>('name')`. `engine.events` is the typed bus (`core/Events.ts`).
- `core/Physics.ts` — Rapier world. Collision groups in `CG`; tag colliders with `physics.tag(collider, {surface, enemyId, bodyPart})` so raycast hits know what they hit. `physics.raycast(...)`.
- `core/Quality.ts` — every tunable quality number. Never hardcode shadow sizes, particle counts, pixel ratios elsewhere.
- `game/Contracts.ts` — the ONLY cross-module interfaces. Extend additively. Do not import another module's internals.
- One folder per module, each with `index.ts` exporting `install(engine)`; `main.ts` calls them in boot order (render → world → player → weapons → enemies → fx → audio → ui → game). A module may only `engine.get` modules earlier in the boot order during install; at runtime anything goes.
- `debug/Poses.ts` — register named camera/game states with `registerPose`. `scripts/shot.mjs` renders every pose headlessly (GPU-backed Chromium) to PNGs: `node scripts/shot.mjs --out shots --poses all` (or `--poses a,b`). Add `--hud` to include DOM UI. Read the PNGs to judge your work; nobody else will.
- Shot mode (`?shot=1`) ticks the engine manually at a fixed dt for deterministic frames; use `engine.time` / seeded `Rng` (`core/Rng.ts`) rather than `Date.now()` / `Math.random()` in anything that affects visuals.

## Conventions
- Physics/gameplay in `fixedUpdate`, visuals in `update`. Interpolate with `alpha` for anything the camera is attached to.
- Instanced meshes for anything repeated; particle pools = one draw call per pool; no per-frame allocations in hot paths.
- Materials: MeshStandardMaterial/MeshPhysicalMaterial with real PBR maps; set `aoMap` (needs uv2 = uv), `normalScale`, `roughness`. Scene is HDR with ACES tone mapping in PostFx — light intensities are physical-ish (sun ~3, emissives >1 for bloom).
- Custom ShaderMaterials that should receive fog must merge `THREE.UniformsLib.fog`.
- All UI is DOM (not drawn on canvas), colors/fonts from `ui/theme.ts` tokens.
- Audio is Web Audio synthesis (no audio files); AudioContext must be unlocked synchronously inside a user gesture.
- Keep every file compiling at all times: other people are running `npm run shot` against the same dev server. Write complete files; run `npx tsc --noEmit` before you stop. Never edit files owned by another module.

## Ownership
- render/ (sky, lighting, shadows, post-fx, color grading) · world/ (level geometry, materials, props, nav graph) · player/ (controller, camera feel) · weapons/ (viewmodels, animation, ballistics, muzzle) · enemies/ (character rig, animation, AI, ragdoll) · fx/ (particles, decals, tracers, explosions, dynamic lights) · audio/ · ui/ · game/ (modes, spawn director, scoring).
- `core/`, `main.ts`, `game/Contracts.ts` are shared: propose changes by adding to Contracts additively; don't restructure.
