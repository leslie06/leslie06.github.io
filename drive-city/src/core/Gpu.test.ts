import { describe, it, expect } from 'vitest';
import { classifyGpu } from './Gpu';

describe('classifyGpu', () => {
  it('recognises the APU string that shipped as a 3060 Ti', () => {
    // Verbatim from a desktop that has an RTX 3060 Ti in it and never touched it.
    expect(classifyGpu('ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('integrated');
  });

  it('keeps discrete parts discrete even when the vendor also makes integrated ones', () => {
    expect(classifyGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('discrete');
    expect(classifyGpu('ANGLE (AMD, AMD Radeon RX 7900 XTX Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('discrete');
    expect(classifyGpu('ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('discrete');
    expect(classifyGpu('Apple M2 Pro')).toBe('discrete');
  });

  it('recognises integrated and software adapters', () => {
    expect(classifyGpu('ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('integrated');
    expect(classifyGpu('ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics Direct3D11, D3D11)')).toBe('integrated');
    expect(classifyGpu('Mali-G78')).toBe('integrated');
    expect(classifyGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))')).toBe('software');
    expect(classifyGpu('Mesa/X.org llvmpipe (LLVM 15.0.6, 256 bits)')).toBe('software');
  });

  it('says unknown rather than guessing when the extension is blocked', () => {
    expect(classifyGpu('')).toBe('unknown');
    expect(classifyGpu('WebKit WebGL')).toBe('unknown');
  });
});
