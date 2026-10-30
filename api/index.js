import express from 'express';
import fs from 'fs';

const app = express();
app.use(express.json());

const TMP_FILE = '/tmp/fm_station_state.json';
const DEVELOPER_NAME = "Vivek Masona";

function loadState() {
  try {
    if (fs.existsSync(TMP_FILE)) {
      const data = fs.readFileSync(TMP_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("Error reading state file:", err);
  }
  return {
    playlist: [],
    stationStartTime: Date.now()
  };
}

function saveState(state) {
  try {
    fs.writeFileSync(TMP_FILE, JSON.stringify(state), 'utf8');
  } catch (err) {
    console.error("Error writing state file:", err);
  }
}

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Developer', DEVELOPER_NAME);
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

function getLivePlaybackState() {
  let state = loadState();
  if (!state.playlist || state.playlist.length === 0) {
    return { developer: DEVELOPER_NAME, playlist: [], currentIndex: 0, seekTime: 0 };
  }

  const totalPlaylistDurationMs = state.playlist.reduce((acc, song) => acc + ((song.duration || 180) * 1000), 0);
  if (totalPlaylistDurationMs <= 0) {
    return { developer: DEVELOPER_NAME, playlist: state.playlist, currentIndex: 0, seekTime: 0 };
  }

  const elapsedMs = Math.max(0, Date.now() - state.stationStartTime);
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
    developer: DEVELOPER_NAME,
    playlist: state.playlist,
    currentIndex: currentIndex,
    seekTime: parseFloat(seekTimeSec.toFixed(3))
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
      duration: 180
    })).filter(s => s.url);

    res.json({ developer: DEVELOPER_NAME, results: cleanSongs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/playlist', (req, res) => {
  res.json(getLivePlaybackState());
});

// Sync endpoint to restore state from any active user's localStorage if server was sleeping
app.post('/api/sync', (req, res) => {
  let state = loadState();
  const { playlist } = req.body;
  if (state.playlist.length === 0 && Array.isArray(playlist) && playlist.length > 0) {
    state.playlist = playlist;
    state.stationStartTime = Date.now();
    saveState(state);
  }
  res.json({ success: true, ...getLivePlaybackState() });
});

app.post('/api/playlist', (req, res) => {
  let state = loadState();
  const newSong = req.body;
  if (!newSong.url || !newSong.title) return res.status(400).json({ error: 'Invalid data' });

  if (!state.playlist.some(s => s.url === newSong.url)) {
    newSong.duration = 180;
    if (state.playlist.length === 0) {
      state.stationStartTime = Date.now();
    }
    state.playlist.push(newSong);
    saveState(state);
  }
  res.json({ success: true, ...getLivePlaybackState() });
});

app.post('/api/play', (req, res) => {
  let state = loadState();
  const { index } = req.body;
  if (index !== undefined && index >= 0 && index < state.playlist.length) {
    let pastDurationSumMs = 0;
    for (let i = 0; i < index; i++) {
      pastDurationSumMs += ((state.playlist[i].duration || 180) * 1000);
    }
    state.stationStartTime = Date.now() - pastDurationSumMs;
    saveState(state);
  }
  res.json({ success: true, ...getLivePlaybackState() });
});

app.delete('/api/playlist/:index', (req, res) => {
  let state = loadState();
  const index = parseInt(req.params.index);
  if (index >= 0 && index < state.playlist.length) {
    state.playlist.splice(index, 1);
    state.stationStartTime = Date.now();
    saveState(state);
  }
  res.json({ success: true, ...getLivePlaybackState() });
});

app.head('/api/playlist', (req, res) => {
  res.setHeader('X-Developer', DEVELOPER_NAME);
  res.status(200).end();
});

export default app;
