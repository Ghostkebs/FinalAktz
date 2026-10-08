// POST /api/players/squad-info  { player_id, team, formation }
import { requireAuth } from '../_auth.js';
import { run, findPlayerById, canEditPlayer } from '../_stats.js';

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = requireAuth(req, res);
  if (!user) return;
  const { player_id, team, formation } = req.body || {};
  const t = clean(team, 40);
  const f = clean(formation, 14);
  if (f && !/^[0-9]{1,2}(-[0-9]{1,2}){1,4}$/.test(f)) return res.status(400).json({ error: 'Formation should look like 4-3-3 or 4-2-1-3' });
  try {
    const player = await findPlayerById(Number(player_id));
    if (!player) return res.status(404).json({ error: 'Player not found' });
    if (!canEditPlayer(user, player)) return res.status(403).json({ error: 'You can only edit your own squad info' });
    await run(`UPDATE players SET squad_team = $1, squad_formation = $2 WHERE id = $3`, [t || null, f || null, player.id]);
    return res.status(200).json({ squad_team: t || null, squad_formation: f || null });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
