// GET /api/players/dashboard?name=PlayerName
// Returns everything for the player dashboard: career stats, recent 3 matches, trophies, etc.
import { requireAuth } from '../_auth.js';
import { run, findPlayer, withPm, CHRONO_DESC, shapeMatch, summarize, SUMMARY_COLS, avatarUrl, squadUrl, loadStandings } from '../_stats.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;
  const name = String(req.query.name || '');
  if (!name) return res.status(400).json({ error: 'Player name required' });

  try {
    const player = await findPlayer(name);
    if (!player) return res.status(404).json({ error: 'Player not found' });

    // Career stats (all seasons)
    const [career] = await withPm(`SELECT ${SUMMARY_COLS} FROM pmx WHERE player_id = $1`, [player.id]);
    const careerStats = summarize(career);

    // Recent 3 matches
    const recent = await withPm(
      `SELECT * FROM pmx WHERE player_id = $1 ORDER BY ${CHRONO_DESC} LIMIT 3`,
      [player.id]
    );
    const recentMatches = recent.map((r) => shapeMatch({ ...r, opp_name: null }));
    // backfill opponent names
    for (const m of recentMatches) {
      const [opp] = await run(`SELECT name FROM players WHERE id = $1`, [m.opponent_id]);
      m.opponent = opp?.name || 'Unknown';
    }

    // Trophies (titles in completed seasons)
    const trophies = await run(
      `SELECT DISTINCT s.season_number, c.cycle_number, sp.placement
       FROM season_players sp
       JOIN seasons s ON s.id = sp.season_id AND s.done = true AND s.deleted_at IS NULL
       JOIN cycles c ON c.id = s.cycle_id AND c.deleted_at IS NULL
       WHERE sp.player_id = $1 AND sp.deleted_at IS NULL AND sp.placement = 1
       ORDER BY c.cycle_number DESC, s.season_number DESC`,
      [player.id]
    );

    // Current streak in the active cycle
    const [activeCycle] = await run(
      `SELECT c.id, c.cycle_number FROM cycles c
       WHERE c.deleted_at IS NULL
       ORDER BY c.cycle_number DESC LIMIT 1`
    );
    let streak = { current: 0, longest: 0 };
    if (activeCycle) {
      const results = await withPm(
        `SELECT result FROM pmx
         WHERE player_id = $1 AND cycle_number = $2
         ORDER BY ${CHRONO_DESC}`,
        [player.id, activeCycle.cycle_number]
      );
      if (results.length > 0) {
        let longest = 0, run_ = 0;
        for (const r of results) {
          if (r.result === 'W') {
            run_++;
            if (run_ > longest) longest = run_;
          } else run_ = 0;
        }
        let current = 0;
        for (let i = 0; i < results.length && results[i].result === 'W'; i++) current++;
        streak = { current, longest };
      }
    }

    // Standings (for rank)
    const { career: careerPoints } = await loadStandings();
    const totalCareerPoints = careerPoints.get(String(player.id)) || 0;

    return res.status(200).json({
      player: {
        id: player.id,
        name: player.name,
        avatar_url: avatarUrl(player.avatar_file),
        squad_url: squadUrl(player.squad_file),
        squad_team: player.squad_team || null,
        squad_formation: player.squad_formation || null,
        claimed: !!player.user_id,
      },
      career: {
        ...careerStats,
        career_points: totalCareerPoints,
        titles: trophies.length,
      },
      streak,
      recent_matches: recentMatches,
      trophies,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
