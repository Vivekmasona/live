import express from 'express';
import fs from 'fs';

const app = express();
app.use(express.json());

const DEVELOPER_NAME = "Vivek Masona";
const TMP_FILE = '/tmp/fm_station_state.json';

// Direct GitHub Configuration (Hardcoded)
const GITHUB_TOKEN = "Ghp_9jKR6U22hWdk7O4yi8jInBX0XXDBEH32Rqs0"; //[span_2](start_span)[span_2](end_span)
const GITHUB_USERNAME = "Vivekmasona"; //[span_3](start_span)[span_3](end_span)
const REPO_NAME = "json"; //[span_4](start_span)[span_4](end_span)
const FILE_PATH = "song.json"; //[span_5](start_span)[span_5](end_span)

const githubHeaders = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Node-Express-App'
};

function readTmpState() {
  try {
    if (fs.existsSync(TMP_FILE)) {
      const raw = fs.readFileSync(TMP_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error("Local TMP read error:", err);
  }
  return null;
}

function writeTmpState(state) {
  try {
    fs.writeFileSync(TMP_FILE, JSON.stringify(state), 'utf8');
  } catch (err) {
    console.error("Local TMP write error:", err);
  }
}

async function loadStateFromCloud() {
  try {
    const url = `https://api.github.com/repos/${GITHUB_USERNAME}/${REPO_NAME}/contents/${FILE_PATH}`;
    const res = await fetch(url, { headers: githubHeaders });
    
    if (res.ok) {
      const data = await res.json();
      const content = Buffer.from(data.content, 'base64').toString('utf8');
      const parsedData = JSON.parse(content);
      
      if (parsedData && Array.isArray(parsedData.playlist)) {
        writeTmpState(parsedData);
        return { ...parsedData, sha: data.sha };
      }
    }
  } catch (err) {
    console.error("GitHub load error:", err);
  }
  return { playlist: [], stationStartTime: Date.now() };
}

async function getState() {
  let state = readTmpState();
  if (!state || !Array.isArray(state.playlist)) {
    state = await loadStateFromCloud();
  }
  return state;
}

async function updateState(newState) {
  writeTmpState(newState);
  try {
    const url = `https://api.github.com/repos/${GITHUB_USERNAME}/${REPO_NAME}/contents/${FILE_PATH}`;
    
    let sha = newState.sha;
    if (!sha) {
      try {
        const existing = await fetch(url, { headers: githubHeaders });
        if (existing.ok) {
          const exData = await existing.json();
          sha = exData.sha;
        }
      } catch (e) {
        // ignore
      }
    }

    const cleanState = {
      playlist: newState.playlist,
      stationStartTime: newState.stationStartTime
    };

    const encodedContent = Buffer.from(JSON.stringify(cleanState, null, 2)).toString('base64');

    const body = {
      message: 'Update playlist state via backend',
      content: encodedContent,
      sha: sha ? sha : undefined
    };

    const putRes = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...githubHeaders
      },
      body: JSON.stringify(body)
    });

    if (putRes.ok) {
      const putData = await putRes.json();
      newState.sha = putData.content.sha;
    }
  } catch (err) {
    console.error("GitHub sync error:", err);
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
  const playback = await calculatePlaybackState();
  res.json(playback);
});

app.post('/api/sync', async (req, res) => {
  let state = readTmpState();
  if (!state || state.playlist.length === 0) {
    const { playlist } = req.body;
    if (Array.isArray(playlist) && playlist.length > 0) {
      state = { playlist, stationStartTime: Date.now() };
      await updateState(state);
    }
  }
  const playback = await calculatePlaybackState();
  res.json({ success: true, ...playback });
});

app.post('/api/playlist', async (req, res) => {
  let state = await getState();
  const newSong = req.body;
  if (!newSong.url || !newSong.title) return res.status(400).json({ error: 'Invalid data' });

  if (!state.playlist.some(s => s.url === newSong.url)) {
    newSong.duration = Number(newSong.duration) || 180;
    if (state.playlist.length === 0) {
      state.stationStartTime = Date.now();
    }
    state.playlist.push(newSong);
    await updateState(state);
  }
  const playback = await calculatePlaybackState();
  res.json({ success: true, ...playback });
});

app.post('/api/play', async (req, res) => {
  let state = await getState();
  const { index } = req.body;
  if (index !== undefined && index >= 0 && index < state.playlist.length) {
    let pastDurationSumMs = 0;
    for (let i = 0; i < index; i++) {
      pastDurationSumMs += ((Number(state.playlist[i].duration) || 180) * 1000);
    }
    state.stationStartTime = Date.now() - pastDurationSumMs;
    await updateState(state);
  }
  const playback = await calculatePlaybackState();
  res.json({ success: true, ...playback });
});

app.delete('/api/playlist/:index', async (req, res) => {
  let state = await getState();
  const index = parseInt(req.params.index);
  if (index >= 0 && index < state.playlist.length) {
    state.playlist.splice(index, 1);
    state.stationStartTime = Date.now();
    await updateState(state);
  }
  const playback = await calculatePlaybackState();
  res.json({ success: true, ...playback });
});

export default app;

