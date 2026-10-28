import express from 'express';
import fs from 'fs';

const app = express();
app.use(express.json());

const TMP_FILE = '/tmp/fm_station_state.json';
const DEVELOPER_NAME = "Vivek Masona";

let memoryState = {
  playlist: [],
  stationStartTime: Date.now()
};

function loadState() {
  try {
    if (fs.existsSync(TMP_FILE)) {
      const data = fs.readFileSync(TMP_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed && Array.isArray(parsed.playlist)) {
        return parsed;
      }
    }
  } catch (err) {
    console.error("Read warning:", err);
  }
  return memoryState;
}

function saveState(state) {
  try {
    memoryState = state;
    fs.writeFileSync(TMP_FILE, JSON.stringify(state), 'utf8');
  } catch (err) {
    console.error("Write warning:", err);
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

// Server sirf base state aur timeline return karega, baki sab client local clock se handle karega
app.get('/api/playlist', (req, res) => {
  let state = loadState();
  res.json({
    developer: DEVELOPER_NAME,
    playlist: state.playlist,
    stationStartTime: state.stationStartTime
  });
});

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
  res.json({ success: true, playlist: state.playlist, stationStartTime: state.stationStartTime });
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
  res.json({ success: true, playlist: state.playlist, stationStartTime: state.stationStartTime });
});

app.delete('/api/playlist/:index', (req, res) => {
  let state = loadState();
  const index = parseInt(req.params.index);
  if (index >= 0 && index < state.playlist.length) {
    state.playlist.splice(index, 1);
    state.stationStartTime = Date.now();
    saveState(state);
  }
  res.json({ success: true, playlist: state.playlist, stationStartTime: state.stationStartTime });
});

export default app;

