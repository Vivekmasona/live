import express from 'express';

const app = express();
app.use(express.json());

let globalPlaylist = [];

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

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

// Get Playlist
app.get('/api/playlist', (req, res) => {
  res.json(globalPlaylist);
});

// Add Song
app.post('/api/playlist', (req, res) => {
  const newSong = req.body;
  if (!newSong.url || !newSong.title) return res.status(400).json({ error: 'Invalid data' });

  if (!globalPlaylist.some(s => s.url === newSong.url)) {
    newSong.duration = 180; // Standard 3 mins default duration for clock sync
    globalPlaylist.push(newSong);
  }
  res.json({ success: true, playlist: globalPlaylist });
});

// Delete Song
app.delete('/api/playlist/:index', (req, res) => {
  const index = parseInt(req.params.index);
  if (index >= 0 && index < globalPlaylist.length) {
    globalPlaylist.splice(index, 1);
  }
  res.json({ success: true, playlist: globalPlaylist });
});

export default app;
