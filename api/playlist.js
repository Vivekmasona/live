import { put, list } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const BLOB_NAME = 'global-playlist.json';

  try {
    // Helper to get playlist from Vercel Blob
    async function getPlaylistFromBlob() {
      try {
        const { blobs } = await list();
        const file = blobs.find(b => b.pathname === BLOB_NAME);
        if (!file) return [];
        const response = await fetch(file.url);
        return await response.json();
      } catch (e) {
        return [];
      }
    }

    // Helper to save playlist to Vercel Blob
    async function savePlaylistToBlob(playlist) {
      await put(BLOB_NAME, JSON.stringify(playlist), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true
      });
    }

    let playlist = await getPlaylistFromBlob();

    // 1. GET: Playlist fetch karne ke liye ya SVN search ke liye
    if (req.method === 'GET') {
      const { search } = req.query;
      
      if (search) {
        const svnRes = await fetch(`https://svn-vivekfy.vercel.app/search/songs?query=${encodeURIComponent(search)}`);
        const svnData = await svnRes.json();
        const songs = svnData?.data?.results || svnData?.results || [];
        
        const cleanSongs = songs.map(s => ({
          title: s.name || s.title || "Unknown",
          primaryArtists: s.primaryArtists || s.artist || "Unknown",
          image: s.image?.[s.image.length - 1]?.link || s.image?.[s.image.length - 1]?.url || "",
          url: s.downloadUrl?.[s.downloadUrl.length - 1]?.link || s.downloadUrl?.[s.downloadUrl.length - 1]?.url || s.url || s.audio
        })).filter(s => s.url);

        return res.status(200).json({ results: cleanSongs });
      }

      return res.status(200).json(playlist);
    }

    // 2. POST: Admin dwara naya gana save karne ke liye
    if (req.method === 'POST') {
      const newSong = req.body;
      if (!newSong.url || !newSong.title) {
        return res.status(400).json({ error: 'Invalid song data' });
      }

      if (!playlist.some(s => s.url === newSong.url)) {
        playlist.push(newSong);
        await savePlaylistToBlob(playlist);
      }
      return res.status(200).json({ success: true, playlist });
    }

    // 3. DELETE: Gaana delete karne ke liye
    if (req.method === 'DELETE') {
      const { index } = req.query;
      if (index !== undefined && playlist[index]) {
        playlist.splice(index, 1);
        await savePlaylistToBlob(playlist);
      }
      return res.status(200).json({ success: true, playlist });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
