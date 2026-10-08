import nodemailer from 'nodemailer';

function transport() {
  const host = process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com';
  const port = Number(process.env.BREVO_SMTP_PORT) || 587;
  const user = process.env.BREVO_SMTP_USER;
  const pass = process.env.BREVO_SMTP_PASS;
  if (!user || !pass) throw new Error('Email is not configured on this server (BREVO_SMTP_USER / BREVO_SMTP_PASS missing)');
  return nodemailer.createTransport({ host, port, secure: false, auth: { user, pass } });
}

export async function sendResetEmail(to, username, token) {
  const from = process.env.BREVO_FROM_EMAIL || process.env.BREVO_SMTP_USER;
  const base = process.env.APP_URL || 'http://localhost:3000';
  const link = `${base}/?reset=${token}`;
  const t = transport();
  await t.sendMail({
    from: `"Robinhood Tournament" <${from}>`,
    to,
    subject: 'Reset your RTOC password',
    text: `Hi ${username},\n\nClick the link below to reset your password. It expires in 1 hour.\n\n${link}\n\nIf you didn't request this, ignore this email.`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#d6b26a">Reset your password</h2>
      <p>Hi <b>${username}</b>,</p>
      <p>Click the button below to reset your password. The link expires in <b>1 hour</b>.</p>
      <a href="${link}" style="display:inline-block;margin:20px 0;padding:12px 28px;background:#d6b26a;color:#1a1405;font-weight:800;border-radius:10px;text-decoration:none">Reset password</a>
      <p style="color:#888;font-size:12px">If you didn't request this, ignore this email. Your password won't change.</p>
    </div>`,
  });
}
