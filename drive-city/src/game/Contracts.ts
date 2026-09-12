/**
 * The only cross-module surface. Modules look each other up with `engine.get<Api>(name)` and talk
 * through these interfaces, never through each other's internals. Extend additively.
 */
import type * as THREE from 'three';
import type { Crowd } from '../character/Crowd';
import type { System } from '../core/Engine';
import type { Vehicle } from '../vehicle/Vehicle';
import type { VehicleControls } from '../vehicle/ControlFilter';
import type { CarModel } from '../vehicle/CarModel';
import type { BodyType } from '../vehicle/Bodies';
import type { PathPilot, PilotOptions } from '../vehicle/Autopilot';
import type { Props } from '../world/Props';

export interface DriftState {
  active: boolean;
  /** Points in the current, unbanked drift. */
  score: number;
  multiplier: number;
  /** Degrees, for the HUD. */
  angle: number;
  best: number;
  /** Last banked (or lost) drift, and when (engine time), for the HUD's result line. */
  last: number;
  lastAt: number;
  lastCrashed: boolean;
}

/** A car's paint: golden top + company colour for taxis, one colour for private cars. */
export interface CarLook { upper: THREE.Color; lower: THREE.Color; taxi: boolean; /** Was standing parked (not driven by anyone) when taken. */ parked?: boolean; /** Which body the car is; the player's model is rebuilt when it changes. */ body?: BodyType }

export interface VehicleApi extends System {
  /** The player's current car (drawn with the full model). Changes when the player takes another. */
  readonly car: Vehicle;
  /** The player is in the driver's seat; false while the car sits where the player left it. */
  occupied: boolean;
  /** Engine health as a throttle scale: 1 healthy, 0.55 failing, 0 dead (damage/). */
  power: number;
  readonly look: CarLook;
  /** Make `next` the player's car (recolouring the full model). Returns the previous car and its look. */
  swapCar(next: Vehicle, look: CarLook): { car: Vehicle; look: CarLook };
  readonly model: CarModel;
  readonly controls: VehicleControls;
  /** Interpolated pose the model is drawn at (use this, not the physics body, for anything visual). */
  readonly renderPos: THREE.Vector3;
  readonly renderQuat: THREE.Quaternion;
  readonly drift: DriftState;
  /** When set, drives the car instead of the player (shot poses, the title-screen attract loop). */
  autopilot: PathPilot | null;
  /** Player input reaches the car only when true (off behind menus). */
  inputEnabled: boolean;
  reset(pos?: THREE.Vector3Like, yaw?: number): void;
}

export type CameraMode = 'chase' | 'far' | 'near' | 'hood';

export interface CameraApi extends System {
  mode: CameraMode;
  shake(amount: number): void;
  /** Jump straight to the target pose (after a reset or a pose change). */
  snap(): void;
  /** While set, the rig hands the camera to this function (shot poses, title screen). */
  override: ((camera: THREE.PerspectiveCamera, dt: number) => void) | null;
}

export interface WorldApi extends System {
  readonly spawn: { x: number; y: number; z: number; yaw: number };
  /** Loose props (the driving-school yard only). */
  readonly props?: Props;
  /** What the taxi drives on the title screen: a path for the autopilot, its speed (m/s) and start. */
  readonly attract?: { path: [number, number][]; closed: boolean; speed: number; start: { x: number; z: number; yaw: number }; drift?: PilotOptions['drift'] };
  /** Street or place name at a point, for the HUD ('' if none). */
  placeName?(x: number, z: number): string;
  /** Streaming worlds: resolves once everything around (x, z) is loaded, colliders included. */
  preload?(x: number, z: number): Promise<void>;
}

/** Cars other than the player's: traffic and cars left parked. Implemented by traffic/. */
export interface TrafficCars extends System {
  nearestCar(x: number, z: number, r: number): Vehicle | null;
  /** Take a car for the player: its AI stops and the traffic renderer lets go of it. */
  takeCar(car: Vehicle): CarLook | null;
  /** Leave a car parked in the world (simulated and drawn by traffic until far away). */
  parkCar(car: Vehicle, look: CarLook): void;
}

export interface PlayerApi extends System {
  readonly mode: 'driving' | 'onfoot';
  /** Where the player is: the car, or the feet. Streaming, HUD and AI use this. */
  readonly position: THREE.Vector3;
  /** The character while on foot (feet position, velocity, facing), else null. */
  readonly foot: { pos: THREE.Vector3; vel: THREE.Vector3; yaw: number } | null;
  /** A car is within reach (the HUD shows the get-in prompt). */
  readonly nearCar: boolean;
  /** Everyone drawn as a person (player first, then pedestrians) shares this crowd. */
  readonly crowd: Crowd;
  /** Leave the car, as if F was pressed (missions, poses). */
  getOut(): void;
  /** 0..100; at 0 the player is wasted and wakes up at hospital. */
  readonly health: number;
  hurt(n: number): void;
}

// --- Navigation (nav/): routes, GPS target, minimap and map blips -------------------------------

export type BlipKind = 'police' | 'target' | 'pickup' | 'dropoff' | 'car' | 'landmark';
/** A marker on the minimap and map. `heading` (atan2(x, z)) turns it into an arrow. */
export interface Blip { kind: BlipKind; x: number; z: number; heading?: number; flash?: boolean; label?: string }
export interface NavTarget { x: number; z: number; kind: 'waypoint' | 'mission'; label?: string }

export interface NavApi extends System {
  /** Shortest legal drive (one-ways respected) from a point heading `heading` to a point: [x, z, ...] and metres. */
  route(fromX: number, fromZ: number, heading: number, toX: number, toZ: number): { pts: Float32Array; len: number } | null;
  /**
   * Set the GPS target of its kind: the player's map waypoint or a mission's target. Both are
   * kept; the GPS leads to the waypoint while there is one. null clears both.
   */
  setTarget(t: NavTarget | null): void;
  /** Clear one kind of target (a mission ending must not clear the player's waypoint). */
  clearTarget(kind: NavTarget['kind']): void;
  /** What the GPS leads to now: the waypoint if set, else the mission target. */
  readonly target: NavTarget | null;
  /** Metres left along the GPS route (Infinity without a target). */
  readonly routeLeft: number;
  /** Blip providers are asked for their blips on every minimap/map redraw. */
  addBlips(provider: () => Iterable<Blip>): void;
  /** The police search circle while wanted and unseen (GPS-style red area), or null. */
  searchArea: { x: number; z: number; r: number } | null;
  /** The full-screen map is open (gameplay input is off behind it). */
  readonly mapOpen: boolean;
}

// --- Wanted level (police/) -----------------------------------------------------------------------

export type Crime = 'hit_person' | 'carjack' | 'hit_police' | 'ram' | 'speeding';
export interface WantedApi extends System {
  /** 0..5 stars. */
  readonly level: number;
  /** Police can see the player (stars solid); false while they search (stars flash). */
  readonly seen: boolean;
  /** A crime at (x, z). Counts if police are close enough to witness it (some always count). */
  crime(kind: Crime, x: number, z: number): void;
  clear(): void;
  /** Metres from the camera to the nearest police car with its siren on (Infinity: none). */
  readonly sirenDistance: number;
  /** Police cars on the streets (collisions with people, traffic keeping its distance). */
  policeCars(): readonly Vehicle[];
}

// --- Street races (races/) -------------------------------------------------------------------------

export interface RaceApi extends System {
  /** A race is counting down or running (fares wait until it is over). */
  readonly active: boolean;
}

// --- Missions (missions/) --------------------------------------------------------------------------

export interface MissionApi extends System {
  /** Money, yuan. */
  readonly cash: number;
  addCash(n: number): void;
  /** One line for the HUD (what to do now), or null while free roaming. */
  readonly objective: string | null;
}

/** Pedestrians on the pavements. Implemented by people/. */
export interface PeopleApi extends System {
  readonly count: number;
  /** Pedestrians on the carriageway right now (crossing or running): drivers brake for them. */
  inRoad(): readonly { x: number; z: number }[];
  /** Someone thrown out of their car at (x, z): gets up and runs for the pavement. */
  spawnFleeing(x: number, z: number): void;
  /** Shove whoever is within reach in front of (x, z) along (dirX, dirZ). True if someone went over. */
  shove(x: number, z: number, dirX: number, dirZ: number): boolean;
}

export interface HudApi extends System {
  setVisible(v: boolean): void;
  toast(text: string): void;
}

// --- Rendering (render/) ---------------------------------------------------------------------------

/** Uniform objects shared with any material that reacts to light, time or weather. */
export interface EnvUniforms {
  /** 0 = full day .. 1 = full night: lit windows, street lamps, headlights, neon. */
  uNight: { value: number };
  /** 0 = dry .. 1 = soaked roads (darker, glossier, puddle reflections). */
  uWet: { value: number };
  /** Seconds since boot, for animated materials. */
  uTime: { value: number };
}

export interface RenderApi extends System {
  /** World point the sun's shadow cascades follow (the player). */
  setFocus(p: THREE.Vector3): void;
  /** Local Beijing time in hours, 0..24. Writable. */
  timeOfDay: number;
  /** In-game hours per real minute (0 freezes the clock). */
  timeScale: number;
  /** 0..1 rain; wetness follows with a lag. Writable. */
  rain: number;
  readonly night: number;
  readonly wetness: number;
  readonly sunDir: THREE.Vector3;
  readonly hazeColor: THREE.Color;
  readonly uniforms: EnvUniforms;
}

// --- Landmarks (city/landmarks/) -------------------------------------------------------------------

/** Static collision shapes in a landmark's local frame (metres, +X east, +Y up, +Z south). */
export type ColliderSpec =
  | { kind: 'box'; center: [number, number, number]; half: [number, number, number]; yaw?: number }
  | { kind: 'cylinder'; center: [number, number, number]; radius: number; halfHeight: number }
  | { kind: 'hull'; points: number[] };

export interface LandmarkModel {
  group: THREE.Group;
  colliders: ColliderSpec[];
  /** Ground footprint in the local frame (x, z), used to remove the OSM building it replaces. */
  footprint: [number, number][];
  height: number;
}

export interface LandmarkDef {
  id: string;
  name: { zh: string; en: string };
  /** WGS84 anchor (the model's local origin) and heading of the model's local -Z axis, degrees clockwise from north. */
  lat: number; lon: number; headingDeg: number;
  /** `env` carries the shared night/wet/time uniforms: floodlights and lit windows follow uNight. */
  build(env: EnvUniforms): LandmarkModel;
}

