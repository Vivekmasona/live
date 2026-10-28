import express from 'express';

const app = express();
app.use(express.json());

let state = {
  playlist: [],
  currentIndex: 0,
  songStartTime: Date.now()
};

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// Auto-advance song if duration is completed
function updatePlaybackState() {
  if (state.playlist.length === 0) return;
  const currentSong = state.playlist[state.currentIndex] || state.playlist[0];
  const duration = (currentSong.duration || 180) * 1000;
  const elapsed = Date.now() - state.songStartTime;

  if (elapsed >= duration) {
    state.currentIndex = (state.currentIndex + 1) % state.playlist.length;
    state.songStartTime = Date.now();
  }
}

// Search Endpoint
app.get('/api/search', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Query required' });

    const svnRes = await fetch(`https://svn-vivekfy.vercel.app/search/songs?query=${encodeURIComponent(query)}`);
    const svnData = await svnRes.json();
    const songs = svnData?.data?.results || svnData?.results || [];

    const cleanSongs = songs.map(s => ({
      title: s.name || s.title || "Unknown",
      primaryArtists: s.primaryArtists || s.artist || "Unknown",
      image: s.image?.[s.image.length - 1]?.link || s.image?.[s.image.length - 1]?.url || "",
      url: s.downloadUrl?.[s.downloadUrl.length - 1]?.link || s.downloadUrl?.[s.downloadUrl.length - 1]?.url || s.url || s.audio
    })).filter(s => s.url);

    res.json({ results: cleanSongs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Current Playlist State & Seek Time
app.get('/api/playlist', (req, res) => {
  updatePlaybackState();
  const currentSong = state.playlist[state.currentIndex];
  const seekTime = currentSong ? Math.floor((Date.now() - state.songStartTime) / 1000) : 0;
  
  res.json({
    playlist: state.playlist,
    currentIndex: state.currentIndex,
    seekTime: seekTime
  });
});

// Add Song
app.post('/api/playlist', (req, res) => {
  updatePlaybackState();
  const newSong = req.body;
  if (!newSong.url || !newSong.title) return res.status(400).json({ error: 'Invalid data' });

  if (!state.playlist.some(s => s.url === newSong.url)) {
    newSong.duration = 180;
    state.playlist.push(newSong);
    if (state.playlist.length === 1) {
      state.currentIndex = 0;
      state.songStartTime = Date.now();
    }
  }
  res.json({ success: true, playlist: state.playlist });
});

// Admin Play Specific Song on Click
app.post('/api/play', (req, res) => {
  const { index } = req.body;
  if (index !== undefined && index >= 0 && index < state.playlist.length) {
    state.currentIndex = index;
    state.songStartTime = Date.now();
  }
  res.json({ success: true, currentIndex: state.currentIndex });
});

// Delete Song
app.delete('/api/playlist/:index', (req, res) => {
  updatePlaybackState();
  const index = parseInt(req.params.index);
  if (index >= 0 && index < state.playlist.length) {
    state.playlist.splice(index, 1);
    if (state.playlist.length === 0) {
      state.currentIndex = 0;
    } else {
      if (state.currentIndex >= state.playlist.length) {
        state.currentIndex = 0;
      }
      state.songStartTime = Date.now();
    }
  }
  res.json({ success: true, playlist: state.playlist, currentIndex: state.currentIndex });
});

export default app;

