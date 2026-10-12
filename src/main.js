import './style.css';
import * as THREE from 'three';
import { createStage } from './stage.js';
import { RecordPool } from './records.js';
import { Player } from './audio.js';
import { Feed, VIBES } from './feed.js';
import rec from './recommend.js';
import { clamp, damp, fmt } from './util.js';

const $ = (s) => document.querySelector(s);
const stage = createStage($('#gl'));
const pool = new RecordPool(stage.scene);
const player = new Player();
const feed = new Feed();
const ray = new THREE.Raycaster();
const root = document.documentElement;

// ---------- state ----------
// target / pos are song indexes. -1 is the home screen, 0 is the first song.
let target = -1, pos = -1, prevPos = -1, vel = 0;
let uiIdx = -1, playingIdx = -1, stable = 0, blocked = false, pendingStart = false;
let gesture = false, anchor = -1, lastInput = 0, drag = null;
let hintGone = false, frameN = 0, lastTime = performance.now(), time = 0, fpsAcc = 0, fpsN = 0;
let playStartTime = 0;
const mouse = { x: 0, y: 0 };
const likes = new Set(JSON.parse(localStorage.getItem('waxwarp-likes') || '[]'));
const maxIdx = () => Math.max(0, feed.songs.length - 1);

const els = {
  title: $('#title'), artist: $('#artist'), album: $('#album'), meta: $('#meta'), big: $('#big'),
  num: $('#num'), numbar: $('#numbar'), fill: $('#fill'), tcur: $('#tcur'), tdur: $('#tdur'),
  like: $('#like'), play: $('#play'), player: $('#player'), toast: $('#toast'), loader: $('#loader'),
  hint: $('#hint'), hero: $('#hero'), start: $('#start'), note: $('#note'),
};

let toastT;
function toast(msg) {
  els.toast.textContent = msg; els.toast.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => els.toast.classList.remove('show'), 3000);
}
const pop = (el) => el.animate(
  [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }],
  { duration: 500, easing: 'cubic-bezier(.2,.8,.2,1)' }
);

function setActive(i) {
  const s = feed.songs[i];
  if (!s) return;
  uiIdx = i;
  const clean = (s.name || '').replace(/\(.*?\)|\[.*?\]/g, '').trim() || s.name || 'Untitled';
  els.title.textContent = s.name || 'Untitled';
  els.big.textContent = clean;
  const n = clean.length;
  els.big.style.fontSize = n <= 9 ? '19vw' : n <= 16 ? '14vw' : n <= 28 ? '10vw' : '7.5vw';
  els.artist.textContent = s.artists || s.artist;
  els.album.textContent = [s.album, s.year].filter(Boolean).join(', ');
  els.meta.textContent = '';
  const tags = [s.genre];
  if (s.language && s.language.toLowerCase() !== (s.genre || '').toLowerCase()) tags.push(s.language);
  for (const t of tags) { if (!t) continue; const sp = document.createElement('span'); sp.textContent = t; els.meta.append(sp); }
  pop(els.artist); pop(els.album);
  els.num.textContent = String(i + 1).padStart(3, '0');
  els.like.classList.toggle('on', likes.has(s.id));
  els.tdur.textContent = fmt(s.duration);
}

function setMedia(s) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: s.name, artist: s.artists, album: s.album,
      artwork: s.image ? [{ src: s.image, sizes: '500x500', type: 'image/jpeg' }] : [],
    });
  } catch (e) { /* ignore */ }
}
if ('mediaSession' in navigator) {
  const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) {} };
  h('play', () => player.toggle()); h('pause', () => player.toggle());
  h('nexttrack', () => step(1)); h('previoustrack', () => step(-1));
}

// ---------- audio unlock ----------
// Browsers only allow sound after a click, tap or key press. Scrolling with the wheel does not count,
// so the first real interaction unlocks audio, and starts the song if it was waiting.
function unlock() {
  player.init();
  if (blocked) { blocked = false; const i = uiIdx >= 0 ? uiIdx : 0; if (pos > -0.6) startPlay(i); }
}
addEventListener('pointerdown', unlock, true);
addEventListener('keydown', unlock, true);
player.onblocked = () => { blocked = true; playingIdx = -1; toast('Click anywhere to turn the sound on.'); };

// ---------- scrolling ----------
function seenHint() { if (!hintGone) { hintGone = true; els.hint.classList.add('gone'); } }
function nudge(d) {
  if (!feed.songs.length) return;
  if (!gesture) { gesture = true; anchor = Math.round(target); }
  target = clamp(target + d, -1, maxIdx());
  lastInput = performance.now(); seenHint();
}
function settle() {
  const delta = target - anchor;
  let n = Math.abs(delta) < 0.1 ? 0 : Math.sign(delta) * Math.max(1, Math.round(Math.abs(delta)));
  n = clamp(n, -8, 8);
  target = clamp(anchor + n, -1, maxIdx());
  gesture = false;
}
function step(n) {
  if (!feed.songs.length) return;
  if (gesture) settle();
  target = clamp(Math.round(target) + n, -1, maxIdx()); seenHint();
}

addEventListener('wheel', (e) => {
  e.preventDefault();
  const dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
  nudge(clamp(dy, -300, 300) * 0.0035);
}, { passive: false });

addEventListener('keydown', (e) => {
  const k = e.key;
  if (['ArrowDown', 'ArrowRight', 'PageDown', 'j'].includes(k)) { e.preventDefault(); step(1); }
  else if (['ArrowUp', 'ArrowLeft', 'PageUp', 'k'].includes(k)) { e.preventDefault(); step(-1); }
  else if (k === ' ' && document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); player.toggle(); }
  else if (k === 'm') toggleMute();
  else if (k === 'l') toggleLike();
});

const canvas = $('#gl');
canvas.addEventListener('pointerdown', (e) => {
  if (!feed.songs.length) return;
  canvas.setPointerCapture?.(e.pointerId);
  if (!gesture) { gesture = true; anchor = Math.round(target); }
  drag = { sy: e.clientY, sx: e.clientX, base: target, moved: false, ly: e.clientY, lt: performance.now(), v: 0 };
});
addEventListener('pointermove', (e) => {
  mouse.x = (e.clientX / innerWidth) * 2 - 1; mouse.y = -((e.clientY / innerHeight) * 2 - 1);
  if (!drag) return;
  const dy = drag.sy - e.clientY;
  if (Math.abs(dy) > 8 || Math.abs(e.clientX - drag.sx) > 8) drag.moved = true;
  if (drag.moved) {
    target = clamp(drag.base + dy / (innerHeight * 0.55), -1, maxIdx());
    const now = performance.now(), dt = Math.max(1, now - drag.lt);
    drag.v = drag.v * 0.6 + ((drag.ly - e.clientY) / dt * 1000) * 0.4;
    drag.ly = e.clientY; drag.lt = now; lastInput = now; seenHint();
  }
});
addEventListener('pointerup', (e) => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.moved) {
    target = clamp(target + (d.v / innerHeight) * 0.35, -1, maxIdx());
    settle();
  } else {
    gesture = false;
    ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), stage.camera);
    const hit = pool.pick(ray);
    if (hit >= 0) { if (hit === Math.round(target)) player.toggle(); else target = hit; }
  }
});
addEventListener('dblclick', (e) => {
  if (e.target === canvas && pos > -0.5) { toggleLike(true); burst(e.clientX, e.clientY); }
});

// ---------- controls ----------
function toggleLike(forceOn) {
  const s = feed.songs[uiIdx]; if (!s) return;
  if (forceOn && likes.has(s.id)) return;
  if (likes.has(s.id)) likes.delete(s.id);
  else { likes.add(s.id); rec.like(s, feed.vibe.id); }
  localStorage.setItem('waxwarp-likes', JSON.stringify([...likes]));
  els.like.classList.toggle('on', likes.has(s.id));
}
function burst(x, y) {
  for (let i = 0; i < 5; i++) {
    const h = document.createElement('div');
    h.className = 'heart'; h.textContent = '♥';
    h.style.left = x + 'px'; h.style.top = y + 'px';
    h.style.setProperty('--dx', (Math.random() * 160 - 80) + 'px');
    h.style.setProperty('--r', (Math.random() * 60 - 30) + 'deg');
    h.style.animationDelay = i * 60 + 'ms';
    document.body.append(h); setTimeout(() => h.remove(), 1500);
  }
}
function toggleMute() { const m = player.toggleMute(); $('#mute').classList.toggle('off', m); }
els.like.onclick = () => { const was = likes.has(feed.songs[uiIdx]?.id); toggleLike(); if (!was) { const r = els.like.getBoundingClientRect(); burst(r.left + 20, r.top); } };
els.play.onclick = () => player.toggle();
$('#next').onclick = () => step(1);
$('#prev').onclick = () => step(-1);
$('#mute').onclick = toggleMute;
$('#seek').addEventListener('pointerdown', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  player.seek((e.clientX - r.left) / r.width);
});
$('#seek').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') { e.stopPropagation(); player.active.currentTime += 5; }
  if (e.key === 'ArrowLeft') { e.stopPropagation(); player.active.currentTime -= 5; }
});
player.onstate = (p) => els.player.classList.toggle('is-playing', p);
player.onend = () => {
  // Report full completion — strongest positive signal
  if (playingIdx >= 0 && feed.songs[playingIdx]) {
    const prev = feed.songs[playingIdx];
    rec.endPlay(prev, prev.duration || player.duration, prev.duration || player.duration);
  }
  if (playingIdx >= 0) step(1);
};
player.onerror = () => {
  toast('That track will not load. Skipping ahead.');
  setTimeout(() => step(1), 700);
};

function startPlay(i) {
  const s = feed.songs[i]; if (!s) return;
  // Report end of previous song to recommender
  if (playingIdx >= 0 && feed.songs[playingIdx]) {
    const prev = feed.songs[playingIdx];
    const listened = (performance.now() - playStartTime) / 1000;
    rec.endPlay(prev, listened, prev.duration || player.duration);
  }
  playingIdx = i; blocked = false; player.play(s); setMedia(s);
  playStartTime = performance.now();
  rec.startPlay(s, feed.vibe.id);
}

// ---------- start / vibes ----------
function leaveHome() {
  if (!feed.songs.length) return;
  target = 0; gesture = false;
  if (pos < -0.5) { uiIdx = -1; }
  setActive(0); startPlay(0);
}
els.start.addEventListener('click', () => { if (!els.start.disabled) leaveHome(); });

const nav = $('#vibes');
VIBES.forEach((v, i) => {
  const b = document.createElement('button');
  b.className = 'chip' + (i === 0 ? ' on' : ''); b.textContent = v.label;
  b.onclick = () => switchVibe(v, b);
  nav.append(b);
});

async function switchVibe(v, btn) {
  const fromHome = pos < -0.5;
  nav.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === btn));
  if (v === feed.vibe) { if (fromHome) leaveHome(); return; }
  player.stop(); playingIdx = -1; uiIdx = -1; gesture = false; stable = 0;
  pool.clear(); feed.reset(v);
  target = pos = fromHome ? -1 : -0.3;
  els.loader.hidden = false;
  const n = await feed.more();
  els.loader.hidden = true;
  if (!n) { toast('Could not reach the music server. Retrying…'); return; }
  feed.more();
  if (fromHome) leaveHome(); else { target = 0; setActive(0); startPlay(0); }
}

(async function boot() {
  const n = await feed.more();
  if (n > 0) { els.start.disabled = false; els.start.textContent = 'Start listening'; setActive(0); feed.more(); }
  else {
    els.start.disabled = false; els.start.textContent = 'Try again';
    els.note.textContent = 'The music servers did not answer. Check your connection, then try again.';
    els.start.onclick = () => location.reload();
  }
})();

// ---------- colours: the whole page takes the colour of the record in the centre ----------
const HOME_COLOR = new THREE.Color('#5a3cff');
const hsl = {}, bgT = new THREE.Color(), bg = new THREE.Color('#2a1f8f'), bg2 = new THREE.Color(), bgd = new THREE.Color(), fog = new THREE.Color();
function toBg(c, out) {
  c.getHSL(hsl, THREE.SRGBColorSpace);
  return out.setHSL(hsl.h, clamp(hsl.s, 0.55, 0.8), 0.34, THREE.SRGBColorSpace);
}

// ---------- main loop ----------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastTime) / 1000); lastTime = now; time += dt; frameN++;
  const songs = feed.songs;

  if (gesture && !drag && now - lastInput > 130) settle();
  pos = damp(pos, target, 5.5, dt);
  vel = damp(vel, (pos - prevPos) / Math.max(dt, 1e-3), 10, dt);
  prevPos = pos;

  const home = pos < -0.5;
  const h = clamp(-pos, 0, 1);                       // 1 on the home screen, 0 once you are on a song
  const showPos = pos < 0 ? pos * 0.35 : pos;        // the home screen is a short hop in front of song 1
  const idx = clamp(Math.round(pos), 0, Math.max(0, songs.length - 1));
  if (songs.length && !home && idx !== uiIdx) setActive(idx);
  if (frameN % 4 === 0) document.body.classList.toggle('home', home);

  // the song that reaches the centre starts playing
  if (!home && songs.length) {
    if (Math.abs(pos - idx) < 0.14 && !gesture && !drag) {
      stable += dt;
      if (stable > 0.3 && playingIdx !== idx && !blocked) startPlay(idx);
    } else stable = 0;
  } else if (pos < -0.8 && playingIdx >= 0) { player.stop(); playingIdx = -1; }

  // endless: prefetch aggressively — start loading well before the user runs out
  if (songs.length && idx > songs.length - 12 && !feed.loading && now > feed.retryAt) {
    els.loader.hidden = false;
    feed.more().then(() => { els.loader.hidden = true; });
  }

  player.update(dt, time);
  const e = player.energy;

  // colour
  const cur = songs[idx];
  toBg(home || !cur ? HOME_COLOR : (cur.color || HOME_COLOR), bgT);
  bg.lerp(bgT, 1 - Math.exp(-dt * 3));
  if (frameN % 3 === 0) {
    bg2.copy(bg).offsetHSL(0, -0.05, 0.12);
    bgd.copy(bg).offsetHSL(0, 0, -0.17);
    const st = root.style;
    st.setProperty('--bg', '#' + bg.getHexString());
    st.setProperty('--bg2', '#' + bg2.getHexString());
    st.setProperty('--bgd', '#' + bgd.getHexString());
    st.setProperty('--ui', clamp((0.7 - h) / 0.7, 0, 1).toFixed(3));
    st.setProperty('--hero', h.toFixed(3));
  }
  fog.copy(bg).lerp(bg2, 0.3);

  // hero slides away as you scroll; the big title drifts with the scroll
  const ho = clamp((h - 0.15) / 0.85, 0, 1);
  els.hero.style.opacity = ho.toFixed(3);
  els.hero.style.transform = `translate3d(0,${(-(1 - h) * 38).toFixed(2)}vh,0)`;
  const off = pos - uiIdx;
  const bo = home ? 0 : clamp(1 - Math.abs(off) * 1.7, 0, 1) * clamp(1 - h * 2, 0, 1);
  els.big.style.opacity = bo.toFixed(3);
  els.big.style.transform = `translate3d(0,${(-off * 55).toFixed(2)}vh,0) scale(${(1 + Math.abs(off) * 0.12).toFixed(3)})`;

  pool.sync(showPos, songs);
  pool.update(showPos, time, dt, player.playing, e.bass);
  stage.update({ pos: showPos, vel, time, dt, energy: e, fogColor: fog, homeAmt: h, mouse });
  stage.render();

  // player ui
  const d = player.duration || cur?.duration || 0;
  els.fill.style.transform = `scaleX(${d ? clamp(player.time / d, 0, 1) : 0})`;
  els.numbar.style.transform = `scaleX(${songs.length ? (idx + 1) / songs.length : 0})`;
  if (frameN % 8 === 0) { els.tcur.textContent = fmt(player.time); if (d) els.tdur.textContent = fmt(d); }

  // adaptive quality: if frames are slow, quietly lower the render resolution
  if (time > 4) {
    fpsAcc += dt; fpsN++;
    if (fpsN >= 60) {
      if (fpsAcc / fpsN > 0.027 && stage.getPR() > 0.75) stage.setPixelRatio(Math.max(0.75, stage.getPR() - 0.25));
      fpsAcc = 0; fpsN = 0;
    }
  }
}
requestAnimationFrame(frame);
