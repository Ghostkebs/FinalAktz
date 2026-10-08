import bcrypt from 'bcryptjs';
import { sql } from '../_db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Token and new password required' });
  if (password.length < 8 || password.length > 72) return res.status(400).json({ error: 'Password must be 8–72 characters' });
  try {
    const [row] = await sql`SELECT * FROM password_resets WHERE token = ${token} AND expires_at > NOW()`;
    if (!row) return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
    const hash = await bcrypt.hash(password, 10);
    await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${row.user_id}`;
    await sql`DELETE FROM password_resets WHERE user_id = ${row.user_id}`;
    return res.status(200).json({ message: 'Password updated. You can now sign in.' });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Server error' }); }
}
