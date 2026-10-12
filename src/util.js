import * as THREE from 'three';

export const SP = 10; // world distance between two songs along the tunnel
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// The tunnel's spine. t is a (fractional) song index.
export function pathAt(t, out = new THREE.Vector3()) {
  return out.set(Math.sin(t * 0.85) * 2.4, Math.cos(t * 0.6) * 1.3, -t * SP);
}

export const hueColor = (seed) =>
  new THREE.Color().setHSL((hash(String(seed)) % 360) / 360, 0.8, 0.56);

export function fmt(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return m + ':' + String(r).padStart(2, '0');
}
