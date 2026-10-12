# 🎵 WaxWarp - 3D Music Discovery Website

**WaxWarp** is an interactive 3D music website. Instead of browsing a standard flat list or grid of songs, music is displayed as vinyl records in an endless 3D tunnel. 

As you scroll through the tunnel, whichever vinyl record lands in the center starts playing automatically!

---

## ✨ Features

- **🌀 3D Vinyl Tunnel:** Browse music in an endless 3D space built with Three.js.
- **🎧 Scroll to Play:** Scroll down, swipe, or use your keyboard arrow keys — the song in the middle plays automatically.
- **🎵 Real Music Streaming:** Streams songs and track metadata directly via music APIs.
- **🎨 Dynamic Vinyl Art:** Generates colorful vinyl records and album art on the fly.
- **⚡ Interactive Audio Player:** Full playback controls (Play/Pause, Next/Previous, Seek slider, Volume/Mute, and Like button).
- **❤️ Smart Recommendations:** Learns what you enjoy based on what you like and listen to, suggesting more songs matching your vibe.
- **🌈 Vibe Filters:** Quickly switch genres and moods (Pop, Lo-Fi, Retro, Punjabi, Acoustic, etc.).

---

## 🛠️ Tech Stack

- **Frontend:** HTML5, CSS3, JavaScript (ES6+)
- **3D Graphics:** [Three.js](https://threejs.org/) (WebGL)
- **Bundler / Server:** [Vite](https://vitejs.dev/)
- **Music API:** JioSaavn API for song streaming and metadata
- **Audio Embeddings / Recommendation:** Vector scoring and CLAP audio concept matching

---

## 🚀 How to Run Locally

Follow these simple steps to run the website on your computer:

### 1. Clone the repository
```bash
git clone https://github.com/Divyeshkubavat/3d_music_website.git
cd 3d_music_website
```

### 2. Install dependencies
```bash
npm install
```

### 3. Start the development server
```bash
npm run dev
```

### 4. Open in your browser
Open your browser and visit the local link shown in your terminal (usually `http://localhost:5173`).

---

## 🎮 Controls

- **Mouse Wheel / Trackpad:** Scroll up and down to fly through the record tunnel.
- **Arrow Keys (↑ / ↓):** Move between songs.
- **Spacebar:** Play or pause the current track.
- **Click:** Click on any record in the tunnel or use the bottom player controls.