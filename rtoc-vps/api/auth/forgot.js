import { sql } from '../_db.js';
import { sendResetEmail } from '../_mailer.js';
import crypto from 'node:crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'Username required' });
  // Always return 200 so we don't reveal which usernames exist
  try {
    const [user] = await sql`SELECT id, username, email FROM users WHERE username = ${username} AND deleted_at IS NULL`;
    if (user?.email) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await sql`DELETE FROM password_resets WHERE user_id = ${user.id}`;
      await sql`INSERT INTO password_resets (user_id, token, expires_at) VALUES (${user.id}, ${token}, ${expires})`;
      await sendResetEmail(user.email, user.username, token);
    }
  } catch (e) { console.error('[forgot]', e); }
  return res.status(200).json({ message: 'If that username has an email on file, a reset link has been sent.' });
}
