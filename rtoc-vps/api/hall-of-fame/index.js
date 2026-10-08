// GET /api/hall-of-fame?category=...&cycle_id=...
// cycle_id is optional; omit for all-time, provide for per-cycle stats
import { requireAuth } from '../_auth.js';
import { run, withPm, loadStandings, n, SUMMARY_COLS, streaks } from '../_stats.js';

const CATEGORIES = ['most_titles', 'top_scorers', 'longest_streak', 'most_finals', 'clean_sheets', 'best_win_rate', 'tournament_appearances', 'highest_rating'];

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;
  const cat = String(req.query.category || 'most_titles');
  if (!CATEGORIES.includes(cat)) return res.status(400).json({ error: 'Invalid category' });

  // Optional cycle filter
  const cycleId = req.query.cycle_id ? parseInt(req.query.cycle_id, 10) : null;
  if (req.query.cycle_id && isNaN(cycleId)) return res.status(400).json({ error: 'Invalid cycle_id' });

  try {
    let rows;

    if (cat === 'most_titles') {
      if (cycleId) {
        rows = await run(
          `SELECT p.id, p.name, COUNT(*) AS value, 0 AS secondary
           FROM season_players sp
           JOIN seasons s ON s.id = sp.season_id AND s.done = true AND s.deleted_at IS NULL AND s.cycle_id = $1
           JOIN players p ON p.id = sp.player_id AND p.deleted_at IS NULL
           WHERE sp.deleted_at IS NULL AND sp.placement = 1
           GROUP BY p.id, p.name
           ORDER BY value DESC, p.name ASC LIMIT 50`,
          [cycleId]
        );
      } else {
        rows = await run(
          `SELECT p.id, p.name, COUNT(*) AS value, 0 AS secondary
           FROM season_players sp
           JOIN seasons s ON s.id = sp.season_id AND s.done = true AND s.deleted_at IS NULL
           JOIN players p ON p.id = sp.player_id AND p.deleted_at IS NULL
           WHERE sp.deleted_at IS NULL AND sp.placement = 1
           GROUP BY p.id, p.name
           ORDER BY value DESC, p.name ASC LIMIT 50`
        );
      }

    } else if (cat === 'top_scorers') {
      if (cycleId) {
        rows = await withPm(
          `SELECT p.id, p.name, SUM(gf) AS value, 0 AS secondary
           FROM pmx
           JOIN players p ON p.id = pmx.player_id AND p.deleted_at IS NULL
           JOIN seasons s ON s.id = pmx.season_id AND s.cycle_id = $1 AND s.deleted_at IS NULL
           GROUP BY p.id, p.name
           HAVING SUM(gf) > 0
           ORDER BY value DESC, p.name ASC LIMIT 50`,
          [cycleId]
        );
      } else {
        rows = await withPm(
          `SELECT p.id, p.name, SUM(gf) AS value, 0 AS secondary
           FROM pmx
           JOIN players p ON p.id = pmx.player_id AND p.deleted_at IS NULL
           GROUP BY p.id, p.name
           HAVING SUM(gf) > 0
           ORDER BY value DESC, p.name ASC LIMIT 50`
        );
      }

    } else if (cat === 'longest_streak') {
      let playerList;
      if (cycleId) {
        playerList = await withPm(
          `SELECT DISTINCT pmx.player_id FROM pmx
           JOIN seasons s ON s.id = pmx.season_id AND s.cycle_id = $1 AND s.deleted_at IS NULL
           ORDER BY pmx.player_id`,
          [cycleId]
        );
      } else {
        playerList = await withPm(`SELECT DISTINCT player_id FROM pmx ORDER BY player_id`);
      }

      const streakData = [];
      for (const row of playerList) {
        let results;
        if (cycleId) {
          results = await withPm(
            `SELECT pmx.result FROM pmx
             JOIN seasons s ON s.id = pmx.season_id AND s.cycle_id = $2 AND s.deleted_at IS NULL
             WHERE pmx.player_id = $1
             ORDER BY pmx.cycle_number ASC, pmx.season_number ASC`,
            [row.player_id, cycleId]
          );
        } else {
          results = await withPm(
            `SELECT result FROM pmx WHERE player_id = $1 ORDER BY cycle_number ASC, season_number ASC`,
            [row.player_id]
          );
        }
        const allResults = results.map((r) => r.result);
        const strk = streaks(allResults);
        if (strk.longest > 0) {
          const [p] = await run(`SELECT id, name FROM players WHERE id = $1 AND deleted_at IS NULL`, [row.player_id]);
          if (p) streakData.push({ id: p.id, name: p.name, value: strk.longest, secondary: strk.current });
        }
      }
      rows = streakData.sort((a, b) => n(b.value) - n(a.value) || n(b.secondary) - n(a.secondary) || String(a.name).localeCompare(String(b.name))).slice(0, 50);

    } else if (cat === 'most_finals') {
      if (cycleId) {
        rows = await run(
          `SELECT p.id, p.name, COUNT(*) FILTER (WHERE sp.placement <= 2) AS value, COUNT(*) FILTER (WHERE sp.placement = 1) AS secondary
           FROM season_players sp
           JOIN seasons s ON s.id = sp.season_id AND s.done = true AND s.deleted_at IS NULL AND s.cycle_id = $1
           JOIN players p ON p.id = sp.player_id AND p.deleted_at IS NULL
           WHERE sp.deleted_at IS NULL AND sp.placement <= 2
           GROUP BY p.id, p.name
           ORDER BY value DESC, secondary DESC, p.name ASC LIMIT 50`,
          [cycleId]
        );
      } else {
        rows = await run(
          `SELECT p.id, p.name, COUNT(*) FILTER (WHERE sp.placement <= 2) AS value, COUNT(*) FILTER (WHERE sp.placement = 1) AS secondary
           FROM season_players sp
           JOIN seasons s ON s.id = sp.season_id AND s.done = true AND s.deleted_at IS NULL
           JOIN players p ON p.id = sp.player_id AND p.deleted_at IS NULL
           WHERE sp.deleted_at IS NULL AND sp.placement <= 2
           GROUP BY p.id, p.name
           ORDER BY value DESC, secondary DESC, p.name ASC LIMIT 50`
        );
      }

    } else if (cat === 'clean_sheets') {
      if (cycleId) {
        rows = await withPm(
          `SELECT p.id, p.name, COUNT(CASE WHEN ga = 0 THEN 1 END) AS value, 0 AS secondary
           FROM pmx
           JOIN players p ON p.id = pmx.player_id AND p.deleted_at IS NULL
           JOIN seasons s ON s.id = pmx.season_id AND s.cycle_id = $1 AND s.deleted_at IS NULL
           WHERE ga = 0
           GROUP BY p.id, p.name
           HAVING COUNT(CASE WHEN ga = 0 THEN 1 END) > 0
           ORDER BY value DESC, p.name ASC LIMIT 50`,
          [cycleId]
        );
      } else {
        rows = await withPm(
          `SELECT p.id, p.name, COUNT(CASE WHEN ga = 0 THEN 1 END) AS value, 0 AS secondary
           FROM pmx
           JOIN players p ON p.id = pmx.player_id AND p.deleted_at IS NULL
           WHERE ga = 0
           GROUP BY p.id, p.name
           HAVING COUNT(CASE WHEN ga = 0 THEN 1 END) > 0
           ORDER BY value DESC, p.name ASC LIMIT 50`
        );
      }

    } else if (cat === 'best_win_rate') {
      if (cycleId) {
        rows = await withPm(
          `SELECT p.id, p.name,
             ROUND(100.0 * SUM(CASE WHEN gf > ga THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS value,
             COUNT(*) AS secondary
           FROM pmx
           JOIN players p ON p.id = pmx.player_id AND p.deleted_at IS NULL
           JOIN seasons s ON s.id = pmx.season_id AND s.cycle_id = $1 AND s.deleted_at IS NULL
           GROUP BY p.id, p.name
           HAVING COUNT(*) >= 5
           ORDER BY value DESC, secondary DESC, p.name ASC LIMIT 50`,
          [cycleId]
        );
      } else {
        rows = await withPm(
          `SELECT p.id, p.name,
             ROUND(100.0 * SUM(CASE WHEN gf > ga THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS value,
             COUNT(*) AS secondary
           FROM pmx
           JOIN players p ON p.id = pmx.player_id AND p.deleted_at IS NULL
           GROUP BY p.id, p.name
           HAVING COUNT(*) >= 5
           ORDER BY value DESC, secondary DESC, p.name ASC LIMIT 50`
        );
      }

    } else if (cat === 'tournament_appearances') {
      if (cycleId) {
        rows = await run(
          `SELECT p.id, p.name, COUNT(DISTINCT sp.season_id) AS value, 0 AS secondary
           FROM season_players sp
           JOIN seasons s ON s.id = sp.season_id AND s.deleted_at IS NULL AND s.cycle_id = $1
           JOIN players p ON p.id = sp.player_id AND p.deleted_at IS NULL
           WHERE sp.deleted_at IS NULL
           GROUP BY p.id, p.name
           ORDER BY value DESC, p.name ASC LIMIT 50`,
          [cycleId]
        );
      } else {
        rows = await run(
          `SELECT p.id, p.name, COUNT(DISTINCT sp.season_id) AS value, 0 AS secondary
           FROM season_players sp
           JOIN seasons s ON s.id = sp.season_id AND s.deleted_at IS NULL
           JOIN players p ON p.id = sp.player_id AND p.deleted_at IS NULL
           WHERE sp.deleted_at IS NULL
           GROUP BY p.id, p.name
           ORDER BY value DESC, p.name ASC LIMIT 50`
        );
      }

    } else if (cat === 'highest_rating') {
      // Career points as a proxy for rating
      // For per-cycle: only count points from seasons within that cycle
      let careerPoints;
      if (cycleId) {
        // Sum points from season_players for completed seasons in this cycle
        const ptRows = await run(
          `SELECT sp.player_id, SUM(sp.points) AS pts
           FROM season_players sp
           JOIN seasons s ON s.id = sp.season_id AND s.done = true AND s.deleted_at IS NULL AND s.cycle_id = $1
           WHERE sp.deleted_at IS NULL AND sp.points IS NOT NULL
           GROUP BY sp.player_id`,
          [cycleId]
        );
        careerPoints = new Map(ptRows.map(r => [String(r.player_id), Number(r.pts)]));
      } else {
        ({ career: careerPoints } = await loadStandings());
      }

      const all = [];
      for (const [pid, pts] of careerPoints) {
        const [p] = await run(`SELECT id, name FROM players WHERE id = CAST($1 AS INTEGER) AND deleted_at IS NULL`, [pid]);
        if (p) all.push({ id: p.id, name: p.name, value: pts, secondary: 0 });
      }
      rows = all.sort((a, b) => n(b.value) - n(a.value) || String(a.name).localeCompare(String(b.name))).slice(0, 50);
    }

    return res.status(200).json({ category: cat, cycle_id: cycleId, players: rows || [] });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
