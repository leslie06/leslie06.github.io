import * as THREE from 'three';
import { JOINT_COUNT } from './Body';
import { HAIRLINE } from './BodyMesh';

/**
 * GPU skinning and per-person looks for the crowd, injected into three's own materials so the
 * game's lighting, CSM shadows, fog and wet-surface patch all still apply.
 *
 * Joint texture (RGBA32F, NearestFilter): one row per instance, JOINT_COUNT * 4 texels.
 *   texel j*4+0..2  rows 0..2 of joint j's skinning matrix (posed world * inverse bind; the
 *                   instance's position, yaw and height scale are in it)
 *   texel j*4+3     spare; joints 0..4 carry the packed Look (Body.packLook):
 *     x=3   skin, top, inner layer, bottom          (colours as 24-bit sRGB integers)
 *     x=7   shoes, hair, cap, sole
 *     x=11  top kind, sleeve end, bottom kind, hem
 *     x=15  hair kind, fem, build, flags (1 glasses, 2 mask, 4 cap, 8 stubble, 16 legwear, 32 fringe, 64 print)
 *     x=19  mask colour, age, legwear colour, -
 * The row of instance i is `dccBase + dccSign * gl_InstanceID`: the near LOD fills rows from the
 * top, the far LOD from the bottom, so one texture (one upload) serves both draws.
 *
 * Every name starts with `dcc` (the wet patch uses `dc`).
 */
export const ROW_TEXELS = JOINT_COUNT * 4;
export const PROGRAM_KEY = 'dcc-crowd-6';

export interface CrowdUniforms {
  dccJoints: { value: THREE.Texture };
  dccBase: { value: number };
  dccSign: { value: number };
}

const hairlineGlsl = (() => {
  let s = 'float dccHairline(float a) {\n  a = min(abs(a), 3.14159);\n';
  for (let i = 1; i < HAIRLINE.length; i++) {
    const [a0, y0] = HAIRLINE[i - 1], [a1, y1] = HAIRLINE[i];
    s += `  if (a <= ${a1.toFixed(4)}) return mix(${y0.toFixed(4)}, ${y1.toFixed(4)}, smoothstep(0.0, 1.0, (a - ${a0.toFixed(4)}) / ${(a1 - a0).toFixed(4)}));\n`;
  }
  return s + `  return ${HAIRLINE[HAIRLINE.length - 1][1].toFixed(4)};\n}\n`;
})();

const VERT_COMMON = /* glsl */`
uniform highp sampler2D dccJoints;
uniform int dccBase;
uniform int dccSign;
attribute vec3 aMorphF;
attribute vec3 aMorphH;
attribute vec4 aDc;
attribute vec4 dcJoint;
attribute vec4 dcWeight;

// Neck opening of the top: inside this cylinder around the neck (and above holeY) is skin.
bool dccNeckSkin(vec3 r, int top) {
  float nr = length(vec2(r.x, r.z + 0.02));
  float fc = r.z / max(1e-4, length(r.xz));
  float holeR = top == 0 ? mix(0.078, 0.094, smoothstep(-0.2, 0.9, fc)) : top == 4 ? 0.08 : 0.07;
  float holeY = top == 0 ? mix(1.462, 1.428, smoothstep(0.2, 1.0, fc)) : top == 4 ? mix(1.462, 1.44, smoothstep(0.2, 1.0, fc)) : 1.47;
  if (top >= 1 && top <= 3 && r.z > 0.0 && r.y > 1.415 && abs(r.x) < (1.49 - r.y) * 0.32) return true;
  return (nr < holeR && r.y > holeY) || r.y > 1.5;
}
// The same opening as a soft 0..1 cover (inflating the cloth must not step along mesh edges).
float dccCovered(vec3 r, int top) {
  float nr = length(vec2(r.x, r.z + 0.02));
  float fc = r.z / max(1e-4, length(r.xz));
  float holeR = top == 0 ? mix(0.078, 0.094, smoothstep(-0.2, 0.9, fc)) : top == 4 ? 0.08 : 0.07;
  float holeY = top == 0 ? mix(1.462, 1.428, smoothstep(0.2, 1.0, fc)) : top == 4 ? mix(1.462, 1.44, smoothstep(0.2, 1.0, fc)) : 1.47;
  float c = max(smoothstep(holeR - 0.008, holeR + 0.008, nr), 1.0 - smoothstep(holeY - 0.01, holeY + 0.01, r.y));
  if (top >= 1 && top <= 3 && r.z > 0.0) c *= smoothstep(-0.008, 0.004, abs(r.x) - (1.49 - r.y) * 0.32) + (1.0 - smoothstep(1.405, 1.425, r.y));
  return clamp(c, 0.0, 1.0) * (1.0 - smoothstep(1.49, 1.505, r.y));
}
vec4 dccTexel(int x, int row) { return texelFetch(dccJoints, ivec2(x, row), 0); }
void dccSkin(out vec3 pos, out vec3 nrm, out int row) {
  row = dccBase + dccSign * gl_InstanceID;
  vec4 L2 = dccTexel(11, row);
  vec4 L3 = dccTexel(15, row);
  float L4w = dccTexel(19, row).w;
  float part = floor(aDc.x + 0.5);
  float fem = L3.y, build = L3.z;
  int hair = int(L3.x + 0.5), flags = int(L3.w + 0.5), top = int(L2.x + 0.5), bottom = int(L2.z + 0.5);
  bool cap = (flags & 4) != 0;
  vec3 p = position, n = normal;
  bool hide = false;
  if (part < 4.5) {
    p += aMorphF * fem + aMorphH * build;
    float th = 0.0;
    if (part < 0.5) {
      float covered = dccCovered(position, top);
      float hemY = top == 3 ? 0.0 : top == 2 ? 0.9 : 0.93;
      th = (top >= 2 && top <= 3 ? 0.012 : top == 4 ? 0.008 : 0.0035) * covered * smoothstep(hemY - 0.012, hemY + 0.004, position.y);
      if (bottom == 2 && position.y < 1.02) th = max(th, 0.004);
      else if (position.y < 1.02) th = max(th, 0.0045);
    } else if (part < 1.5) {
      th = aDc.y < L2.y ? (top >= 2 ? 0.011 : 0.0045) : 0.0;
    } else if (part > 2.5 && part < 3.5) {
      th = bottom != 2 && aDc.y < L2.w ? (bottom == 1 ? 0.009 : 0.006) : 0.0;
    } else if (part > 3.5 && (flags & 2) != 0) {
      th = 0.0045 * step(position.y, 1.63) * step(1.522, position.y) * smoothstep(0.02, 0.045, position.z);
    }
    p += n * th;
  } else if (part < 5.5) {
    float ax = sign(position.x) * 0.088;
    p.x = ax + (p.x - ax) * (1.0 - 0.07 * fem);
    p.z = -0.005 + (p.z + 0.005) * (1.0 - 0.1 * fem);
    p.y *= 1.0 - 0.05 * fem;
  } else if (part > 10.5) {
    hide = L4w < 0.5;
  } else if (part < 6.5 || part > 9.5) {
    hide = hair < 2 && !cap;
    float thick = hair == 2 ? 0.013 : hair == 3 ? 0.017 : hair == 4 ? 0.019 : 0.006;
    if (hair == 2) thick *= mix(0.12, 1.2, smoothstep(1.63, 1.725, position.y));
    else if (hair == 3 || hair == 4) thick *= mix(0.55, 1.1, smoothstep(1.62, 1.72, position.y));
    if (cap) thick = 0.0;
    float tf = part < 6.5 ? aDc.w : 0.5;
    p += n * tf * thick;
    if (cap) p += aMorphF;
    if (part > 9.5) {
      float a = abs(atan(position.x, position.z - 0.005));
      float len = cap ? 0.0 : hair == 3 ? 1.0 : hair == 4 ? 0.48 : 0.0;
      float fringe = !cap && (flags & 32) != 0 && hair >= 2 && hair <= 4 ? 1.0 : 0.0;
      p += aMorphH * mix(fringe, len, smoothstep(0.85, 1.2, a));
    }
  } else if (part < 7.5) {
    hide = !(hair == 5 || hair == 6);
    if (hair == 6) p += aMorphF;
  } else if (part < 8.5) {
    hide = !cap;
  } else {
    bool coat = top == 3, skirt = bottom == 2;
    hide = !(coat || skirt);
    float len = max(skirt ? L2.w : 0.0, coat ? 0.78 : 0.0);
    float c = aDc.w;
    p += aMorphF * (min(c, len) - c) + aMorphH * build;
  }
  ivec4 j = ivec4(dcJoint + 0.5);
  vec4 hp = vec4(p, 1.0);
  vec4 r0 = vec4(0.0), r1 = vec4(0.0), r2 = vec4(0.0);
  #define DCC_BONE(k) { float w = dcWeight[k]; if (w > 0.0) { int x = j[k] * 4; r0 += w * dccTexel(x, row); r1 += w * dccTexel(x + 1, row); r2 += w * dccTexel(x + 2, row); } }
  DCC_BONE(0) DCC_BONE(1) DCC_BONE(2) DCC_BONE(3)
  pos = vec3(dot(r0, hp), dot(r1, hp), dot(r2, hp));
  nrm = vec3(dot(r0.xyz, n), dot(r1.xyz, n), dot(r2.xyz, n));
  if (hide) pos = vec3(0.0, -1000.0, 0.0);
}
`;

const FRAG_COMMON = /* glsl */`
uniform highp sampler2D dccJoints;
varying vec4 vDccA;
varying vec4 vDccB;
flat varying ivec2 vDccRow;

// Neck opening of the top: inside this cylinder around the neck (and above holeY) is skin.
bool dccNeckSkin(vec3 r, int top) {
  float nr = length(vec2(r.x, r.z + 0.02));
  float fc = r.z / max(1e-4, length(r.xz));
  float holeR = top == 0 ? mix(0.078, 0.094, smoothstep(-0.2, 0.9, fc)) : top == 4 ? 0.08 : 0.07;
  float holeY = top == 0 ? mix(1.462, 1.428, smoothstep(0.2, 1.0, fc)) : top == 4 ? mix(1.462, 1.44, smoothstep(0.2, 1.0, fc)) : 1.47;
  if (top >= 1 && top <= 3 && r.z > 0.0 && r.y > 1.415 && abs(r.x) < (1.49 - r.y) * 0.32) return true;
  return (nr < holeR && r.y > holeY) || r.y > 1.5;
}
vec3 dccCol(float v) {
  float r = floor(v / 65536.0);
  float g = floor((v - r * 65536.0) / 256.0);
  float b = v - r * 65536.0 - g * 256.0;
  vec3 c = vec3(r, g, b) / 255.0;
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
float dccHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float dccNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(dccHash(i), dccHash(i + vec2(1.0, 0.0)), f.x), mix(dccHash(i + vec2(0.0, 1.0)), dccHash(i + 1.0), f.x), f.y);
}
${hairlineGlsl}
// Almond eye: 0 outside, 1 inside; e returns the normalised radius.
float dccEye(vec2 q, out float e) {
  float sx = q.x / 0.0128;
  float sy = q.y / (0.0056 * (1.0 - 0.45 * sx * sx) + 1e-4);
  e = sqrt(sx * sx + sy * sy);
  return 1.0 - smoothstep(0.85, 1.0, e);
}

void dccShade(out vec3 col, out float rough, out float ao, out vec3 emit) {
  int row = vDccRow.x;
  emit = vec3(0.0);
  vec4 L0 = texelFetch(dccJoints, ivec2(3, row), 0);
  vec4 L1 = texelFetch(dccJoints, ivec2(7, row), 0);
  vec4 L2 = texelFetch(dccJoints, ivec2(11, row), 0);
  vec4 L3 = texelFetch(dccJoints, ivec2(15, row), 0);
  vec4 L4 = texelFetch(dccJoints, ivec2(19, row), 0);
  vec3 skin = dccCol(L0.x), topC = dccCol(L0.y), innerC = dccCol(L0.z), botC = dccCol(L0.w);
  vec3 shoeC = dccCol(L1.x), hairC = dccCol(L1.y), capC = dccCol(L1.z), soleC = dccCol(L1.w);
  int top = int(L2.x + 0.5), bottom = int(L2.z + 0.5), hair = int(L3.x + 0.5), flags = int(L3.w + 0.5);
  float sleeve = L2.y, hem = L2.w, fem = L3.y, age = L4.y;
  vec3 legC = dccCol(L4.z);
  bool cap = (flags & 4) != 0;
  vec3 r = vDccA.xyz;
  float part = float(vDccRow.y);
  float along = vDccB.x, ex = vDccB.z;
  ao = vDccB.y;
  float grain = dccNoise(vec2(r.x * 1400.0 + r.z * 700.0, r.y * 1400.0)) - 0.5;
  float folds = dccNoise(vec2(r.x * 38.0 + r.z * 21.0, r.y * 26.0)) - 0.5;
  float blotch = dccNoise(r.xy * 55.0 + r.z * 31.0);
  vec3 skinC = skin * (0.95 + 0.08 * blotch);
  skinC = mix(skinC, vec3(dot(skinC, vec3(0.3, 0.55, 0.15))) * vec3(1.02, 0.97, 0.94), age * 0.25);
  col = skinC; rough = 0.52 - 0.06 * fem;
  float cloth = 0.0;
  bool denim = botC.b > botC.r * 1.25 && botC.b > 0.03 && bottom != 2;

  if (part < 0.5) {
    // ---- torso: top garment, collar, hem, then the bottom garment
    float fc = r.z / max(1e-4, length(r.xz));
    float hemY = top == 0 ? 0.935 : top == 1 ? 0.998 : top == 2 ? 0.905 : top == 3 ? 0.0 : 0.925;
    bool upper = !dccNeckSkin(r, top) && r.y >= hemY;
    vec3 g = topC;
    if (top >= 1 && top <= 3 && r.y > 1.455 && !dccNeckSkin(r, top)) g *= 0.9;
    if ((top == 2 || top == 3) && r.z > 0.0 && r.y > hemY) {
      float halfW = 0.03 + 0.055 * smoothstep(1.18, 1.44, r.y);
      if (abs(r.x) < halfW) { g = innerC; upper = r.y < 1.438 - 0.02 * smoothstep(0.3, 1.0, fc); }
      g *= 1.0 - 0.35 * (1.0 - smoothstep(0.0015, 0.004, abs(abs(r.x) - halfW)));
      g *= 1.0 - 0.25 * smoothstep(0.985, 1.0, fc) * step(1.42, r.y);
    }
    if (upper) {
      col = g; cloth = 1.0; rough = 0.86;
      if (top == 1 && r.z > 0.0) {
        float placket = 1.0 - smoothstep(0.004, 0.0065, abs(r.x));
        col *= 1.0 - 0.12 * placket;
        float bt = fract((r.y - 1.0) / 0.075);
        col = mix(col, g * 1.25 + 0.05, placket * (1.0 - smoothstep(0.08, 0.14, abs(bt - 0.5) * 2.0 - 0.8)) * step(abs(r.x), 0.004));
      }
      if (top == 0 && (flags & 64) != 0 && r.z > 0.07 && abs(r.x) < 0.058 && r.y > 1.22 && r.y < 1.33) {
        float ring = abs(length(vec2(r.x, r.y - 1.275) * vec2(1.0, 1.3)) - 0.03);
        col = mix(innerC, g, smoothstep(0.004, 0.007, ring) * step(0.012, abs(r.x) + abs(r.y - 1.275) * 0.3));
      }
      if (top == 4 && r.z > 0.07 && abs(r.x) < 0.1 && r.y > 0.99 && r.y < 1.12) col *= 1.0 - 0.3 * (1.0 - smoothstep(0.0015, 0.004, min(abs(r.y - 1.12), abs(abs(r.x) - 0.1 + (r.y - 0.99) * 0.25))));
      if (top == 4 && r.y > hemY && r.y < hemY + 0.03) col *= 0.82;
      if (top == 4 && r.z > 0.08 && abs(abs(r.x) - 0.03) < 0.003 && r.y > 1.3 && r.y < 1.44) col = mix(col, vec3(0.8), 0.7);
      col *= 1.0 + folds * 0.14 * smoothstep(1.15, 0.95, r.y);
    } else if (r.y < hemY || (top == 3 && r.y < 1.0)) {
      col = top == 3 ? topC : botC; cloth = 1.0; rough = denim ? 0.8 : 0.84;
      if (top == 1 && r.y > 0.978 && r.y < 1.012) { col = vec3(0.035, 0.03, 0.028); rough = 0.4; if (r.z > 0.0 && abs(r.x) < 0.013 && r.y > 0.984 && r.y < 1.006) { col = vec3(0.55, 0.52, 0.46); rough = 0.25; } }
      if (bottom != 2 && top != 3 && r.z > 0.0 && abs(r.x) < 0.008 && r.y < 0.99 && r.y > 0.86) col *= 0.82;
    }
  } else if (part < 2.5) {
    // ---- arms and hands: sleeve or skin
    if (part < 1.5 && along < sleeve) {
      col = topC; cloth = 1.0; rough = 0.86;
      if (top == 2 || top == 3) col *= 1.0 - 0.2 * smoothstep(sleeve - 0.03, sleeve - 0.02, along);
      if (top == 1 && sleeve < 0.45) col *= 1.0 - 0.18 * smoothstep(sleeve - 0.03, sleeve - 0.025, along);
      if (top == 4 && along > sleeve - 0.035) col *= 0.85;
      col *= 1.0 + folds * 0.2 * (1.0 - smoothstep(0.03, 0.06, abs(along - 0.29)));
    } else if (part > 1.5) {
      col = skinC * vec3(1.02, 0.97, 0.95);
    }
  } else if (part < 3.5) {
    // ---- legs: trousers/shorts to the hem, then skin, tights or socks
    if (bottom != 2 && along < hem) {
      col = botC; cloth = 1.0; rough = denim ? 0.8 : 0.85;
      if (denim) col *= 0.9 + 0.2 * dccNoise(vec2(along * 30.0, r.x * 60.0 + r.z * 40.0)) + 0.12 * smoothstep(0.1, 0.35, along) * (1.0 - smoothstep(0.35, 0.5, along)) * step(0.0, r.z);
      if (hem > 0.7 && along > hem - 0.03) col *= 0.9;
      col *= 1.0 + folds * 0.16 * (1.0 - smoothstep(0.02, 0.07, abs(along - 0.425)));
    } else if ((flags & 16) != 0) {
      col = legC; rough = 0.5; cloth = 1.0;
    } else if (along > 0.765) {
      col = mix(vec3(0.02), vec3(0.75), step(0.5, dccHash(vec2(float(row), 3.0)))); cloth = 1.0; rough = 0.9;
    }
  } else if (part < 4.5) {
    // ---- head: scalp hair, face, stubble, mask, glasses
    float th = atan(r.x, r.z - 0.005);
    float hl = dccHairline(th);
    float scalp = smoothstep(hl - 0.004, hl + 0.003, r.y);
    float stub = 0.55 + 0.45 * dccNoise(r.xy * 900.0 + r.z * 400.0);
    if (hair == 1) scalp *= 0.8 * smoothstep(0.35, 0.6, stub - 0.25);
    // Short cuts fade out below the hairline at the back and sides (clippered nape).
    if (hair == 1 || hair == 2) scalp = max(scalp, smoothstep(hl - 0.026, hl - 0.001, r.y) * stub * 0.85 * smoothstep(0.25, 0.9, abs(th)));
    if (hair == 0) scalp = 0.0;
    col = mix(skinC, hairC * 0.9, scalp);
    rough = mix(rough, 0.6, scalp);
    if (r.z > 0.05) {
      float ax = abs(r.x);
      // socket shade and brows
      float sock = 1.0 - smoothstep(0.012, 0.024, length(vec2(ax - 0.032, (r.y - 1.654) * 1.3)));
      col *= 1.0 - 0.14 * sock;
      float by = 1.6715 + 0.0055 * (1.0 - pow((ax - 0.034) / 0.022, 2.0)) - 0.004 * fem;
      float brow = (1.0 - smoothstep(0.0018 - 0.0006 * fem, 0.0034 - 0.001 * fem, abs(r.y - by))) * step(0.011, ax) * (1.0 - smoothstep(0.052, 0.057, ax));
      col = mix(col, hairC * 0.8, brow * 0.8);
      float e;
      float eye = dccEye(vec2(ax - 0.032, r.y - 1.652), e);
      vec3 sclera = vec3(0.62, 0.58, 0.55);
      float iris = 1.0 - smoothstep(0.0042, 0.0052, length(vec2(ax - 0.0315, r.y - 1.6515)));
      vec3 eyeC = mix(sclera, vec3(0.045, 0.03, 0.022), iris);
      col = mix(col, eyeC, eye);
      float lid = smoothstep(0.9, 1.0, e) * (1.0 - smoothstep(1.15, 1.5, e)) * step(1.6515, r.y);
      col = mix(col, vec3(0.03, 0.022, 0.02), lid * 0.9);
      rough = mix(rough, 0.18, eye);
      // nose and mouth
      float nost = 1.0 - smoothstep(0.0025, 0.0042, length(vec2(ax - 0.0085, (r.y - 1.6075) * 1.6)));
      col *= 1.0 - 0.55 * nost * step(0.09, r.z);
      col *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.01, abs(r.y - 1.6)) ) * (1.0 - smoothstep(0.012, 0.02, ax));
      float lw = 0.0235 - 0.002 * fem;
      float lipU = (1.0 - smoothstep(0.0, 0.0012, abs(r.y - 1.579) - 0.0055 * (1.0 - pow(ax / lw, 2.0)))) * step(ax, lw);
      vec3 lipC = skinC * mix(vec3(0.86, 0.62, 0.6), vec3(0.78, 0.42, 0.45), fem);
      col = mix(col, lipC, lipU);
      col = mix(col, vec3(0.12, 0.05, 0.05), (1.0 - smoothstep(0.0006, 0.0013, abs(r.y - 1.5795))) * step(ax, lw * 0.9));
      col = mix(col, col * vec3(1.05, 0.9, 0.88), fem * 0.35 * (1.0 - smoothstep(0.008, 0.02, length(vec2(ax - 0.045, r.y - 1.612)))));
      if ((flags & 8) != 0) {
        float jaw = step(r.y, 1.592) * smoothstep(0.02, 0.04, r.z) * (1.0 - lipU);
        float must = step(1.583, r.y) * step(r.y, 1.594) * step(ax, 0.026) * step(0.085, r.z);
        col = mix(col, col * mix(vec3(0.72, 0.74, 0.8), hairC * 2.5, 0.3), max(jaw * 0.55, must * 0.7) * (0.7 + 0.3 * dccNoise(r.xy * 700.0)));
      }
      if ((flags & 2) != 0 && r.y < 1.63 && r.y > 1.522 && r.z > 0.03) {
        col = dccCol(L4.x) * (0.95 + 0.05 * grain); rough = 0.9; cloth = 1.0;
        col *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.003, abs(fract((r.y - 1.52) / 0.018) - 0.5) - 0.44));
      }
      if ((flags & 1) != 0) {
        vec2 q = vec2(ax - 0.0335, r.y - 1.653);
        float d = pow(pow(abs(q.x) / 0.02, 3.0) + pow(abs(q.y) / 0.0145, 3.0), 1.0 / 3.0);
        float frame = 1.0 - smoothstep(0.08, 0.16, abs(d - 1.0));
        float bridge = step(ax, 0.014) * (1.0 - smoothstep(0.0012, 0.0022, abs(r.y - 1.6575)));
        col = mix(col, col * 0.8 + vec3(0.02), step(d, 1.0) * 0.5);
        rough = mix(rough, 0.08, step(d, 1.0));
        col = mix(col, vec3(0.025), max(frame, bridge));
      }
    } else if ((flags & 1) != 0 && abs(r.y - 1.657) < 0.0016 && abs(r.x) > 0.07) {
      col = vec3(0.025);
    }
    if ((flags & 2) != 0 && abs(r.x) > 0.07 && r.z < 0.04 && r.z > -0.02 && abs(r.y - 1.615 - r.z * 0.4) < 0.0018) col = dccCol(L4.x);
    col *= mix(vec3(1.0), vec3(1.04, 0.93, 0.9), (1.0 - smoothstep(0.07, 0.078, abs(r.x))) * 0.0 + smoothstep(0.074, 0.084, abs(r.x)) * (1.0 - scalp));
  } else if (part < 5.5) {
    // ---- shoes: sole band, toe cap, laces
    float sx = r.x - sign(r.x) * 0.088;
    bool sneaker = soleC.r + soleC.g + soleC.b > 2.0;
    col = shoeC; rough = sneaker ? 0.7 : 0.32;
    if (r.y < 0.024) { col = soleC; rough = 0.85; }
    else if (sneaker && r.z > 0.02 && r.z < 0.11 && r.y > 0.058 && abs(sx) < 0.022) col = mix(shoeC, soleC, 0.55 + 0.45 * step(0.5, fract(r.z * 110.0)));
    else if (sneaker && r.y < 0.034) col = mix(shoeC, soleC, 0.5);
    if (!sneaker && r.z > 0.09 && r.y > 0.03) rough = 0.25;
  } else if (part > 10.5) {
    // ---- phone: dark body, lit screen
    col = vec3(0.03); rough = 0.25;
    if (ex > 0.5) { col = vec3(0.02, 0.03, 0.05); rough = 0.08; emit = vec3(0.45, 0.6, 0.85) * 0.6; }
  } else if (part < 7.5 || part > 9.5) {
    // ---- hair shell, curtain, tail; or the cap over it
    bool capHere = cap && part < 6.5 && ex > 0.69;
    if (capHere) {
      col = capC * (0.95 + 0.05 * grain); cloth = 1.0; rough = 0.78;
      float ct = atan(r.x, r.z - 0.005);
      col *= 1.0 - 0.15 * (1.0 - smoothstep(0.004, 0.009, abs(ex - 0.72) * 0.08 + abs(r.y - 1.66) * 0.0)) * 0.0;
      col *= 1.0 - 0.12 * (1.0 - smoothstep(0.02, 0.05, abs(abs(ct) - 1.57)));
      if (r.z > 0.05 && abs(r.x) < 0.022 && r.y > 1.705 && r.y < 1.735) col = mix(col, vec3(0.85) - capC * 0.4, 0.8);
    } else {
      float ht = atan(r.x, r.z - 0.005);
      float s1 = dccNoise(vec2(ht * 70.0, r.y * 6.0 + ex * 3.0));
      float s2 = dccNoise(vec2(ht * 190.0, r.y * 14.0));
      float s3 = dccNoise(vec2(ht * 420.0, r.y * 30.0));
      col = hairC * (0.72 + 0.5 * s1 + 0.3 * s2 + 0.18 * s3);
      col *= mix(0.7, 1.0, part > 6.5 ? 1.0 : smoothstep(0.0, 0.6, ex));
      if ((hair == 3 || hair == 4) && r.z > 0.0 && abs(r.x - 0.012) < 0.0022 && r.y > 1.7 && part < 6.5) col = mix(col, skinC * 0.8, 0.8);
      rough = 0.6 - 0.12 * s2;
    }
  } else if (part < 8.5) {
    col = capC * 0.85; rough = 0.75; cloth = 1.0;
  } else {
    // ---- skirt or coat tail
    bool coat = top == 3;
    col = coat ? topC : botC; cloth = 1.0; rough = 0.84;
    float ang = atan(r.x, r.z);
    if (coat) col *= 1.0 - 0.3 * (1.0 - smoothstep(0.02, 0.05, abs(ang)));
    col *= 1.0 + folds * 0.25;
    if (!coat && (flags & 64) != 0) col *= 1.0 - 0.1 * max(0.0, sin(ang * 26.0));
  }
  col *= 1.0 + grain * 0.07 * cloth;
}
`;

function vertexPatch(vs: string, varyings: boolean): string {
  const common = '#include <common>\n' + VERT_COMMON + (varyings ? 'varying vec4 vDccA;\nvarying vec4 vDccB;\nflat varying ivec2 vDccRow;\n' : '');
  let out = vs.replace('#include <common>', common);
  if (varyings) {
    out = out.replace('#include <beginnormal_vertex>', `vec3 dccP; vec3 objectNormal; int dccRow;
dccSkin(dccP, objectNormal, dccRow);
vDccA = vec4(position, aDc.x); vDccB = vec4(aDc.y, aDc.z, aDc.w, 0.0); vDccRow = ivec2(dccRow, int(aDc.x + 0.5));`);
    out = out.replace('#include <begin_vertex>', 'vec3 transformed = dccP;');
  } else {
    out = out.replace('#include <begin_vertex>', 'vec3 dccP; vec3 dccN; int dccRow;\ndccSkin(dccP, dccN, dccRow);\nvec3 transformed = dccP;');
  }
  return out;
}

type Hook = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;

/** Patch a MeshStandardMaterial into the crowd material (chains any hook already on it). */
export function patchCrowdMaterial(mat: THREE.MeshStandardMaterial, u: CrowdUniforms): void {
  const prev: Hook = mat.onBeforeCompile;
  mat.onBeforeCompile = function (this: THREE.Material, shader, renderer) {
    prev.call(this, shader, renderer);
    Object.assign(shader.uniforms, u);
    shader.vertexShader = vertexPatch(shader.vertexShader, true);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_COMMON)
      .replace('#include <color_fragment>', '#include <color_fragment>\nvec3 dccAlbedo; float dccRough; float dccAO; vec3 dccEmit;\ndccShade(dccAlbedo, dccRough, dccAO, dccEmit);\ndiffuseColor.rgb *= dccAlbedo;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += dccEmit;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = dccRough;')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= dccAO;
reflectedLight.indirectSpecular *= mix(1.0, dccAO, 0.8);
reflectedLight.directDiffuse *= mix(1.0, dccAO, 0.35);`);
  };
  mat.customProgramCacheKey = () => PROGRAM_KEY;
}

/** Shadow caster with the same skinning (directional/spot lights; point lights use `distance`). */
export function crowdDepthMaterials(u: CrowdUniforms): { depth: THREE.MeshDepthMaterial; distance: THREE.MeshDistanceMaterial } {
  const hook: Hook = (shader) => { Object.assign(shader.uniforms, u); shader.vertexShader = vertexPatch(shader.vertexShader, false); };
  const depth = new THREE.MeshDepthMaterial();
  depth.onBeforeCompile = hook;
  depth.customProgramCacheKey = () => PROGRAM_KEY + '-depth';
  const distance = new THREE.MeshDistanceMaterial();
  distance.onBeforeCompile = hook;
  distance.customProgramCacheKey = () => PROGRAM_KEY + '-dist';
  return { depth, distance };
}
