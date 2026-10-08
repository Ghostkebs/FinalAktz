// GET /api/players/match-history?name=...&page=1&per_page=20
// Paginated match history for a player
import { requireAuth } from '../_auth.js';
import { run, findPlayer, withPm, CHRONO_DESC, shapeMatch } from '../_stats.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;
  const name = String(req.query.name || '');
  const page = Math.max(1, Number(req.query.page) || 1);
  const per = Math.min(50, Math.max(1, Number(req.query.per_page) || 20));
  const offset = (page - 1) * per;

  if (!name) return res.status(400).json({ error: 'Player name required' });
  try {
    const player = await findPlayer(name);
    if (!player) return res.status(404).json({ error: 'Player not found' });

    const [total] = await withPm(`SELECT COUNT(*) AS cnt FROM pmx WHERE player_id = $1`, [player.id]);
    const matches = await withPm(
      `SELECT pmx.*, po.name AS opp_name FROM pmx
       JOIN players po ON po.id = pmx.opp_id
       WHERE pmx.player_id = $1
       ORDER BY ${CHRONO_DESC}
       LIMIT $2 OFFSET $3`,
      [player.id, per, offset]
    );

    const shaped = matches.map((m) => shapeMatch({ ...m, opp_name: m.opp_name }));
    return res.status(200).json({
      total: Number(total?.cnt) || 0,
      page,
      per_page: per,
      matches: shaped,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
