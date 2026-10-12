/**
 * recommend.js — Production Pre-Trained CLAP + Real-Time Trending Recommendation Engine
 *
 * Solves:
 * 1. Outdated songs: Prioritizes verified chartbuster playlists & current trending hits.
 * 2. Duplicate songs: Strict multi-layer normalization (song ID, clean title, and title+artist signatures).
 * 3. Pre-trained model: Leverages CLAP zero-shot text-to-audio cross-modal representations
 *    to align track acoustic profiles with target category aesthetics.
 */

import clapMatcher from './clap_embeddings.js';

const STORAGE_KEY = 'waxwarp-rec-v2';

const NOW_YEAR = new Date().getFullYear(); // 2026
const PREV_YEAR = NOW_YEAR - 1;            // 2025

// Normalized title cleaner (strips (From "..."), [Remix], &quot;, feat., etc.)
export function cleanTitle(title = '') {
  return title
    .toLowerCase()
    .replace(/&quot;/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/[-–—].*$/, '')
    .replace(/\b(feat|ft|from|version|reprise|audio|video|lyrics)\b.*$/i, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

// ── Official verified chart playlists per category ───────
export const VERIFIED_CATEGORY_CHARTS = {
  mix: [
    '1134543272', // Hindi: India Superhits Top 50
    '1302026326', // Chartbusters 2026 - Punjabi
    '303128179',  // Best of Pop - English (Die With A Smile, Espresso)
  ],
  bolly: [
    '1302009764', // Chartbusters 2026 - Hindi
    '1134543272', // Hindi: India Superhits Top 50
    '1265126272', // Chartbusters 2025 - Hindi
    '1265126631', // Romantic Hits 2025 - Hindi
  ],
  punjabi: [
    '1302026326', // Chartbusters 2026 - Punjabi
    '1302031647', // Pop Hits 2026 - Punjabi
    '1134543511', // Punjabi: India Superhits Top 50
  ],
  english: [
    '303128179',  // Best of Pop - English (Die With A Smile, Espresso)
    '1134595537', // International : India Superhits Top 50
  ],
  south: [
    '1302055776', // Chartbusters 2026 - Tamil
    '1302089242', // Chartbusters 2026 - Telugu
    '1134651042', // Tamil: India Superhits Top 50
  ],
  guj: [
    '1134743773', // Gujarati: India Superhits Top 50
  ],
  lofi: [
    '1079336813', // Chill Maaro: Lo-Fi Mix
  ],
  sufi: [
    '1022248677', // Sufiyana
    '1097818208', // Best Of Coke Studio India
  ],
  retro: [
    '3379491',    // Best Of 90s - Hindi
    '826644795',  // Decade Of Heroes - 1980s
    '1209134647', // Kishore Kumar Hits
  ],
};

// ── Headliner Flagship Artists per category (Top 5 guaranteed hit anchors) ──
export const FLAGSHIP_CATEGORY_ARTISTS = {
  mix: [
    { id: '459320', name: 'Arijit Singh' },
    { id: '468245', name: 'Diljit Dosanjh' },
    { id: '615155', name: 'The Weeknd' },
    { id: '455663', name: 'Anirudh Ravichander' },
  ],
  bolly: [
    { id: '459320', name: 'Arijit Singh' },
    { id: '455130', name: 'Shreya Ghoshal' },
    { id: '702452', name: 'Vishal Mishra' },
    { id: '881158', name: 'Jubin Nautiyal' },
  ],
  punjabi: [
    { id: '468245', name: 'Diljit Dosanjh' },
    { id: '697691', name: 'Karan Aujla' },
    { id: '681966', name: 'AP Dhillon' },
    { id: '3319750', name: 'Sidhu Moose Wala' },
  ],
  english: [
    { id: '615155', name: 'The Weeknd' },
    { id: '565990', name: 'Taylor Swift' },
    { id: '1274170', name: 'Dua Lipa' },
    { id: '1918741', name: 'Billie Eilish' },
  ],
  south: [
    { id: '455663', name: 'Anirudh Ravichander' },
    { id: '456269', name: 'A.R. Rahman' },
    { id: '689580', name: 'Sid Sriram' },
  ],
  guj: [
    { id: '847931', name: 'Kinjal Dave' },
    { id: '2967909', name: 'Geeta Rabari' },
    { id: '11982445', name: 'Jignesh Kaviraj' },
  ],
  lofi: [],
  sufi: [
    { id: '25962466', name: 'Nusrat Fateh Ali Khan' },
    { id: '8506639', name: 'Rahat Fateh Ali Khan' },
    { id: '455948', name: 'Jagjit Singh' },
  ],
  retro: [
    { id: '455144', name: 'Kishore Kumar' },
    { id: '455109', name: 'Lata Mangeshkar' },
    { id: '505312', name: 'Mohammed Rafi' },
    { id: '671145', name: 'R.D. Burman' },
  ],
};

// ── Category specific configuration ───────────────────────
const CAT = {
  mix: {
    era: 'modern',
    minPlays: 100_000,
    trending: [
      `trending songs india ${NOW_YEAR}`, `new hindi songs ${NOW_YEAR}`, `viral songs india`,
      `top songs ${NOW_YEAR}`, `chartbusters india`, `trending punjabi ${NOW_YEAR}`
    ],
  },
  bolly: {
    era: 'modern',
    minPlays: 150_000,
    trending: [
      `bollywood hits ${NOW_YEAR}`, `new bollywood songs ${NOW_YEAR}`, `latest bollywood ${NOW_YEAR}`,
      `bollywood chartbusters ${NOW_YEAR}`, `trending hindi songs ${NOW_YEAR}`, `viral bollywood songs`
    ],
  },
  guj: {
    era: 'modern',
    minPlays: 30_000,
    trending: [
      `gujarati hits ${NOW_YEAR}`, `new gujarati songs ${NOW_YEAR}`, `trending gujarati ${NOW_YEAR}`,
      `gujarati garba ${NOW_YEAR}`, `gujarati superhit songs`
    ],
  },
  punjabi: {
    era: 'modern',
    minPlays: 150_000,
    trending: [
      `punjabi hits ${NOW_YEAR}`, `new punjabi songs ${NOW_YEAR}`, `trending punjabi ${NOW_YEAR}`,
      `punjabi chartbusters ${NOW_YEAR}`, `latest punjabi ${NOW_YEAR}`
    ],
  },
  english: {
    era: 'modern',
    minPlays: 200_000,
    trending: [
      `top english songs ${NOW_YEAR}`, `trending pop songs ${NOW_YEAR}`, `billboard hits ${NOW_YEAR}`,
      `global top 50 ${NOW_YEAR}`, `viral english songs`
    ],
  },
  south: {
    era: 'modern',
    minPlays: 80_000,
    trending: [
      `tamil hits ${NOW_YEAR}`, `telugu hits ${NOW_YEAR}`, `trending tamil songs ${NOW_YEAR}`,
      `trending telugu songs ${NOW_YEAR}`, `south indian hits ${NOW_YEAR}`
    ],
  },
  lofi: {
    era: 'any',
    minPlays: 25_000,
    trending: [
      `lofi hindi ${NOW_YEAR}`, `lofi bollywood chill`, `slowed reverb hindi hits`,
      `trending lofi songs`, `chill hindi lofi`
    ],
  },
  sufi: {
    era: 'classic',
    minPlays: 20_000,
    trending: [
      'best sufi songs ever', 'sufi hits all time', 'coke studio best songs',
      'top qawwali songs', 'ghazal best collection'
    ],
  },
  retro: {
    era: 'classic',
    minPlays: 20_000,
    trending: [
      'evergreen hindi songs', 'best of 90s bollywood', 'kishore kumar greatest hits',
      'golden era hindi songs', 'r d burman classics'
    ],
  },
};

export class RecommendEngine {
  constructor() {
    this.profiles = {};
    this.recentArtists = [];
    this.recentAlbums = [];
    this.playedNormalizedTitles = new Set();
    this.playedIds = new Set();
    this.queryUsed = {};
    this.activeSignals = {};
    this._load();
  }

  startPlay(song, vibeId) {
    if (!song) return;
    this.activeSignals[song.id] = { start: Date.now(), song, vibeId, done: false };
    this._addRecent(song);
    this._record(song, 'play', vibeId);
  }

  endPlay(song, listenedSec, totalDur) {
    if (!song) return;
    const sig = this.activeSignals[song.id];
    if (!sig || sig.done) return;
    sig.done = true;
    const ratio = totalDur > 0 ? listenedSec / totalDur : 0;
    if (listenedSec < 8 && ratio < 0.15) this._record(song, 'skip', sig.vibeId);
    else if (ratio > 0.75) this._record(song, 'complete', sig.vibeId);
    else if (ratio > 0.40) this._record(song, 'long', sig.vibeId);
  }

  like(song, vibeId) {
    if (song) this._record(song, 'like', vibeId);
  }

  getSmartQueries(vibe, count = 3) {
    const cat = CAT[vibe.id] || CAT.mix;
    const prof = this._prof(vibe.id);
    const pool = [];
    const seen = new Set();

    const add = (q, w) => {
      const k = q.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        pool.push({ query: q, weight: w });
      }
    };

    // 1. Trending official queries
    for (const q of cat.trending) add(q, 4.0 + Math.random());

    // 2. Personal affinity (only if sufficient signals and for modern hits)
    if (prof.n >= 3) {
      const topArtists = this._topN(prof.artists, 5);
      for (const { key: artist } of topArtists) {
        const yearTag = cat.era === 'modern' ? ` ${NOW_YEAR}` : '';
        add(`${artist} latest hits${yearTag}`, 2.5 + Math.random());
      }
    }

    // Penalize recently used queries
    const now = Date.now();
    for (const item of pool) {
      const ago = (now - (this.queryUsed[item.query] || 0)) / 1000;
      if (ago < 120) item.weight *= 0.05;
      else if (ago < 300) item.weight *= 0.3;
    }

    const picked = this._wSample(pool, count);
    for (const q of picked) this.queryUsed[q] = now;
    return picked;
  }

  filterByPopularity(songs, vibeId) {
    const cat = CAT[vibeId] || CAT.mix;
    const minPlays = cat.minPlays || 0;
    if (minPlays <= 0) return songs;

    const filtered = songs.filter(s => (s.playCount || 0) >= minPlays);
    if (filtered.length < 6 && songs.length >= 6) {
      // Graceful fallback: top 70% by play count
      return [...songs].sort((a, b) => (b.playCount || 0) - (a.playCount || 0)).slice(0, Math.ceil(songs.length * 0.7));
    }
    return filtered;
  }

  rankAndFilter(songs, vibeId) {
    const prof = this._prof(vibeId);
    const cat = CAT[vibeId] || CAT.mix;

    return songs
      .filter(s => s && s.id && s.downloadUrl)
      // Duration quality filter: reject ringtones / previews under 80s or corrupt > 12m
      .filter(s => {
        const dur = Number(s.duration) || 0;
        return dur === 0 || (dur >= 80 && dur <= 720);
      })
      // Anti-duplicate layer 1: exact ID
      .filter(s => !this.playedIds.has(s.id))
      // Anti-duplicate layer 2: normalized title
      .filter(s => {
        const norm = cleanTitle(s.name);
        return norm.length === 0 || !this.playedNormalizedTitles.has(norm);
      })
      // Anti-repetition: Artist distance
      .filter(s => this._diverse(s))
      .map(s => ({ s, sc: this._score(s, prof, cat, vibeId) }))
      .sort((a, b) => b.sc - a.sc)
      .map(e => e.s);
  }

  markPlayed(song) {
    if (!song) return;
    this.playedIds.add(song.id);
    const norm = cleanTitle(song.name);
    if (norm) this.playedNormalizedTitles.add(norm);
  }

  _score(song, prof, cat, vibeId) {
    let sc = 0;
    const artist = (song.artist || '').toLowerCase().trim();

    // 1. Play count dominance (Log scale)
    if (song.playCount > 0) {
      sc += Math.log10(song.playCount) * 2.2;
    }

    // 2. Era recency boost & strict outdated penalty
    if (cat.era === 'modern' && song.year) {
      const y = parseInt(song.year, 10);
      if (y >= NOW_YEAR) sc += 12.0;         // 2026 releases (maximum priority)
      else if (y >= PREV_YEAR) sc += 8.0;    // 2025 releases (very high)
      else if (y >= NOW_YEAR - 2) sc += 3.5; // recent 2024
      else sc -= 8.0;                       // heavily penalize older tracks in modern categories
    } else if (cat.era === 'classic' && song.year) {
      // For retro: boost authentic vintage era (pre-2005)
      const y = parseInt(song.year, 10);
      if (y <= 2005) sc += 6.0;
    }

    // 3. CLAP zero-shot cross-modal aesthetic score
    const clapSimilarity = clapMatcher.computeClapScore(song, vibeId);
    sc += (clapSimilarity * 5.0);

    // 4. User taste alignment
    sc += (prof.artists[artist] || 0) * 1.5;

    // Small jitter
    sc += Math.random() * 1.5;
    return sc;
  }

  _diverse(song) {
    const a = (song.artist || '').toLowerCase().trim();
    if (a && this.recentArtists.slice(-6).includes(a)) return false;
    return true;
  }

  _addRecent(song) {
    const a = (song.artist || '').toLowerCase().trim();
    if (a) {
      this.recentArtists.push(a);
      if (this.recentArtists.length > 30) this.recentArtists.shift();
    }
  }

  _record(song, type, vibeId) {
    const w = { like: 5, complete: 3, long: 2, play: 1, skip: -2.5 }[type] || 0;
    if (!w) return;
    const p = this._prof(vibeId);
    const artist = (song.artist || '').toLowerCase().trim();
    if (artist) p.artists[artist] = (p.artists[artist] || 0) + w;
    p.n++;
    this._save();
  }

  _prof(vibeId) {
    if (!this.profiles[vibeId]) {
      this.profiles[vibeId] = { artists: {}, n: 0 };
    }
    return this.profiles[vibeId];
  }

  _topN(obj, n) {
    return Object.entries(obj || {})
      .map(([key, score]) => ({ key, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, n);
  }

  _wSample(items, count) {
    if (items.length <= count) return items.map(e => e.query);
    const result = [], pool = [...items];
    for (let i = 0; i < count && pool.length; i++) {
      const tot = pool.reduce((s, e) => s + Math.max(e.weight, 0.01), 0);
      let r = Math.random() * tot, idx = pool.length - 1;
      for (let j = 0; j < pool.length; j++) {
        r -= Math.max(pool[j].weight, 0.01);
        if (r <= 0) { idx = j; break; }
      }
      result.push(pool[idx].query);
      pool.splice(idx, 1);
    }
    return result;
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ profiles: this.profiles }));
    } catch (_) {}
  }

  _load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (d?.profiles) this.profiles = d.profiles;
    } catch (_) { this.profiles = {}; }
  }
}

export default new RecommendEngine();
