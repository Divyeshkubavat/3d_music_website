import { clamp, damp, hash } from './util.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Two <audio> elements: one with CORS (so we can read real frequency data),
 * and a plain one used when the CDN refuses CORS. In that case the visuals
 * run on a synthetic beat instead of the real spectrum.
 */
export class Player {
  constructor() {
    this.cors = new Audio();
    this.cors.crossOrigin = 'anonymous';
    this.cors.preload = 'auto';
    this.plain = new Audio();
    this.plain.preload = 'auto';
    this.active = this.cors;
    this.vol = 0.9; this.muted = false;
    this.fade = 1; this.fadeTo = 1;
    this.playing = false; this.analysable = false;
    this.switching = false; this.token = 0; this.song = null;
    this.energy = { bass: 0, mid: 0, high: 0 };
    this.ctx = null; this.analyser = null; this.gain = null; this.data = null;
    this.silent = 0;
    this.onend = () => {}; this.onblocked = () => {}; this.onerror = () => {}; this.onstate = () => {};

    for (const el of [this.cors, this.plain]) {
      el.addEventListener('ended', () => { if (el === this.active) this.onend(); });
      el.addEventListener('playing', () => { if (el === this.active) { this.playing = true; this.onstate(true); } });
      el.addEventListener('pause', () => {
        if (el === this.active && !this.switching && !el.ended) { this.playing = false; this.onstate(false); }
      });
    }
  }

  init() {
    if (this.inited) { if (this.ctx) this.ctx.resume(); return; }
    this.inited = true;
    // Unlock both elements inside the user's click (iOS/Safari need this before later play() calls).
    const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
    for (const el of [this.cors, this.plain]) { try { el.src = SILENT; el.play().catch(() => {}); } catch (e) {} }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      const src = this.ctx.createMediaElementSource(this.cors);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.78;
      this.gain = this.ctx.createGain();
      src.connect(this.analyser);
      this.analyser.connect(this.gain);
      this.gain.connect(this.ctx.destination);
      this.data = new Uint8Array(this.analyser.frequencyBinCount);
      this.ctx.resume();
    } catch (e) { this.ctx = null; this.gain = null; }
  }

  async play(song) {
    const tk = ++this.token;
    this.song = song;
    this.switching = true;
    this.fadeTo = 0;
    await sleep(150);
    if (tk !== this.token) return;
    this.cors.pause(); this.plain.pause();
    const attempt = async (el) => { el.src = song.downloadUrl; el.load(); await el.play(); };
    let ok = false;
    try {
      this.active = this.cors; this.analysable = !!this.ctx; this.silent = 0;
      await attempt(this.cors); ok = true;
    } catch (e) {
      if (tk !== this.token) return;
      if (e && e.name === 'NotAllowedError') { this.switching = false; this.onblocked(); return; }
      this.cors.removeAttribute('src'); this.cors.load();
    }
    if (!ok) {
      try {
        this.active = this.plain; this.analysable = false;
        await attempt(this.plain); ok = true;
      } catch (e) {
        if (tk !== this.token) return;
        this.switching = false;
        if (e && e.name === 'NotAllowedError') { this.onblocked(); return; }
        this.onerror(song);
        return;
      }
    }
    if (tk !== this.token) return;
    this.switching = false;
    this.fadeTo = 1;
    this.playing = true;
    this.onstate(true);
  }

  stop() {
    this.token++;
    this.switching = false;
    this.cors.pause(); this.plain.pause();
    this.playing = false; this.song = null;
    this.onstate(false);
  }

  toggle() {
    const el = this.active;
    if (!this.song) return;
    if (this.ctx) this.ctx.resume();
    if (el.paused) el.play().catch(() => {}); else el.pause();
  }

  seek(frac) {
    const d = this.duration;
    if (d) this.active.currentTime = clamp(frac, 0, 1) * d;
  }

  setVolume(v) { this.vol = clamp(v, 0, 1); }
  toggleMute() { this.muted = !this.muted; return this.muted; }

  get time() { return this.active.currentTime || 0; }
  get duration() { return isFinite(this.active.duration) && this.active.duration > 0 ? this.active.duration : (this.song?.duration || 0); }

  update(dt, t) {
    this.fade = damp(this.fade, this.fadeTo, 12, dt);
    const v = (this.muted ? 0 : this.vol) * this.fade;
    if (this.gain && this.active === this.cors) { this.gain.gain.value = v; this.cors.volume = 1; }
    else this.active.volume = clamp(v, 0, 1);

    let bass = 0.04, mid = 0.04, high = 0.04;
    if (this.playing) {
      let real = false;
      if (this.analysable && this.analyser) {
        this.analyser.getByteFrequencyData(this.data);
        const d = this.data;
        const avg = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += d[i]; return s / (b - a) / 255; };
        const b0 = avg(0, 5), m0 = avg(5, 40), h0 = avg(40, 140);
        if (b0 + m0 + h0 > 0.002) { real = true; this.silent = 0; }
        else this.silent += dt;
        if (real) {
          bass = clamp(Math.pow(b0, 1.6) * 1.9, 0, 1);
          mid = clamp(m0 * 1.6, 0, 1);
          high = clamp(h0 * 2.6, 0, 1);
        }
      }
      if (!real && !(this.analysable && this.silent < 1)) {
        const bpm = 92 + (hash(this.song?.id || 'x') % 44);
        const ph = (t * bpm / 60) % 1;
        const kick = Math.exp(-ph * 6);
        const off = Math.exp(-((ph + 0.5) % 1) * 9) * 0.5;
        bass = 0.12 + 0.75 * kick;
        mid = 0.28 + 0.3 * off + 0.1 * Math.sin(t * 3);
        high = 0.2 + 0.25 * Math.abs(Math.sin(t * 9.3) * Math.sin(t * 5.1));
      }
    }
    const e = this.energy;
    e.bass = damp(e.bass, bass, bass > e.bass ? 28 : 7, dt);
    e.mid = damp(e.mid, mid, mid > e.mid ? 18 : 6, dt);
    e.high = damp(e.high, high, high > e.high ? 22 : 8, dt);
  }
}
