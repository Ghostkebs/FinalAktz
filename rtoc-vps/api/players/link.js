// Links a login account to a player record (needed so players can edit only THEIR OWN profile).
//   GET  /api/players/link              -> { player, candidate }   (my linked player / a claimable name match)
//   GET  /api/players/link?users=1      -> admin/mod: accounts + which player each is linked to
//   POST { action:'claim',  player_id }               any user: only if username == player name and it's unclaimed
//   POST { action:'link',   player_id, user_id }      admin/mod
//   POST { action:'unlink', player_id }               admin/mod
import { requireAuth } from '../_auth.js';
import { run, findPlayerById, isStaff } from '../_stats.js';

export default async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  try {
    if (req.method === 'GET') {
      if (req.query.users) {
        if (!isStaff(user)) return res.status(403).json({ error: 'Forbidden' });
        const users = await run(
          `SELECT u.id, u.username, u.role, p.id AS player_id, p.name AS player_name
           FROM users u LEFT JOIN players p ON p.user_id = CAST(u.id AS TEXT) AND p.deleted_at IS NULL
           WHERE u.deleted_at IS NULL ORDER BY LOWER(u.username) LIMIT 500`
        );
        return res.status(200).json({ users });
      }
      const [mine] = await run(`SELECT id, name FROM players WHERE user_id = $1 AND deleted_at IS NULL`, [String(user.id)]);
      let candidate = null;
      if (!mine) {
        const [c] = await run(
          `SELECT id, name FROM players WHERE LOWER(name) = LOWER($1) AND user_id IS NULL AND deleted_at IS NULL`,
          [String(user.username || '')]
        );
        candidate = c || null;
      }
      return res.status(200).json({ player: mine || null, candidate });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { action, player_id, user_id } = req.body || {};
    const player = await findPlayerById(Number(player_id));
    if (!player) return res.status(404).json({ error: 'Player not found' });

    if (action === 'claim') {
      if (player.user_id) return res.status(409).json({ error: 'This player is already linked to an account' });
      try {
        await run(`UPDATE players SET user_id = $1 WHERE id = $2 AND user_id IS NULL`, [String(user.id), player.id]);
      } catch (e) {
        if (e.code === '23505') return res.status(409).json({ error: 'Your account is already linked to another player' });
        throw e;
      }
      return res.status(200).json({ message: 'Linked', player: { id: player.id, name: player.name } });
    }

    if (!isStaff(user)) return res.status(403).json({ error: 'Forbidden' });

    if (action === 'unlink') {
      await run(`UPDATE players SET user_id = NULL WHERE id = $1`, [player.id]);
      return res.status(200).json({ message: 'Unlinked' });
    }
    if (action === 'link') {
      if (user_id === undefined || user_id === null || user_id === '') return res.status(400).json({ error: 'user_id required' });
      const [target] = await run(`SELECT id, username FROM users WHERE CAST(id AS TEXT) = $1 AND deleted_at IS NULL`, [String(user_id)]);
      if (!target) return res.status(404).json({ error: 'Account not found' });
      const [other] = await run(`SELECT name FROM players WHERE user_id = $1 AND deleted_at IS NULL AND id <> $2`, [String(target.id), player.id]);
      if (other) return res.status(409).json({ error: `${target.username} is already linked to ${other.name}. Unlink that first.` });
      await run(`UPDATE players SET user_id = $1 WHERE id = $2`, [String(target.id), player.id]);
      return res.status(200).json({ message: 'Linked' });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
