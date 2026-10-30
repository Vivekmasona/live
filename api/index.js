import express from 'express';
import fs from 'fs';

const app = express();
app.use(express.json());

const DEVELOPER_NAME = "Vivek Masona";
const TMP_FILE = '/tmp/fm_station_state.json';
const JSONBIN_MASTER_KEY = "$2a$10$LS/yGb.vYcDNEBq5sG1w.Ooolk5h0LgIermGIubO2yjaohXN39hAC";
const JSONBIN_BIN_ID = "6ae40759ffd5d16053978352";

// In-memory cache to prevent hitting JSONBin rate limits (Unlimited optimization)
let cachedState = null;
let lastCacheTime = 0;
const CACHE_TTL = 30000; // 30 seconds cache window

function loadLocalState() {
  try {
    if (fs.existsSync(TMP_FILE)) {
      const data = fs.readFileSync(TMP_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("Error reading local state:", err);
  }
  return { playlist: [], stationStartTime: Date.now() };
}

function saveLocalState(state) {
  try {
    fs.writeFileSync(TMP_FILE, JSON.stringify(state), 'utf8');
  } catch (err) {
    console.error("Error writing local state:", err);
  }
}

// Optimized loadState with caching to save JSONBin free quota
async function loadState(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedState && (now - lastCacheTime < CACHE_TTL)) {
    return cachedState;
  }

  let localState = loadLocalState();
  if (JSONBIN_BIN_ID) {
    try {
      const res = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`, {
        headers: { 'X-Master-Key': JSONBIN_MASTER_KEY }
      });
      const data = await res.json();
      if (data && data.record && Array.isArray(data.record.playlist)) {
        cachedState = data.record;
        lastCacheTime = now;
        saveLocalState(cachedState);
        return cachedState;
      }
    } catch (err) {
      console.error("Cloud load error, using local cache:", err);
    }
  }
  cachedState = localState;
  return cachedState;
}

// Save state to Cloud and Local, and update cache instantly
async function saveState(state) {
  cachedState = state;
  lastCacheTime = Date.now();
  saveLocalState(state);
  
  if (JSONBIN_BIN_ID) {
    try {
      await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': JSONBIN_MASTER_KEY
        },
        body: JSON.stringify(state)
      });
    } catch (err) {
      console.error("Cloud save error:", err);
    }
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

async function getLivePlaybackState() {
  let state = await loadState();
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

app.get('/api/playlist', async (req, res) => {
  const data = await getLivePlaybackState();
  res.json(data);
});

app.post('/api/sync', async (req, res) => {
  let state = await loadState(true);
  const { playlist } = req.body;
  if (state.playlist.length === 0 && Array.isArray(playlist) && playlist.length > 0) {
    state.playlist = playlist;
    state.stationStartTime = Date.now();
    await saveState(state);
  }
  const liveData = await getLivePlaybackState();
  res.json({ success: true, ...liveData });
});

app.post('/api/playlist', async (req, res) => {
  let state = await loadState(true);
  const newSong = req.body;
  if (!newSong.url || !newSong.title) return res.status(400).json({ error: 'Invalid data' });

  if (!state.playlist.some(s => s.url === newSong.url)) {
    newSong.duration = 180;
    if (state.playlist.length === 0) {
      state.stationStartTime = Date.now();
    }
    state.playlist.push(newSong);
    await saveState(state);
  }
  const liveData = await getLivePlaybackState();
  res.json({ success: true, ...liveData });
});

app.post('/api/play', async (req, res) => {
  let state = await loadState(true);
  const { index } = req.body;
  if (index !== undefined && index >= 0 && index < state.playlist.length) {
    let pastDurationSumMs = 0;
    for (let i = 0; i < index; i++) {
      pastDurationSumMs += ((state.playlist[i].duration || 180) * 1000);
    }
    state.stationStartTime = Date.now() - pastDurationSumMs;
    await saveState(state);
  }
  const liveData = await getLivePlaybackState();
  res.json({ success: true, ...liveData });
});

app.delete('/api/playlist/:index', async (req, res) => {
  let state = await loadState(true);
  const index = parseInt(req.params.index);
  if (index >= 0 && index < state.playlist.length) {
    state.playlist.splice(index, 1);
    state.stationStartTime = Date.now();
    await saveState(state);
  }
  const liveData = await getLivePlaybackState();
  res.json({ success: true, ...liveData });
});

export default app;
