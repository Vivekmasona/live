import express from 'express';

const app = express();
app.use(express.json());

const DEVELOPER_NAME = "Vivek__Masona";
// Aapka Firebase Realtime Database URL
const FIREBASE_DB_URL = "https://webcontrol-45bb7-default-rtdb.firebaseio.com/state.json";

// In-Memory State Storage & Cache Timestamp
let stationState = {
  playlist: [],
  stationStartTime: Date.now()
};

let lastCloudFetchTime = 0;
const CLOUD_CACHE_DURATION = 5 * 60 * 1000; // 5 Minutes cache duration

// Firebase se data load karne ka smart function (With 5-min TTL Cache)
async function loadStateFromCloud(force = false) {
  const now = Date.now();
  // Agar data pehle se hai aur 5 minute nahi hue hain, toh Firebase hit mat karo!
  if (!force && stationState.playlist.length > 0 && (now - lastCloudFetchTime < CLOUD_CACHE_DURATION)) {
    return stationState;
  }

  try {
    const res = await fetch(FIREBASE_DB_URL);
    const data = await res.json();
    // Firebase direct object deta hai agar data saved ho
    if (data && Array.isArray(data.playlist)) {
      stationState = data;
      lastCloudFetchTime = Date.now();
    }
  } catch (err) {
    console.error("Firebase load error:", err);
  }
  return stationState;
}

// Initial state fetch on startup
loadStateFromCloud(true);

async function getState() {
  return await loadStateFromCloud(false);
}

// Throttling for cloud sync (PUT requests)
let lastCloudSyncTime = 0;
async function updateState(newState, forceCloudSync = false) {
  stationState = newState; // RAM update immediately
  lastCloudFetchTime = Date.now(); // Reset cache timer on local updates
  
  const now = Date.now();
  if (forceCloudSync || (now - lastCloudSyncTime > 5000)) {
    lastCloudSyncTime = now;
    try {
      await fetch(FIREBASE_DB_URL, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(newState)
      });
    } catch (err) {
      console.error("Firebase sync error:", err);
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

async function calculatePlaybackState() {
  let state = await getState();
  if (!state.playlist || state.playlist.length === 0) {
    return { developer: DEVELOPER_NAME, playlist: [], currentIndex: 0, seekTime: 0 };
  }

  const validPlaylist = state.playlist.map(song => ({
    ...song,
    duration: Number(song.duration) || 180
  }));

  const totalPlaylistDurationMs = validPlaylist.reduce((acc, song) => acc + (song.duration * 1000), 0);
  if (totalPlaylistDurationMs <= 0) {
    return { developer: DEVELOPER_NAME, playlist: validPlaylist, currentIndex: 0, seekTime: 0 };
  }

  const elapsedMs = Math.max(0, Date.now() - state.stationStartTime);
  const timeInLoopMs = elapsedMs % totalPlaylistDurationMs;

  let accumulatedMs = 0;
  let currentIndex = 0;
  let seekTimeSec = 0;

  for (let i = 0; i < validPlaylist.length; i++) {
    const songDurationMs = validPlaylist[i].duration * 1000;
    if (timeInLoopMs < accumulatedMs + songDurationMs) {
      currentIndex = i;
      seekTimeSec = (timeInLoopMs - accumulatedMs) / 1000;
      break;
    }
    accumulatedMs += songDurationMs;
  }

  return {
    developer: DEVELOPER_NAME,
    playlist: validPlaylist,
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
      duration: Number(s.duration) || 180
    })).filter(s => s.url);

    res.json({ developer: DEVELOPER_NAME, results: cleanSongs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/playlist', async (req, res) => {
  try {
    const playback = await calculatePlaybackState();
    res.json(playback);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sync', async (req, res) => {
  try {
    let state = await getState();
    if (!state.playlist || state.playlist.length === 0) {
      const { playlist } = req.body;
      if (Array.isArray(playlist) && playlist.length > 0) {
        state = { playlist, stationStartTime: Date.now() };
        await updateState(state, true);
      }
    }
    const playback = await calculatePlaybackState();
    res.json({ success: true, ...playback });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/playlist', async (req, res) => {
  try {
    let state = await getState();
    const newSong = req.body;
    if (!newSong.url || !newSong.title) return res.status(400).json({ error: 'Invalid data' });

    if (!state.playlist.some(s => s.url === newSong.url)) {
      newSong.duration = Number(newSong.duration) || 180;
      if (state.playlist.length === 0) {
        state.stationStartTime = Date.now();
      }
      state.playlist.push(newSong);
      await updateState(state, true);
    }
    const playback = await calculatePlaybackState();
    res.json({ success: true, ...playback });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/play', async (req, res) => {
  try {
    let state = await getState();
    const { index } = req.body;
    if (index !== undefined && index >= 0 && index < state.playlist.length) {
      let pastDurationSumMs =_0 = 0;
      let pastDurationSumMs = 0;
      for (let i = 0; i < index; i++) {
        pastDurationSumMs += ((Number(state.playlist[i].duration) || 180) * 1000);
      }
      state.stationStartTime = Date.now() - pastDurationSumMs;
      await updateState(state, true);
    }
    const playback = await calculatePlaybackState();
    res.json({ success: true, ...playback });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/playlist/:index', async (req, res) => {
  try {
    let state = await getState();
    const index = parseInt(req.params.index);
    if (index >= 0 && index < state.playlist.length) {
      state.playlist.splice(index, 1);
      state.stationStartTime = Date.now();
      await updateState(state, true);
    }
    const playback = await calculatePlaybackState();
    res.json({ success: true, ...playback });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default app;
