// GET /api/players/advanced-stats?name=...
// Deep dive: form, tournament performance, goal stats, streaks
import { requireAuth } from '../_auth.js';
import { run, findPlayer, withPm, CHRONO_DESC, CHRONO, streaks, summarize, SUMMARY_COLS } from '../_stats.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;
  const name = String(req.query.name || '');
  if (!name) return res.status(400).json({ error: 'Player name required' });

  try {
    const player = await findPlayer(name);
    if (!player) return res.status(404).json({ error: 'Player not found' });

    // Career
    const [career] = await withPm(`SELECT ${SUMMARY_COLS} FROM pmx WHERE player_id = $1`, [player.id]);
    const careerStats = summarize(career);

    // Form: last 5 results
    const last5 = await withPm(`SELECT result FROM pmx WHERE player_id = $1 ORDER BY ${CHRONO_DESC} LIMIT 5`, [player.id]);
    const l5 = last5.map((r) => r.result).reverse(); // chronological
    const formStreaks = streaks(l5);

    // Longest streak ever
    const all = await withPm(`SELECT result FROM pmx WHERE player_id = $1 ORDER BY ${CHRONO}`, [player.id]);
    const allResults = all.map((r) => r.result);
    const allStreaks = streaks(allResults);

    // Tournament performance (season placements)
    const seasons = await run(
      `SELECT sp.placement, sp.points, s.season_number, c.cycle_number
       FROM season_players sp
       JOIN seasons s ON s.id = sp.season_id AND s.done = true AND s.deleted_at IS NULL
       JOIN cycles c ON c.id = s.cycle_id AND c.deleted_at IS NULL
       WHERE sp.player_id = $1 AND sp.deleted_at IS NULL
       ORDER BY c.cycle_number DESC, s.season_number DESC
       LIMIT 50`,
      [player.id]
    );
    const placement1 = seasons.filter((s) => s.placement === 1).length;
    const placement3 = seasons.filter((s) => s.placement <= 3).length;

    // Goal stats — biggest win/loss picked by goal difference (ties broken by most goals scored)
    const [goals] = await withPm(
      `SELECT
         (SELECT gf FROM pmx WHERE player_id = $1 AND gf > ga ORDER BY (gf-ga) DESC, gf DESC LIMIT 1) AS biggest_win_gf,
         (SELECT ga FROM pmx WHERE player_id = $1 AND gf > ga ORDER BY (gf-ga) DESC, gf DESC LIMIT 1) AS biggest_win_ga,
         (SELECT gf FROM pmx WHERE player_id = $1 AND gf < ga ORDER BY (ga-gf) DESC, ga DESC LIMIT 1) AS biggest_loss_gf,
         (SELECT ga FROM pmx WHERE player_id = $1 AND gf < ga ORDER BY (ga-gf) DESC, ga DESC LIMIT 1) AS biggest_loss_ga,
         (SELECT COUNT(*) FROM pmx WHERE player_id = $1 AND ga = 0) AS clean_sheets`,
      [player.id]
    );

    // Cycle-by-cycle
    const byC = {};
    for (const s of seasons) {
      const k = `c${s.cycle_number}`;
      if (!byC[k]) byC[k] = { cycle_number: s.cycle_number, seasons: [], points: 0, titles: 0 };
      byC[k].seasons.push(s);
      byC[k].points += s.points;
      if (s.placement === 1) byC[k].titles++;
    }

    return res.status(200).json({
      player: { id: player.id, name: player.name },
      career: careerStats,
      form: { last5: l5, current_streak: formStreaks.current, longest_streak: formStreaks.longest },
      streaks: { longest: allStreaks.longest, current: formStreaks.current },
      tournament: {
        appearances: seasons.length,
        titles: placement1,
        podiums: placement3,
      },
      goals: {
        biggest_win: goals?.biggest_win_gf ? `${goals.biggest_win_gf}–${goals.biggest_win_ga}` : '–',
        biggest_loss: goals?.biggest_loss_gf ? `${goals.biggest_loss_gf}–${goals.biggest_loss_ga}` : '–',
        clean_sheets: goals?.clean_sheets || 0,
      },
      cycles: Object.values(byC),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
