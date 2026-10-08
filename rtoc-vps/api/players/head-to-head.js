// GET /api/players/head-to-head?player1=...&player2=...
// Symmetrical H2H: never double-counts, works regardless of match storage order
import { requireAuth } from '../_auth.js';
import { run, findPlayer, withPm, CHRONO_DESC, shapeMatch, summarize, SUMMARY_COLS } from '../_stats.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;
  const n1 = String(req.query.player1 || ''), n2 = String(req.query.player2 || '');
  if (!n1 || !n2) return res.status(400).json({ error: 'player1 and player2 required' });

  try {
    const p1 = await findPlayer(n1), p2 = await findPlayer(n2);
    if (!p1 || !p2) return res.status(404).json({ error: 'One or both players not found' });
    if (p1.id === p2.id) return res.status(400).json({ error: 'Choose two different players' });

    // H2H in both directions (but each match only once: p1.opp_id = p2.id)
    const h2h = await withPm(
      `SELECT pmx.*, po.name AS opp_name FROM pmx
       JOIN players po ON po.id = pmx.opp_id
       WHERE pmx.player_id = $1 AND pmx.opp_id = $2
       ORDER BY ${CHRONO_DESC}`,
      [p1.id, p2.id]
    );
    const shaped = h2h.map((m) => shapeMatch({ ...m, opp_name: m.opp_name }));

    // Summary for both players in this H2H
    const [stats1] = await withPm(
      `SELECT ${SUMMARY_COLS} FROM pmx WHERE player_id = $1 AND opp_id = $2`,
      [p1.id, p2.id]
    );
    const [stats2] = await withPm(
      `SELECT ${SUMMARY_COLS} FROM pmx WHERE player_id = $1 AND opp_id = $2`,
      [p2.id, p1.id]
    );

    return res.status(200).json({
      players: [
        { name: p1.name, id: p1.id, stats: summarize(stats1) },
        { name: p2.name, id: p2.id, stats: summarize(stats2) },
      ],
      recent: shaped.slice(0, 5),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
