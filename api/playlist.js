// api/playlist.js
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

    // 1. GET: Saare global listeners ke liye playlist fetch karna
    if (req.method === 'GET') {
      const { search } = req.query;
      
      // Agar admin search query bhejta hai, toh backend khud SVN API se search karega
      if (search) {
        const svnRes = await fetch(`https://svn-vivekfy.vercel.app/search/songs?query=${encodeURIComponent(search)}`);
        const svnData = await svnRes.json();
        const songs = svnData?.data?.results || [];
        
        const cleanSongs = songs.map(s => ({
          title: s.name || "Unknown",
          primaryArtists: s.primaryArtists || "Unknown",
          image: s.image?.[s.image.length - 1]?.link || s.image?.[s.image.length - 1]?.url || "",
          url: s.downloadUrl?.[s.downloadUrl.length - 1]?.link || s.downloadUrl?.[s.downloadUrl.length - 1]?.url || ""
        })).filter(s => s.url);

        return res.status(200).json({ results: cleanSongs });
      }

      return res.status(200).json(playlist);
    }

    // 2. POST: Admin dwara naya gaana global playlist me save karna
    if (req.method === 'POST') {
      const newSong = req.body;
      if (!newSong.url || !newSong.title) {
        return res.status(400).json({ error: 'Invalid song data' });
      }

      // Duration check karne ke liye ya duplicate roknne ke liye
      if (!playlist.some(s => s.url === newSong.url)) {
        playlist.push(newSong);
        await kv.set('global_fm_playlist', playlist);
      }
      return res.status(200).json({ success: true, playlist });
    }

    // 3. DELETE: Admin dwara gaana delete karna
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
