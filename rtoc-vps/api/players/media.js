// POST   /api/players/media?player_id=&kind=avatar|squad   body = raw image bytes
// DELETE /api/players/media?player_id=&kind=avatar|squad
// Only the linked owner of the player (or an admin/moderator) may change it.
import { requireAuth } from '../_auth.js';
import { run, findPlayerById, canEditPlayer, avatarUrl, squadUrl } from '../_stats.js';
import { KINDS, readBody, processImage, saveImage, removeImage, uploadAllowed } from '../_images.js';

const COL = { avatar: 'avatar_file', squad: 'squad_file' };

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
  const user = requireAuth(req, res);
  if (!user) return;

  const kind = String(req.query.kind || '');
  if (!KINDS[kind]) return res.status(400).json({ error: 'kind must be avatar or squad' });
  const playerId = Number(req.query.player_id);
  if (!Number.isInteger(playerId) || playerId <= 0) return res.status(400).json({ error: 'player_id required' });

  try {
    const player = await findPlayerById(playerId);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    if (!canEditPlayer(user, player)) return res.status(403).json({ error: 'You can only change your own pictures' });

    const oldFile = player[COL[kind]];

    if (req.method === 'DELETE') {
      if (kind === 'avatar') await run(`UPDATE players SET avatar_file = NULL WHERE id = $1`, [playerId]);
      else await run(`UPDATE players SET squad_file = NULL WHERE id = $1`, [playerId]);
      removeImage(kind, oldFile);
      return res.status(200).json({ avatar_url: kind === 'avatar' ? null : avatarUrl(player.avatar_file), squad_url: kind === 'squad' ? null : squadUrl(player.squad_file) });
    }

    const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(ct) || req.readableEnded) {
      return res.status(415).json({ error: 'Send the image as JPG, PNG or WebP' });
    }
    if (!uploadAllowed(user.id)) return res.status(429).json({ error: 'Too many uploads. Try again later.' });

    const raw = await readBody(req, KINDS[kind].maxBytes);
    if (!raw.length) return res.status(400).json({ error: 'Empty upload' });
    const out = await processImage(raw, kind);
    const file = saveImage(out, kind, playerId);
    try {
      if (kind === 'avatar') await run(`UPDATE players SET avatar_file = $1 WHERE id = $2`, [file, playerId]);
      else await run(`UPDATE players SET squad_file = $1 WHERE id = $2`, [file, playerId]);
    } catch (e) {
      removeImage(kind, file); // don't leave an orphan if the DB write failed
      throw e;
    }
    removeImage(kind, oldFile); // replacing → old file is deleted, storage stays flat
    return res.status(200).json({
      avatar_url: kind === 'avatar' ? avatarUrl(file) : avatarUrl(player.avatar_file),
      squad_url: kind === 'squad' ? squadUrl(file) : squadUrl(player.squad_file),
      bytes: out.length,
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
