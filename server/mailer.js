'use strict';
/* Outbound mail over SMTP, so any provider works — Resend, Postmark, SES,
   Mailgun, Fastmail, Gmail — by setting env vars rather than changing code.

     SMTP_HOST   smtp.resend.com
     SMTP_PORT   587
     SMTP_USER   resend
     SMTP_PASS   <api key>
     MAIL_FROM   "Loren Oden" <no-reply@lorenoden.com>
     APP_URL     https://lorenoden.com        (used to build the reset link)

   SMTP_ALLOW_INSECURE=true drops the STARTTLS requirement so a local catcher
   such as Mailpit or Mailhog can be used in development. It is ignored when
   NODE_ENV=production, so it cannot weaken a live deployment.                 */
const nodemailer = require('nodemailer');

const cfg = () => ({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  from: process.env.MAIL_FROM || process.env.SMTP_USER,
});

function isConfigured() {
  const c = cfg();
  return Boolean(c.host && c.user && c.pass && c.from);
}

const PROD = () => process.env.NODE_ENV === 'production';
/** Only ever true outside production — a live site always requires TLS. */
function insecureAllowed() {
  const asked = process.env.SMTP_ALLOW_INSECURE === 'true';
  if (asked && PROD()) {
    console.warn('[mailer] SMTP_ALLOW_INSECURE is ignored in production; TLS stays required.');
    return false;
  }
  return asked;
}

let cached = null;
function transport() {
  if (cached) return cached;
  const c = cfg();
  const plain = insecureAllowed();
  cached = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: !plain && c.port === 465,       // implicit TLS on 465, STARTTLS otherwise
    auth: { user: c.user, pass: c.pass },
    requireTLS: !plain && c.port !== 465,
    ignoreTLS: plain,
    tls: plain ? { rejectUnauthorized: false } : undefined,
    // Without these a slow or unreachable mail host leaves the browser
    // waiting on the socket timeout instead of showing an error.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  return cached;
}

/**
 * The public origin to build links from.
 * Never derived from the Host header in production: an attacker who can set
 * it could otherwise have a reset link point at their own server.
 */
function appUrl(req) {
  const configured = (process.env.APP_URL || '').replace(/\/$/, '');
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('APP_URL must be set in production so reset links cannot be spoofed via the Host header.');
  }
  return `${req.protocol}://${req.get('host')}`;
}

const esc = s => String(s).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function resetEmail(url, minutes) {
  const text =
`Someone asked to reset the password for the Loren Oden site portal.

Open this link to choose a new one. It works once and expires in ${minutes} minutes:

${url}

If this wasn't you, nothing has changed and you can ignore this message.`;

  const html = `<!doctype html><html><body style="margin:0;background:#111110;padding:32px 16px;
  font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#F4EFE4">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;
    background:#171714;border:1px solid rgba(244,239,228,.14)">
    <tr><td style="padding:32px">
      <p style="margin:0 0 6px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#E4AD6E">Loren Oden</p>
      <h1 style="margin:0 0 18px;font-size:22px;font-weight:700;color:#F4EFE4">Reset your password</h1>
      <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#BDB9B0">
        Someone asked to reset the password for the site portal. Choose a new one with the
        button below &mdash; it works once and expires in ${minutes} minutes.</p>
      <p style="margin:0 0 26px">
        <a href="${esc(url)}" style="display:inline-block;background:#E4AD6E;color:#17140e;
          text-decoration:none;font-weight:600;font-size:14px;padding:13px 22px">Choose a new password</a></p>
      <p style="margin:0 0 8px;font-size:12px;color:#8A867E">Or paste this into your browser:</p>
      <p style="margin:0 0 24px;font-size:12px;word-break:break-all;color:#BDB9B0">${esc(url)}</p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#8A867E;border-top:1px solid rgba(244,239,228,.12);padding-top:18px">
        If this wasn't you, nothing has changed and you can ignore this message.</p>
    </td></tr></table></body></html>`;

  return { subject: 'Reset your Loren Oden portal password', text, html };
}

/**
 * Send the reset link.
 * With no SMTP configured: in production this throws, because silently not
 * sending would look identical to success. Outside production the link is
 * printed to the server log so the flow stays testable.
 */
async function sendResetEmail(to, url, minutes) {
  const body = resetEmail(url, minutes);
  if (!isConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SMTP is not configured, so the reset email cannot be sent. Set SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM.');
    }
    console.warn(`\n[mailer] SMTP not configured — reset link for ${to}:\n  ${url}\n`);
    return { delivered: false, logged: true };
  }
  await transport().sendMail({ to, from: cfg().from, ...body });
  return { delivered: true };
}

module.exports = { isConfigured, sendResetEmail, appUrl, resetEmail, insecureAllowed, _resetCache: () => { cached = null; } };
