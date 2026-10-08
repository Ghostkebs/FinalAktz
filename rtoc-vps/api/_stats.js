// Shared helpers for the V2 statistics endpoints.
// EVERYTHING here is derived live from the authoritative tables (matches / season_players / seasons).
// Nothing is cached or stored twice, so an admin correcting a result is reflected immediately.
import { sql } from './_db.js';

export const run = (text, params = []) => (typeof sql.query === 'function' ? sql.query(text, params) : sql(text, params));
export const n = (x) => Number(x) || 0;

export const ROUND_LABEL = { qf: 'Quarterfinal', sf: 'Semifinal', third: '3rd Place Playoff', final: 'Final' };

export const avatarUrl = (f) => (f ? `/uploads/avatars/${f}` : null);
export const squadUrl = (f) => (f ? `/uploads/squads/${f}` : null);

/* One row per (player, official match) — each match yields exactly TWO rows, one from each
   player's point of view, whichever slot (A/B) they were stored in. That makes double counting
   impossible and head-to-head symmetric.
   Official = locked, both players known, both scores present, season & cycle not deleted.
   Result is derived from the scores themselves (not winner_id) so corrections are always consistent. */
const OFFICIAL = `m.locked = true AND m.score_a IS NOT NULL AND m.score_b IS NOT NULL
      AND m.player_a_id IS NOT NULL AND m.player_b_id IS NOT NULL`;
const BASE = `FROM matches m
      JOIN seasons s ON s.id = m.season_id AND s.deleted_at IS NULL
      JOIN cycles c ON c.id = s.cycle_id AND c.deleted_at IS NULL
      WHERE ${OFFICIAL}`;

export const PM_SQL = `
pm AS (
  SELECT m.id AS match_id, m.season_id, m.round, m.match_index, m.played_at, s.season_number, c.cycle_number,
         m.player_a_id AS player_id, m.player_b_id AS opp_id, m.score_a AS gf, m.score_b AS ga
  ${BASE}
  UNION ALL
  SELECT m.id, m.season_id, m.round, m.match_index, m.played_at, s.season_number, c.cycle_number,
         m.player_b_id, m.player_a_id, m.score_b, m.score_a
  ${BASE}
),
pmx AS (
  SELECT pm.*,
    CASE WHEN pm.gf > pm.ga THEN 'W' WHEN pm.gf < pm.ga THEN 'L' ELSE 'D' END AS result,
    CASE pm.round WHEN 'qf' THEN 1 WHEN 'sf' THEN 2 WHEN 'third' THEN 3 WHEN 'final' THEN 4 ELSE 0 END AS round_ord
  FROM pm
)`;

export const CHRONO = `cycle_number, season_number, round_ord, match_index, match_id`;
export const CHRONO_DESC = `cycle_number DESC, season_number DESC, round_ord DESC, match_index DESC, match_id DESC`;

export const withPm = (rest, params = []) => run(`WITH ${PM_SQL} ${rest}`, params);

export async function findPlayer(name) {
  if (!name || typeof name !== 'string') return null;
  const rows = await run(`SELECT * FROM players WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL`, [name.trim()]);
  return rows[0] || null;
}
export async function findPlayerById(id) {
  const rows = await run(`SELECT * FROM players WHERE id = $1 AND deleted_at IS NULL`, [id]);
  return rows[0] || null;
}

export const canEditPlayer = (user, player) =>
  !!user && !!player && (user.role === 'admin' || user.role === 'moderator' || (player.user_id != null && String(player.user_id) === String(user.id)));

export const isStaff = (user) => !!user && (user.role === 'admin' || user.role === 'moderator');

export function shapeMatch(r) {
  const gf = n(r.gf), ga = n(r.ga);
  return {
    match_id: r.match_id,
    opponent: r.opp_name,
    opponent_id: r.opp_id,
    gf, ga, gd: gf - ga,
    result: r.result,
    round: r.round,
    round_label: ROUND_LABEL[r.round] || r.round,
    cycle_number: n(r.cycle_number),
    season_number: n(r.season_number),
    played_at: r.played_at || null,
  };
}

/* streaks over a chronological list of 'W'/'L'/'D' */
export function streaks(results) {
  let longest = 0, run_ = 0;
  for (const r of results) {
    if (r === 'W') { run_++; if (run_ > longest) longest = run_; } else run_ = 0;
  }
  let current = 0;
  for (let i = results.length - 1; i >= 0 && results[i] === 'W'; i--) current++;
  return { current, longest };
}

export function summarize(row) {
  const played = n(row?.played), wins = n(row?.wins), losses = n(row?.losses), draws = n(row?.draws);
  const gf = n(row?.gf), ga = n(row?.ga);
  return {
    played, wins, losses, draws,
    win_rate: played ? Math.round((wins / played) * 1000) / 10 : 0,
    gf, ga, gd: gf - ga,
    clean_sheets: n(row?.clean_sheets),
    avg_gf: played ? Math.round((gf / played) * 100) / 100 : 0,
    avg_ga: played ? Math.round((ga / played) * 100) / 100 : 0,
  };
}

export const SUMMARY_COLS = `COUNT(*) AS played,
  SUM(CASE WHEN gf > ga THEN 1 ELSE 0 END) AS wins,
  SUM(CASE WHEN gf < ga THEN 1 ELSE 0 END) AS losses,
  SUM(CASE WHEN gf = ga THEN 1 ELSE 0 END) AS draws,
  COALESCE(SUM(gf), 0) AS gf, COALESCE(SUM(ga), 0) AS ga,
  SUM(CASE WHEN ga = 0 THEN 1 ELSE 0 END) AS clean_sheets`;

/* Career points / rank / cycle champions from season results (same rules as the leaderboard). */
export async function loadStandings() {
  const [rows, done] = await Promise.all([
    run(`SELECT s.cycle_id, c.cycle_number, sp.player_id, p.name, SUM(COALESCE(sp.points, 0)) AS pts, MIN(sp.placement) AS best
         FROM season_players sp
         JOIN seasons s ON s.id = sp.season_id AND s.done = true AND s.deleted_at IS NULL
         JOIN cycles c ON c.id = s.cycle_id AND c.deleted_at IS NULL
         JOIN players p ON p.id = sp.player_id AND p.deleted_at IS NULL
         WHERE sp.deleted_at IS NULL
         GROUP BY s.cycle_id, c.cycle_number, sp.player_id, p.name`),
    run(`SELECT cycle_id, COUNT(*) AS cnt FROM seasons WHERE done = true AND deleted_at IS NULL GROUP BY cycle_id`),
  ]);
  const career = new Map(); // player_id -> points
  const byCycle = new Map(); // cycle_id -> rows
  for (const r of rows) {
    career.set(String(r.player_id), (career.get(String(r.player_id)) || 0) + n(r.pts));
    if (!byCycle.has(String(r.cycle_id))) byCycle.set(String(r.cycle_id), []);
    byCycle.get(String(r.cycle_id)).push(r);
  }
  const doneCount = new Map(done.map((d) => [String(d.cycle_id), n(d.cnt)]));
  const champions = []; // { cycle_number, player_id }
  for (const [cid, list] of byCycle) {
    if ((doneCount.get(cid) || 0) < 10) continue; // a cycle is final once all 10 seasons are done
    list.sort((a, b) => n(b.pts) - n(a.pts) || n(a.best) - n(b.best) || String(a.name).localeCompare(String(b.name)));
    champions.push({ cycle_number: n(list[0].cycle_number), player_id: String(list[0].player_id) });
  }
  return { career, champions };
}
