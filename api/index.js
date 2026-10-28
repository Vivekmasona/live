import express from 'express';
import { kv } from '@vercel/kv';

const app = express();
app.use(express.json());

// CORS Middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// 1. Search Endpoint (SVN API integration)
app.get('/api/search', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Search query is required' });

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

// 2. Get Playlist Endpoint
app.get('/api/playlist', async (req, res) => {
  try {
    let playlist = await kv.get('global_fm_playlist');
    res.json(playlist || []);
  } catch (err) {
    res.json([]);
  }
});

// 3. Add Song Endpoint
app.post('/api/playlist', async (req, res) => {
  try {
    const newSong = req.body;
    if (!newSong.url || !newSong.title) {
      return res.status(400).json({ error: 'Invalid song data' });
    }

    let playlist = await kv.get('global_fm_playlist');
    if (!playlist) playlist = [];

    if (!playlist.some(s => s.url === newSong.url)) {
      playlist.push(newSong);
      await kv.set('global_fm_playlist', playlist);
    }
    res.json({ success: true, playlist });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Delete Song Endpoint
app.delete('/api/playlist/:index', async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    let playlist = await kv.get('global_fm_playlist');
    if (!playlist) playlist = [];

    if (index >= 0 && index < playlist.length) {
      playlist.splice(index, 1);
      await kv.set('global_fm_playlist', playlist);
    }
    res.json({ success: true, playlist });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default app;
