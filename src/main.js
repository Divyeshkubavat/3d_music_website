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
let lastInput = 0, drag = null;
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
  const n = clean.length;
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  els.big.style.fontSize = isMobile
    ? (n <= 9 ? '22vw' : n <= 16 ? '16vw' : n <= 28 ? '12vw' : '9vw')
    : (n <= 9 ? '19vw' : n <= 16 ? '14vw' : n <= 28 ? '10vw' : '7.5vw');
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

// ---------- scrolling & navigation ----------
function seenHint() { if (!hintGone) { hintGone = true; els.hint.classList.add('gone'); } }

function step(n) {
  if (!feed.songs.length) return;
  // Step exactly 1 song cleanly
  const current = Math.round(target);
  target = clamp(current + n, -1, maxIdx());
  lastInput = performance.now();
  seenHint();
}

// Trackpad & mouse wheel handling with inertia filtering and debounce
let wheelAcc = 0;
let wheelCooldownUntil = 0;
let wheelLastTime = 0;
let wheelLastDir = 0;

addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!feed.songs.length) return;

  const now = performance.now();
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 28; // lines to px
  else if (e.deltaMode === 2) dy *= 500; // pages to px

  // If user paused for > 160ms, the previous gesture has ended; reset
  if (now - wheelLastTime > 160) {
    wheelAcc = 0;
    wheelCooldownUntil = 0;
  }
  wheelLastTime = now;

  const currentDir = Math.sign(dy);

  // If currently in cooldown from trackpad momentum inertia
  if (now < wheelCooldownUntil) {
    // If the user intentionally reversed scroll direction, cancel cooldown immediately
    if (currentDir !== 0 && currentDir !== wheelLastDir) {
      wheelCooldownUntil = 0;
      wheelAcc = 0;
    } else {
      return; // Ignore momentum inertia events!
    }
  }

  wheelAcc += dy;
  const THRESHOLD = 50; // Smooth threshold to step 1 song
  if (Math.abs(wheelAcc) >= THRESHOLD) {
    const dir = Math.sign(wheelAcc);
    wheelLastDir = dir;
    wheelAcc = 0;
    step(dir);
    // Lock for 320ms to swallow trackpad inertia decay
    wheelCooldownUntil = now + 320;
  }
}, { passive: false });

addEventListener('keydown', (e) => {
  const k = e.key;
  if (['ArrowDown', 'ArrowRight', 'PageDown', 'j'].includes(k)) { e.preventDefault(); step(1); }
  else if (['ArrowUp', 'ArrowLeft', 'PageUp', 'k'].includes(k)) { e.preventDefault(); step(-1); }
  else if (k === ' ' && document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); player.toggle(); }
  else if (k === 'm') toggleMute();
  else if (k === 'l') toggleLike();
});

// Touch and pointer dragging on canvas
const canvas = $('#gl');
canvas.addEventListener('pointerdown', (e) => {
  if (!feed.songs.length) return;
  canvas.setPointerCapture?.(e.pointerId);
  const startIdx = Math.round(target);
  drag = {
    pointerId: e.pointerId,
    sy: e.clientY,
    sx: e.clientX,
    startIdx,
    moved: false,
    ly: e.clientY,
    lt: performance.now(),
    vy: 0,
    startTime: performance.now()
  };
});

addEventListener('pointermove', (e) => {
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = -((e.clientY / innerHeight) * 2 - 1);
  if (!drag || (drag.pointerId !== undefined && e.pointerId !== drag.pointerId)) return;

  const dy = drag.sy - e.clientY;
  const dx = drag.sx - e.clientX;
  if (Math.abs(dy) > 7 || Math.abs(dx) > 7) drag.moved = true;

  if (drag.moved) {
    const now = performance.now();
    const dt = Math.max(1, now - drag.lt);
    const instV = (drag.ly - e.clientY) / dt;
    drag.vy = drag.vy * 0.5 + instV * 0.5;
    drag.ly = e.clientY;
    drag.lt = now;

    // While dragging, move target smoothly with finger within [-1.15, 1.15]
    // so user gets 1:1 tactile visual feedback without wild multi-song flinging
    const dragSpan = Math.max(260, innerHeight * 0.55);
    const offset = clamp(dy / dragSpan, -1.15, 1.15);
    target = clamp(drag.startIdx + offset, -1, maxIdx());
    lastInput = now;
    seenHint();
  }
});

const endDrag = (e) => {
  if (!drag || (drag.pointerId !== undefined && e.pointerId !== undefined && e.pointerId !== drag.pointerId)) return;
  const d = drag;
  drag = null;

  if (d.moved) {
    const totalDy = d.sy - e.clientY;
    const dur = Math.max(1, performance.now() - d.startTime);
    const avgV = totalDy / dur;

    // Determine if swipe was intentional:
    // Either moved > 40px or fast flick > 0.35 px/ms with > 16px displacement
    let delta = 0;
    if (totalDy > 40 || (d.vy > 0.35 && totalDy > 16) || (avgV > 0.35 && totalDy > 16)) {
      delta = 1;
    } else if (totalDy < -40 || (d.vy < -0.35 && totalDy < -16) || (avgV < -0.35 && totalDy < -16)) {
      delta = -1;
    }

    // Step at most 1 song from where the touch started!
    target = clamp(d.startIdx + delta, -1, maxIdx());
    seenHint();
  } else {
    // Tap without drag: raycast to pick record
    ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), stage.camera);
    const hit = pool.pick(ray);
    if (hit >= 0) {
      if (hit === Math.round(target)) player.toggle();
      else target = hit;
    }
  }
};

addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag);

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
const seekEl = $('#seek');
let seeking = false;
function updateSeek(e) {
  const r = seekEl.getBoundingClientRect();
  const pct = clamp((e.clientX - r.left) / r.width, 0, 1);
  player.seek(pct);
}
seekEl.addEventListener('pointerdown', (e) => {
  seeking = true;
  seekEl.setPointerCapture?.(e.pointerId);
  updateSeek(e);
});
seekEl.addEventListener('pointermove', (e) => {
  if (seeking) updateSeek(e);
});
const stopSeek = () => { seeking = false; };
seekEl.addEventListener('pointerup', stopSeek);
seekEl.addEventListener('pointercancel', stopSeek);
seekEl.addEventListener('keydown', (e) => {
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
  target = 0;
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
  player.stop(); playingIdx = -1; uiIdx = -1; stable = 0;
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
    if (Math.abs(pos - idx) < 0.14 && !drag) {
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
