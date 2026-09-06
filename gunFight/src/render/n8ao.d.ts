declare module 'n8ao' {
  import type * as THREE from 'three';
  import { Pass } from 'postprocessing';

  export interface N8AOConfiguration {
    aoSamples: number;
    aoRadius: number;
    aoTones: number;
    denoiseSamples: number;
    denoiseRadius: number;
    distanceFalloff: number;
    intensity: number;
    denoiseIterations: number;
    renderMode: 0 | 1 | 2 | 3 | 4;
    biasOffset: number;
    biasMultiplier: number;
    color: THREE.Color;
    gammaCorrection: boolean;
    screenSpaceRadius: boolean;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    colorMultiply: boolean;
    transparencyAware: boolean;
    accumulate: boolean;
    neuralDenoise: boolean;
  }

  /** postprocessing-compatible pass (reads the composer's colour + depth). */
  export class N8AOPostPass extends Pass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    /**
     * When true (the default) the pass traverses the whole scene every frame and silently switches
     * `transparencyAware` back on the moment it finds any transparent material - which re-renders the
     * scene twice more per AO pass. Assigning `configuration.transparencyAware` only clears it if the
     * value actually changes, so set this directly.
     */
    autoDetectTransparency: boolean;
    setSize(width: number, height: number): void;
    setDisplayMode(mode: 'Combined' | 'AO' | 'No AO' | 'Split' | 'Split AO'): void;
    enableDebugMode(): void;
    disableDebugMode(): void;
    lastTime: number;
  }

  export class N8AOPass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);
    configuration: N8AOConfiguration & { autoRenderBeauty: boolean };
    setSize(width: number, height: number): void;
  }
}
