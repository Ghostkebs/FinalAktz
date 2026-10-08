// GET /api/players/avatars -> { avatars: { "<lowercase name>": "/uploads/avatars/..." } }
// One tiny request lets every screen (leaderboard, bracket, players…) show avatars.
import { requireAuth } from '../_auth.js';
import { run, avatarUrl } from '../_stats.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;
  try {
    const rows = await run(`SELECT name, avatar_file FROM players WHERE deleted_at IS NULL AND avatar_file IS NOT NULL`);
    const avatars = {};
    for (const r of rows) avatars[String(r.name).toLowerCase()] = avatarUrl(r.avatar_file);
    return res.status(200).json({ avatars });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
