const SAAVN_HOSTS = [
  'https://saavnapi-six.vercel.app/api',
  'https://saavn-api-eight.vercel.app/api',
  'https://saavn-api.vercel.app',
];

const LANG_GENRE_MAP = {
  hindi: 'Bollywood', english: 'Pop', punjabi: 'Punjabi', tamil: 'Tamil',
  telugu: 'Telugu', bengali: 'Bengali', marathi: 'Marathi', gujarati: 'Gujarati',
  kannada: 'Kannada', malayalam: 'Malayalam', urdu: 'Ghazal', bhojpuri: 'Bhojpuri',
  rajasthani: 'Folk', haryanvi: 'Haryanvi', assamese: 'Assamese', odia: 'Odia',
};

class SaavnAPI {
  async _fetchWithFallback(path) {
    for (const host of SAAVN_HOSTS) {
      try {
        const url = `${host}${path}`;
        const res = await fetch(url, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout ? AbortSignal.timeout(3500) : undefined,
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success || json.data || Array.isArray(json)) return json;
        }
      } catch (e) { /* try next host */ }
    }
    return null;
  }

  _normalizeSong(raw) {
    if (!raw) return null;
    try {
      const primaryArtists = raw.artists?.primary || raw.primaryArtists || [];
      const artistName = Array.isArray(primaryArtists)
        ? primaryArtists.map(a => a.name).join(', ') || raw.primaryArtists || 'Unknown'
        : String(primaryArtists);
      const firstArtist = Array.isArray(primaryArtists) && primaryArtists[0];
      const images = raw.image || [];
      const downloads = raw.downloadUrl || [];

      return {
        id: raw.id,
        name: (raw.name || raw.title || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
        artist: artistName.split(', ')[0] || 'Unknown',
        artists: artistName,
        artistId: firstArtist?.id || raw.primaryArtistsId || '',
        album: raw.album?.name?.replace(/&quot;/g, '"') || '',
        albumId: raw.album?.id || '',
        duration: raw.duration || 0,
        year: raw.year || '',
        playCount: raw.playCount || 0,
        language: raw.language || '',
        hasLyrics: raw.hasLyrics || false,
        image: images.length > 0 ? images[images.length - 1]?.url : '',
        imageSmall: images.length > 1 ? images[1]?.url : (images[0]?.url || ''),
        downloadUrl: downloads.length > 0 ? downloads[downloads.length - 1]?.url : '',
        downloadUrls: downloads,
        genre: LANG_GENRE_MAP[raw.language?.toLowerCase()] || raw.language || 'Other',
      };
    } catch (e) { return null; }
  }

  async searchSongs(query, limit = 20, page = 1) {
    try {
      // Optimize query for better Saavn results (like Spotify does)
      let optimizedQuery = query.trim();
      const lowerQ = optimizedQuery.toLowerCase();
      if (lowerQ === 'gujarati' || lowerQ === 'gujarati song' || lowerQ === 'gujarati songs') {
        optimizedQuery = 'top gujarati hits';
      } else if (lowerQ.endsWith(' song') || lowerQ.endsWith(' songs')) {
        optimizedQuery = lowerQ.replace(/ songs?$/, ' hits');
      }

      // Fetch a larger pool to find the most famous tracks
      const fetchLimit = limit < 40 ? 40 : limit;
      const data = await this._fetchWithFallback(`/search/songs?query=${encodeURIComponent(optimizedQuery)}&page=${page}&limit=${fetchLimit}`);
      if (!data?.data?.results) return [];
      
      let results = data.data.results.map(r => this._normalizeSong(r)).filter(Boolean);
      
      // Sort by play count descending to guarantee famous/original songs bubble to the top
      results = results.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
      
      return results.slice(0, limit);
    } catch (e) { return []; }
  }

  /**
   * Fire multiple search queries in parallel for speed.
   * De‑duplicates across all results by song ID.
   * Returns a flat array of unique normalised songs.
   */
  async searchParallel(queries, limitPerQuery = 18) {
    const results = await Promise.allSettled(
      queries.map(q => this.searchSongs(q, limitPerQuery))
    );
    const all = [];
    const ids = new Set();
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const s of r.value) {
        if (s && s.id && !ids.has(s.id)) { ids.add(s.id); all.push(s); }
      }
    }
    return all;
  }

  async searchAlbums(query, limit = 10) {
    try {
      const data = await this._fetchWithFallback(`/search/albums?query=${encodeURIComponent(query)}&limit=${limit}`);
      if (!data?.data?.results) return [];
      return data.data.results.map(a => ({
        id: a.id, name: a.name?.replace(/&quot;/g, '"'), artist: a.artist || a.primaryArtists || '',
        image: a.image?.[a.image.length - 1]?.url || '', year: a.year || '', songCount: a.songCount || 0,
      }));
    } catch (e) { return []; }
  }

  async getPlaylistById(id) {
    try {
      const data = await this._fetchWithFallback(`/playlists?id=${encodeURIComponent(id)}&limit=50`);
      if (data?.data?.songs) {
        return data.data.songs.map(s => this._normalizeSong(s)).filter(Boolean);
      }
      return [];
    } catch (e) { return []; }
  }

  async getArtistTopSongs(artistId, limit = 10) {
    try {
      const data = await this._fetchWithFallback(`/artists/${encodeURIComponent(artistId)}/songs?limit=${limit}`);
      const songs = data?.data?.songs || data?.data?.results || [];
      return songs.map(s => this._normalizeSong(s)).filter(Boolean);
    } catch (e) { return []; }
  }

  async getSongById(id) {
    try {
      const data = await this._fetchWithFallback(`/songs/${id}`);
      if (data?.data) {
        const songs = Array.isArray(data.data) ? data.data : [data.data];
        return songs.map(s => this._normalizeSong(s)).filter(Boolean);
      }
      return [];
    } catch (e) { return []; }
  }

  async getTrending() {
    try {
      const songs = await this.searchSongs('top hindi hits', 25);
      if (songs && songs.length > 0) return songs;
    } catch (e) {}
    try {
      const fallback = await this.searchSongs('latest bollywood', 20);
      return fallback || [];
    } catch (e) {
      return [];
    }
  }

  async getRecommendedByLanguage(languages = ['hindi', 'english', 'punjabi'], limit = 10) {
    const all = [];
    const seenIds = new Set();
    for (const lang of languages) {
      const songs = await this.searchSongs(`best ${lang} songs 2025`, limit);
      for (const s of songs) {
        if (!seenIds.has(s.id)) { seenIds.add(s.id); all.push(s); }
      }
    }
    return all;
  }

  async getHybridPlaylist(seedQuery) {
    // A hybrid method to generate a large, rich playlist by combining multiple searches
    const allTracks = [];
    const seenIds = new Set();
    
    const queries = [
      seedQuery,
      `${seedQuery} best`,
      `${seedQuery} hits`,
      `${seedQuery} trending`
    ];

    for (const q of queries) {
      try {
        const songs = await this.searchSongs(q, 15);
        for (const s of songs) {
          if (!seenIds.has(s.id)) {
            seenIds.add(s.id);
            allTracks.push(s);
          }
        }
      } catch (e) { /* silent */ }
    }
    
    // Sort by play count to ensure top quality recommendations
    return allTracks.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
  }
}

export default new SaavnAPI();
