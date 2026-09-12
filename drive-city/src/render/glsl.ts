/**
 * GLSL shared by the sky dome, the sky-view LUT, the environment capture and the Atmosphere effect.
 *
 * The sky-view LUT is an equirect over world directions with a non-linear latitude axis
 * (v = 0.5 + 0.5 * sign(el) * sqrt(|el| / 90 deg)): half the rows cover the band within ~22 deg of
 * the horizon, where every sunset gradient lives. u = atan(z, x) / 2pi + 0.5 (wraps; the texture
 * uses RepeatWrapping in u).
 */
export const SKY_LUT_GLSL = /* glsl */`
vec2 skyLutUv(vec3 d) {
  float el = asin(clamp(d.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) * 0.63661977);
  return vec2(atan(d.z, d.x) * 0.15915494 + 0.5, v);
}
vec3 skyLutDir(vec2 uv) {
  float s = uv.y * 2.0 - 1.0;
  float el = sign(s) * s * s * 1.57079633;
  float az = (uv.x - 0.5) * 6.28318531;
  return vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
}
`;
