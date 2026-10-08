import { requireAdmin } from '../_auth.js';
import { finishSeason } from '../_finish.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;
  const { season_id } = req.body || {};
  if (!season_id) return res.status(400).json({ error: 'season_id required' });
  try {
    const r = await finishSeason(season_id);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    return res.status(200).json({ message: 'Tournament finished' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
