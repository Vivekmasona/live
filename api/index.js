import express from 'express';

const app = express();
app.use(express.json());

let state = {
  playlist: [],
  stationStartTime: Date.now() // Absolute epoch base in milliseconds
};

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// Calculate live playback state with Millisecond Precision and Continuous Infinity Loop
function getLivePlaybackState() {
  if (!state.playlist || state.playlist.length === 0) {
    return { playlist: [], currentIndex: 0, seekTime: 0 };
  }

  // Calculate total queue duration in milliseconds (default 180s per track = 180,000ms)
  const totalPlaylistDurationMs = state.playlist.reduce((acc, song) => acc + ((song.duration || 180) * 1000), 0);
  
  if (totalPlaylistDurationMs <= 0) {
    return { playlist: state.playlist, currentIndex: 0, seekTime: 0 };
  }

  // Absolute continuous elapsed time since station started
  const elapsedMs = Math.max(0, Date.now() - state.stationStartTime);
  
  // Continuous infinity loop time calculation
  const timeInLoopMs = elapsedMs % totalPlaylistDurationMs;

  let accumulatedMs = 0;
  let currentIndex = 0;
  let seekTimeSec = 0;

  for (let i = 0; i < state.playlist.length; i++) {
    const songDurationMs = (state.playlist[i].duration || 180) * 1000;
    if (timeInLoopMs < accumulatedMs + songDurationMs) {
      currentIndex = i;
      seekTimeSec = (timeInLoopMs - accumulatedMs) / 1000;
      break;
    }
    accumulatedMs += songDurationMs;
  }

  return {
    playlist: state.playlist,
    currentIndex: currentIndex,
    seekTime: parseFloat(seekTimeSec.toFixed(3)) // Millisecond accuracy
  };
}

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
      url: s.downloadUrl?.[s.downloadUrl.length - 1]?.link || s.downloadUrl?.[s.downloadUrl.length - 1]?.url || s.url || s.audio,
      duration: 180 // Standard 3 minutes fixed slot for clock sync
    })).filter(s => s.url);

    res.json({ results: cleanSongs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/playlist', (req, res) => {
  res.json(getLivePlaybackState());
});

app.post('/api/playlist', (req, res) => {
  const newSong = req.body;
  if (!newSong.url || !newSong.title) return res.status(400).json({ error: 'Invalid data' });

  if (!state.playlist.some(s => s.url === newSong.url)) {
    newSong.duration = 180;
    if (state.playlist.length === 0) {
      state.stationStartTime = Date.now();
    }
    state.playlist.push(newSong);
  }
  res.json({ success: true, ...getLivePlaybackState() });
});

// Admin direct track click override
app.post('/api/play', (req, res) => {
  const { index } = req.body;
  if (index !== undefined && index >= 0 && index < state.playlist.length) {
    let pastDurationSumMs = 0;
    for (let i = 0; i < index; i++) {
      pastDurationSumMs += ((state.playlist[i].duration || 180) * 1000);
    }
    state.stationStartTime = Date.now() - pastDurationSumMs;
  }
  res.json({ success: true, ...getLivePlaybackState() });
});

app.delete('/api/playlist/:index', (req, res) => {
  const index = parseInt(req.params.index);
  if (index >= 0 && index < state.playlist.length) {
    state.playlist.splice(index, 1);
    state.stationStartTime = Date.now(); // Reset anchor time safely
  }
  res.json({ success: true, ...getLivePlaybackState() });
});

export default app;

