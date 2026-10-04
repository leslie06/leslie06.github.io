import * as THREE from 'three';
import type { Look } from './Body';

const cache = new WeakMap<Look, string>();
const css = (c: THREE.Color, k = 1) => `rgb(${Math.round(Math.min(1, c.r * k) * 255)},${Math.round(Math.min(1, c.g * k) * 255)},${Math.round(Math.min(1, c.b * k) * 255)})`;
const sRGB = (c: THREE.Color) => c.clone().convertLinearToSRGB();

/**
 * A head-and-shoulders avatar drawn from a Look (the dialogue box's portrait): the shirt on the
 * shoulders, skin, the hairstyle and its colour (greying with age), cap, glasses, mask and stubble
 * - the same things that tell people apart in the street. Returns a data URL, cached per Look.
 * `bg` is the disc behind (the speaker's colour).
 */
export function portrait(look: Look, bg: string, size = 96): string {
  const hit = cache.get(look);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const s = size / 96;
  g.scale(s, s);
  g.beginPath(); g.arc(48, 48, 48, 0, Math.PI * 2); g.fillStyle = bg; g.fill();
  g.save(); g.beginPath(); g.arc(48, 48, 48, 0, Math.PI * 2); g.clip();
  const skin = sRGB(look.skin), shirt = sRGB(look.shirt), age = look.age ?? 0.3, fem = look.fem ?? 0;
  const hair = sRGB(look.hair).lerp(new THREE.Color(0.72, 0.72, 0.7), Math.max(0, (age - 0.55) * 1.6));
  const wide = 1 + 0.12 * Math.max(0, look.build ?? 0);
  // shoulders and the collar
  g.fillStyle = css(shirt);
  g.beginPath(); g.ellipse(48, 104, 40 * wide, 30, 0, 0, Math.PI * 2); g.fill();
  if (look.top === 'jacket' || look.top === 'coat') {
    g.fillStyle = css(sRGB(look.inner ?? look.shirt));
    g.beginPath(); g.moveTo(40, 76); g.lineTo(48, 92); g.lineTo(56, 76); g.closePath(); g.fill();
  }
  // neck, head, ears
  g.fillStyle = css(skin, 0.92); g.fillRect(41, 64, 14, 16);
  g.fillStyle = css(skin);
  g.beginPath(); g.ellipse(48, 50, 17 * (1 - 0.06 * fem), 21, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(31, 52, 3.5, 5.5, 0, 0, Math.PI * 2); g.ellipse(65, 52, 3.5, 5.5, 0, 0, Math.PI * 2); g.fill();
  const style = look.hairStyle ?? 'short';
  g.fillStyle = css(hair);
  // hair behind the head (long, bob)
  if (style === 'long') { g.beginPath(); g.ellipse(48, 58, 22, 26, 0, Math.PI, 0, true); g.fillRect(26, 44, 44, 34); g.fill(); g.fillStyle = css(skin); g.beginPath(); g.ellipse(48, 50, 16, 21, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = css(hair); }
  if (style === 'bob') { g.beginPath(); g.ellipse(48, 52, 21, 23, 0, Math.PI * 1.02, Math.PI * 1.98); g.fill(); g.fillRect(27, 42, 6, 22); g.fillRect(63, 42, 6, 22); }
  // the top of the head
  if (style !== 'bald') {
    const thick = style === 'buzz' ? 0.5 : 1;
    g.beginPath(); g.ellipse(48, 44, 18, 15 * (0.75 + 0.25 * thick), 0, Math.PI, 0); g.fill();
    if (style !== 'buzz') g.fillRect(30, 40, 36, 4);
    if (look.fringe) { g.beginPath(); g.ellipse(46, 37, 14, 7, -0.15, 0, Math.PI); g.fill(); }
    if (style === 'bun') { g.beginPath(); g.arc(48, 25, 7, 0, Math.PI * 2); g.fill(); }
    if (style === 'ponytail') { g.beginPath(); g.ellipse(66, 46, 4, 11, -0.35, 0, Math.PI * 2); g.fill(); }
  }
  // face: brows, eyes, nose, mouth
  g.fillStyle = 'rgba(30,22,18,0.9)';
  g.fillRect(37, 45, 8, 1.6); g.fillRect(51, 45, 8, 1.6);
  g.beginPath(); g.arc(41, 50, 1.8, 0, Math.PI * 2); g.arc(55, 50, 1.8, 0, Math.PI * 2); g.fill();
  g.fillStyle = css(skin, 0.82); g.fillRect(47, 52, 2.5, 7);
  if (look.beard) { g.fillStyle = 'rgba(40,34,30,0.28)'; g.beginPath(); g.ellipse(48, 63, 13, 7, 0, 0, Math.PI); g.fill(); }
  g.strokeStyle = 'rgba(120,50,45,0.85)'; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(43, 63); g.quadraticCurveTo(48, 65.5, 53, 63); g.stroke();
  if (age > 0.6) { g.strokeStyle = 'rgba(80,55,45,0.35)'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(36, 56); g.lineTo(39, 58); g.moveTo(60, 56); g.lineTo(57, 58); g.stroke(); }
  if (look.glasses) { g.strokeStyle = '#1b1c1e'; g.lineWidth = 1.6; g.beginPath(); g.arc(41, 50, 5, 0, Math.PI * 2); g.moveTo(60, 50); g.arc(55, 50, 5, 0, Math.PI * 2); g.moveTo(46, 50); g.lineTo(50, 50); g.stroke(); }
  if (look.mask) { g.fillStyle = css(sRGB(look.mask)); g.beginPath(); g.moveTo(34, 55); g.quadraticCurveTo(48, 50, 62, 55); g.lineTo(60, 66); g.quadraticCurveTo(48, 72, 36, 66); g.closePath(); g.fill(); }
  if (look.cap) {
    g.fillStyle = css(sRGB(look.cap));
    g.beginPath(); g.ellipse(48, 40, 19, 13, 0, Math.PI, 0); g.fill();
    g.fillRect(29, 38, 38, 4);
    g.beginPath(); g.ellipse(50, 41, 15, 3.4, 0, 0, Math.PI); g.fill();
  }
  g.restore();
  const url = cv.toDataURL();
  cache.set(look, url);
  return url;
}
