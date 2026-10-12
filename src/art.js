import * as THREE from 'three';
import { hash, hueColor, clamp } from './util.js';

const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');
const cache = new Map(); // id -> { p: Promise, v: result|null }

const tryLoad = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));

function avgColor(img) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 24, 24);
    const d = g.getImageData(0, 0, 24, 24).data;
    let r = 0, gr = 0, b = 0, w = 0;
    for (let i = 0; i < d.length; i += 4) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      const s = (mx - mn) / 255;
      const wt = 0.04 + s * s * 4;
      r += d[i] * wt; gr += d[i + 1] * wt; b += d[i + 2] * wt; w += wt;
    }
    const col = new THREE.Color().setRGB(r / w / 255, gr / w / 255, b / w / 255, THREE.SRGBColorSpace);
    const hsl = {};
    col.getHSL(hsl);
    return col.setHSL(hsl.h, Math.max(hsl.s, 0.68), clamp(hsl.l, 0.5, 0.62));
  } catch (e) { return null; }
}

// Generated cover for when the real artwork can't be used in WebGL (CORS) or is missing.
function fallbackTexture(song) {
  const s = 512, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const h = hash(song.id) % 360;
  const grd = g.createLinearGradient(0, 0, s, s);
  grd.addColorStop(0, `hsl(${h},85%,55%)`);
  grd.addColorStop(1, `hsl(${(h + 70) % 360},80%,22%)`);
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 2;
  for (let r = 40; r < 420; r += 28) { g.beginPath(); g.arc(s * 0.7, s * 0.3, r, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,.92)';
  g.font = '800 250px Unbounded, Impact, sans-serif';
  g.textBaseline = 'alphabetic';
  g.fillText((song.name || '?').trim().charAt(0).toUpperCase(), 36, s - 56);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function loadArt(song) {
  let e = cache.get(song.id);
  if (e) return e.p;
  e = { v: null };
  e.p = (async () => {
    const urls = [];
    if (song.image) {
      urls.push(song.image);
      urls.push(`https://images.weserv.nl/?url=${encodeURIComponent(song.image.replace(/^https?:\/\//, ''))}&w=640&h=640&fit=cover&output=jpg`);
    }
    for (const u of urls) {
      try {
        const tex = await tryLoad(u);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 2;
        return (e.v = { tex, color: avgColor(tex.image) || hueColor(song.id), real: true });
      } catch (err) { /* next source */ }
    }
    const h = hash(song.id) % 360;
    return (e.v = { tex: fallbackTexture(song), color: new THREE.Color().setHSL(h / 360, 0.8, 0.56), real: false });
  })();
  cache.set(song.id, e);
  return e.p;
}

// Free GPU memory for artwork that isn't on screen any more.
export function pruneArt(keep) {
  if (cache.size < 60) return;
  for (const [id, e] of cache) {
    if (cache.size < 45) break;
    if (keep.has(id) || !e.v) continue;
    e.v.tex.dispose();
    cache.delete(id);
  }
}
