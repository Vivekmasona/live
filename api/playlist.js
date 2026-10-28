import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let playlist = await kv.get('global_fm_playlist') || [];

    if (req.method === 'GET') {
      return res.status(200).json(playlist);
    }

    if (req.method === 'POST') {
      const newSong = req.body;
      if (!newSong.url || !newSong.title) {
        return res.status(400).json({ error: 'Invalid song data' });
      }

      if (!playlist.some(s => s.url === newSong.url)) {
        playlist.push(newSong);
        await kv.set('global_fm_playlist', playlist);
      }
      return res.status(200).json({ success: true, playlist });
    }

    if (req.method === 'DELETE') {
      const { index } = req.query;
      if (index !== undefined && playlist[index]) {
        playlist.splice(index, 1);
        await kv.set('global_fm_playlist', playlist);
      }
      return res.status(200).json({ success: true, playlist });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

