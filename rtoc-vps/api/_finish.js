// Finishes a season: works out placements + points, marks it done, rebuilds the cycle's streaks.
// Safe to call more than once (idempotent), so it doubles as a "repair" for a stuck season.
import { sql } from './_db.js';

const PTS = [100, 70, 50, 35, 20, 20, 20, 20];
const other = (m, w) => (String(m.player_a_id) === String(w) ? m.player_b_id : m.player_a_id);

export async function finishSeason(season_id) {
  const [season] = await sql`SELECT * FROM seasons WHERE id = ${season_id} AND deleted_at IS NULL`;
  if (!season) return { ok: false, status: 404, error: 'Season not found' };
  const ms = await sql`SELECT * FROM matches WHERE season_id = ${season_id} AND locked = true`;
  const qfs = ms.filter((m) => m.round === 'qf');
  const final = ms.find((m) => m.round === 'final');
  const third = ms.find((m) => m.round === 'third');
  if (qfs.length < 4) return { ok: false, status: 400, error: 'All 4 quarterfinals need results first' };
  if (!final && !third) return { ok: false, status: 400, error: 'The Final and the 3rd-place match still need results' };
  if (!final) return { ok: false, status: 400, error: 'The Final still needs a result' };
  if (!third) return { ok: false, status: 400, error: 'The 3rd-place match still needs a result' };

  const pl = {};
  for (const m of qfs) pl[other(m, m.winner_id)] = 5;
  pl[final.winner_id] = 1; pl[other(final, final.winner_id)] = 2;
  pl[third.winner_id] = 3; pl[other(third, third.winner_id)] = 4;
  for (const [player_id, placement] of Object.entries(pl)) {
    await sql`UPDATE season_players SET placement = ${placement}, points = ${PTS[placement - 1]}
              WHERE season_id = ${season_id} AND player_id = ${player_id}`;
  }
  await sql`UPDATE seasons SET done = true WHERE id = ${season_id}`;

  // Streaks: rebuilt from scratch for the whole cycle, so they can never drift.
  const rows = await sql`
    SELECT sp.player_id, sp.placement, s.season_number
    FROM season_players sp JOIN seasons s ON s.id = sp.season_id
    WHERE s.cycle_id = ${season.cycle_id} AND s.done = true AND s.deleted_at IS NULL
      AND sp.deleted_at IS NULL AND sp.placement IS NOT NULL
    ORDER BY s.season_number ASC`;
  const st = new Map();
  for (const r of rows) {
    const x = st.get(r.player_id) || { cur: 0, best: 0, last: 0 };
    x.cur = r.placement <= 3 ? x.cur + 1 : 0; x.best = Math.max(x.best, x.cur); x.last = r.season_number;
    st.set(r.player_id, x);
  }
  await sql`DELETE FROM streaks WHERE cycle_id = ${season.cycle_id}`;
  for (const [pid, x] of st) {
    await sql`INSERT INTO streaks (player_id, cycle_id, current_streak, best_streak, last_season_n)
              VALUES (${pid}, ${season.cycle_id}, ${x.cur}, ${x.best}, ${x.last})`;
  }
  return { ok: true };
}
