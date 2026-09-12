import { describe, expect, it } from 'vitest';
import { patchWet, wetKind, type WetUniforms } from './Wet';

/**
 * Pins the `material.userData.wet` opt-in other modules rely on (character/Crowd sets `true`,
 * roads should set 'ground'): only 'ground' may grow puddles - a puddle on a head or a car roof
 * is wrong.
 */
const stub = () => ({
  vertexShader: '#include <common>\nvoid main() {\n#include <worldpos_vertex>\n}',
  fragmentShader: '#include <common>\nvoid main() {\n#include <roughnessmap_fragment>\n#include <normal_fragment_begin>\n#include <normal_fragment_maps>\n#include <lights_fragment_maps>\n}',
  uniforms: {} as Record<string, { value: unknown }>,
});
const u: WetUniforms = { dcWetness: { value: 0 }, dcRain: { value: 0 }, dcTime: { value: 0 } };

describe('wet surfaces', () => {
  it('maps the opt-in values', () => {
    expect(wetKind(true)).toBe('damp');
    expect(wetKind('ground')).toBe('ground');
    expect(wetKind('surface')).toBe('surface');
    expect(wetKind(undefined)).toBeNull();
    expect(wetKind(false)).toBeNull();
  });

  it('puts puddles on ground only, and shares the wetness uniform', () => {
    for (const kind of ['ground', 'damp', 'surface'] as const) {
      const sh = stub();
      patchWet(sh as never, kind, u, true);
      expect(sh.uniforms.dcWetness).toBe(u.dcWetness);
      expect(sh.fragmentShader.includes('dcPuddle = dcUp')).toBe(kind === 'ground');
      expect(sh.fragmentShader.includes('dcRipple(dcP')).toBe(kind === 'ground');
      expect(sh.vertexShader).toContain('vDcWetPos = (modelMatrix * dcWp).xyz;');
    }
  });

  it('leaves materials without roughness alone', () => {
    const sh = { vertexShader: 'v', fragmentShader: '#include <common>\nvoid main() {}', uniforms: {} as Record<string, unknown> };
    patchWet(sh as never, 'ground', u, false);
    expect(sh.fragmentShader).toBe('#include <common>\nvoid main() {}');
    expect(sh.uniforms.dcWetness).toBeUndefined();
  });
});
