// V2 migration — additive and idempotent. Runs at every server start.
// Only ADDs nullable columns / indexes. Never drops, renames or rewrites existing data.
import { sql } from './_db.js';

const run = (text, params = []) => (typeof sql.query === 'function' ? sql.query(text, params) : sql(text, params));

const STATEMENTS = [
  // link between a login account (users) and a player record — TEXT so it works whatever type users.id is
  `ALTER TABLE players ADD COLUMN IF NOT EXISTS user_id TEXT`,
  `ALTER TABLE players ADD COLUMN IF NOT EXISTS avatar_file TEXT`,
  `ALTER TABLE players ADD COLUMN IF NOT EXISTS squad_file TEXT`,
  `ALTER TABLE players ADD COLUMN IF NOT EXISTS squad_team TEXT`,
  `ALTER TABLE players ADD COLUMN IF NOT EXISTS squad_formation TEXT`,
  // when an official result was locked (lets match history show real dates)
  `ALTER TABLE matches ADD COLUMN IF NOT EXISTS played_at TIMESTAMPTZ`,
  // one login account can own at most one (non-deleted) player
  `CREATE UNIQUE INDEX IF NOT EXISTS players_user_id_uq ON players (user_id) WHERE user_id IS NOT NULL AND deleted_at IS NULL`,
  // indexes for the stats queries
  `CREATE INDEX IF NOT EXISTS idx_v2_matches_a ON matches (player_a_id)`,
  `CREATE INDEX IF NOT EXISTS idx_v2_matches_b ON matches (player_b_id)`,
  `CREATE INDEX IF NOT EXISTS idx_v2_matches_season ON matches (season_id, round)`,
  `CREATE INDEX IF NOT EXISTS idx_v2_sp_player ON season_players (player_id)`,
  `CREATE INDEX IF NOT EXISTS idx_v2_sp_season ON season_players (season_id)`,
  `CREATE INDEX IF NOT EXISTS idx_v2_seasons_cycle ON seasons (cycle_id)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (email) WHERE email IS NOT NULL AND deleted_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS password_resets (
    id SERIAL PRIMARY KEY, user_id INT NOT NULL, token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS idx_pr_token ON password_resets (token)`,
  `CREATE INDEX IF NOT EXISTS idx_pr_user ON password_resets (user_id)`,
];

export async function runMigrations() {
  for (const st of STATEMENTS) await run(st);

  // One-time best-effort backfill of played_at for results locked before V2,
  // using whichever timestamp column already exists (never overwrites a real value).
  const cols = await run(
    `SELECT table_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND column_name = 'created_at' AND table_name IN ('matches','seasons')`
  );
  const has = new Set(cols.map((r) => r.table_name));
  if (has.has('matches')) {
    await run(`UPDATE matches SET played_at = created_at WHERE played_at IS NULL AND locked = true AND created_at IS NOT NULL`);
  } else if (has.has('seasons')) {
    await run(
      `UPDATE matches SET played_at = (SELECT s.created_at FROM seasons s WHERE s.id = matches.season_id)
       WHERE played_at IS NULL AND locked = true`
    );
  }
  console.log('[migrate] V2 schema ready');
}
