import express from 'express';

const app = express();
app.use(express.json());

let state = {
  playlist: [],
  stationStartTime: Date.now() // Station start epoch base
};

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// Calculate exact live track and offset using absolute station loop timeline
function getLivePlaybackState() {
  if (state.playlist.length === 0) {
    return { playlist: [], currentIndex: 0, seekTime: 0 };
  }

  // Total duration of all songs in playlist
  const totalPlaylistDuration = state.playlist.reduce((acc, song) => acc + (song.duration || 180), 0);
  if (totalPlaylistDuration <= 0) {
    return { playlist: state.playlist, currentIndex: 0, seekTime: 0 };
  }

  // Elapsed seconds since station started playing continuously
  const elapsedSeconds = Math.floor((Date.now() - state.stationStartTime) / 1000);
  const timeInLoop = elapsedSeconds % totalPlaylistDuration;

  let accumulated = 0;
  let currentIndex = 0;
  let seekTime = 0;

  for (let i = 0; i < state.playlist.length; i++) {
    const songDuration = state.playlist[i].duration || 180;
    if (timeInLoop < accumulated + songDuration) {
      currentIndex = i;
      seekTime = timeInLoop - accumulated;
      break;
    }
    accumulated += songDuration;
  }

  return {
    playlist: state.playlist,
    currentIndex: currentIndex,
    seekTime: seekTime
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
      duration: 180 // Default 3 mins fixed duration for precise math sync
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
      state.stationStartTime = Date.now(); // Reset loop base if queue was empty
    }
    state.playlist.push(newSong);
  }
  res.json({ success: true, ...getLivePlaybackState() });
});

// Admin manual track override jump
app.post('/api/play', (req, res) => {
  const { index } = req.body;
  if (index !== undefined && index >= 0 && index < state.playlist.length) {
    // Adjust stationStartTime so that the selected song starts right now at seekTime = 0
    let pastDurationSum = 0;
    for (let i = 0; i < index; i++) {
      pastDurationSum += (state.playlist[i].duration || 180);
    }
    const totalDuration = state.playlist.reduce((acc, song) => acc + (song.duration || 180), 0);
    const now = Date.now();
    const currentLoopTime = Math.floor((now - state.stationStartTime) / 1000) % totalDuration;
    
    // Shift stationStartTime to align target song at current timeline slot
    state.stationStartTime = now - (pastDurationSum * 1000);
  }
  res.json({ success: true, ...getLivePlaybackState() });
});

app.delete('/api/playlist/:index', (req, res) => {
  const index = parseInt(req.params.index);
  if (index >= 0 && index < state.playlist.length) {
    state.playlist.splice(index, 1);
    state.stationStartTime = Date.now(); // Reset loop anchor safely on delete
  }
  res.json({ success: true, ...getLivePlaybackState() });
});

export default app;
