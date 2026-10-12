import saavn from './saavn.js';
import rec, { VERIFIED_CATEGORY_CHARTS, FLAGSHIP_CATEGORY_ARTISTS, cleanTitle } from './recommend.js';

export const VIBES = [
  { id: 'mix', label: 'Everything', queries: ['top hindi hits', 'punjabi hits', 'english pop hits', 'trending india'] },
  { id: 'bolly', label: 'Bollywood', queries: ['top bollywood hits', 'new hindi songs', 'trending bollywood'] },
  { id: 'guj', label: 'Gujarati', queries: ['top gujarati hits', 'gujarati garba', 'new gujarati songs'] },
  { id: 'punjabi', label: 'Punjabi', queries: ['punjabi hits', 'trending punjabi', 'top punjabi songs'] },
  { id: 'english', label: 'English', queries: ['top english songs', 'trending pop songs', 'billboard hits'] },
  { id: 'south', label: 'South', queries: ['tamil hits', 'telugu hits', 'trending south songs'] },
  { id: 'lofi', label: 'Lo-fi', queries: ['lofi hindi', 'lofi chill', 'slowed reverb hindi'] },
  { id: 'sufi', label: 'Sufi and ghazal', queries: ['best sufi songs', 'coke studio best', 'ghazal hits'] },
  { id: 'retro', label: 'Retro', queries: ['evergreen hindi songs', '90s bollywood hits', 'kishore kumar hits'] },
];

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

export class Feed {
  constructor() {
    this.gen = 0;
    this.reset(VIBES[0]);
  }

  reset(vibe) {
    this.vibe = vibe;
    this.songs = [];
    this.seenIds = new Set();
    this.seenTitles = new Set();
    this.loading = false;
    this.fails = 0;
    this.retryAt = 0;
    this.gen++;
    this._prefetchBuf = [];
    this._prefetching = null;
    this._chartIndex = 0;
    this._flagshipLoaded = false;
  }

  async more() {
    if (this.loading) return 0;
    this.loading = true;
    const gen = this.gen;
    let added = 0;

    try {
      // Fast path: drain prefetch buffer if available
      if (this._prefetchBuf.length > 0) {
        const fresh = this._drain();
        this.songs.push(...fresh);
        added = fresh.length;
        this._bgPrefetch(gen);
        if (gen === this.gen) { this.loading = false; this.fails = 0; }
        return added;
      }

      // Step 1: For initial loads, prioritize verified chartbuster playlists first
      const chartIds = VERIFIED_CATEGORY_CHARTS[this.vibe.id] || [];
      if (this.songs.length < 20 && this._chartIndex < chartIds.length) {
        const targetChartId = chartIds[this._chartIndex++];
        const chartSongs = await saavn.getPlaylistById(targetChartId);
        if (gen !== this.gen) return 0;

        if (chartSongs && chartSongs.length > 0) {
          const deduped = this._dedup(chartSongs);
          const ranked = rec.rankAndFilter(deduped, this.vibe.id);
          for (const s of ranked) rec.markPlayed(s);
          this.songs.push(...ranked);
          added = ranked.length;
        }
      }

      // Step 2: Headliner Artist Top-5 Anchors (Guarantees true masterpieces with zero filler)
      const flagshipArtists = FLAGSHIP_CATEGORY_ARTISTS[this.vibe.id] || [];
      if (added < 15 && flagshipArtists.length > 0 && !this._flagshipLoaded) {
        this._flagshipLoaded = true;
        // Fetch top tracks for up to 3 flagship artists in parallel
        const artistFetches = flagshipArtists.slice(0, 3).map(a => saavn.getArtistTopSongs(a.id, 5));
        const artistResults = await Promise.allSettled(artistFetches);
        if (gen !== this.gen) return 0;

        const anchorSongs = [];
        for (const res of artistResults) {
          if (res.status === 'fulfilled' && Array.isArray(res.value)) {
            anchorSongs.push(...res.value);
          }
        }
        if (anchorSongs.length > 0) {
          const deduped = this._dedup(anchorSongs);
          const ranked = rec.rankAndFilter(deduped, this.vibe.id);
          for (const s of ranked) rec.markPlayed(s);
          this.songs.push(...ranked);
          added += ranked.length;
        }
      }

      // Step 3: Parallel trending search queries if still needed
      if (added < 10) {
        const queries = rec.getSmartQueries(this.vibe, 3);
        const raw = await saavn.searchParallel(queries, 25);
        if (gen !== this.gen) return 0;

        const deduped = this._dedup(raw);
        const popularOnly = rec.filterByPopularity(deduped, this.vibe.id);
        const ranked = rec.rankAndFilter(popularOnly, this.vibe.id);
        const batch = this._smartShuffle(ranked);

        for (const s of batch) rec.markPlayed(s);
        this.songs.push(...batch);
        added += batch.length;
      }

      // Background prefetch
      this._bgPrefetch(gen);

    } catch (e) { /* error handled below */ }

    if (gen === this.gen) {
      this.loading = false;
      if (added === 0) {
        this.fails++;
        this.retryAt = performance.now() + Math.min(6000, 1500 * this.fails);
      } else {
        this.fails = 0;
      }
    }
    return added;
  }

  _dedup(songs) {
    const out = [];
    for (const s of songs) {
      if (!s || !s.id || !s.downloadUrl) continue;
      
      // ID check
      if (this.seenIds.has(s.id)) continue;

      // Clean title check (catches duplicate versions like "Gehra Hua", "Gehra Hua (From...)")
      const norm = cleanTitle(s.name);
      if (norm && this.seenTitles.has(norm)) continue;

      this.seenIds.add(s.id);
      if (norm) this.seenTitles.add(norm);
      out.push(s);
    }
    return out;
  }

  _smartShuffle(songs) {
    if (songs.length <= 4) return shuffle([...songs]);
    // Keeps highest ranked (trending chart toppers) in the upper half
    const half = Math.ceil(songs.length / 2);
    const topHalf = shuffle(songs.slice(0, half));
    const lowerHalf = shuffle(songs.slice(half));
    const out = [];
    let i = 0, j = 0;
    while (i < topHalf.length || j < lowerHalf.length) {
      if (i < topHalf.length) out.push(topHalf[i++]);
      if (i < topHalf.length) out.push(topHalf[i++]); // 2 top tier
      if (j < lowerHalf.length) out.push(lowerHalf[j++]); // 1 lower tier
    }
    return out;
  }

  _bgPrefetch(gen) {
    if (this._prefetching) return;
    this._prefetching = (async () => {
      try {
        const queries = rec.getSmartQueries(this.vibe, 3);
        const raw = await saavn.searchParallel(queries, 25);
        if (gen !== this.gen) return;
        this._prefetchBuf = raw.filter(s => s && s.id && s.downloadUrl);
      } catch (e) {}
      finally { this._prefetching = null; }
    })();
  }

  _drain() {
    const buf = this._prefetchBuf;
    this._prefetchBuf = [];
    const deduped = this._dedup(buf);
    const popularOnly = rec.filterByPopularity(deduped, this.vibe.id);
    const ranked = rec.rankAndFilter(popularOnly, this.vibe.id);
    const batch = this._smartShuffle(ranked);
    for (const s of batch) rec.markPlayed(s);
    return batch;
  }
}
