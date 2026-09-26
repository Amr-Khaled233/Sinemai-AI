import nodemailer from 'nodemailer';
import { escapeHtml } from '@/lib/security';
import { reportError } from '@/lib/observability';

/**
 * Mail goes out through a Gmail account over SMTP, authenticated with an App
 * Password (Google Account → Security → 2-Step Verification → App passwords).
 * Google shows the password in groups of four; the spaces are not part of it.
 */
const GMAIL_USER = process.env.GMAIL_USER?.trim();
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '');

const transport =
  GMAIL_USER && GMAIL_APP_PASSWORD
    ? nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } })
    : null;

// Gmail rewrites any other sender address to the signed-in account, so the
// default says so honestly rather than promising a domain it will not use.
const FROM = process.env.EMAIL_FROM ?? `Sinemai AI <${GMAIL_USER ?? 'noreply@sinemai.ai'}>`;

type Mail = { to: string | string[]; subject: string; html: string; replyTo?: string };

/** Sends via Gmail when configured; otherwise logs so local dev stays unblocked. */
export async function sendEmail({ to, subject, html, replyTo }: Mail) {
  if (!transport) {
    console.info('[email:dev]', { to, subject, replyTo });
    return { delivered: false as const };
  }
  try {
    await transport.sendMail({
      from: FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
    });
  } catch (error) {
    // A bounced reset mail is invisible to the user, so it has to
    // be visible to us.
    reportError(error, { scope: 'email:send', severity: 'warning', extra: { subject } });
    return { delivered: false as const };
  }
  return { delivered: true as const };
}

function shell(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#0d0f14;font-family:system-ui,-apple-system,Segoe UI,Tahoma,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;color:#e9eaee">
    <div style="font-size:13px;letter-spacing:.18em;color:#d4a94f;text-transform:uppercase">Sinemai AI</div>
    <h1 style="font-size:20px;margin:12px 0 16px;color:#fff">${title}</h1>
    <div style="font-size:15px;line-height:1.7;color:#b9bdc9">${body}</div>
    <p style="margin-top:28px;font-size:12px;color:#6d7385">سينمائي · Sinemai AI — Production intelligence for film &amp; advertising.</p>
  </div></body></html>`;
}

export function resetEmail(args: { name: string; locale: string; url: string; ttlMinutes: number }) {
  return args.locale === 'ar'
    ? shell(
        'إعادة تعيين كلمة المرور',
        `<p>مرحباً ${escapeHtml(args.name)}، وصلنا طلب لإعادة تعيين كلمة مرور حسابك في سينمائي AI.</p>
         <p><a style="color:#4fd1c5" href="${args.url}">اضغط هنا لتعيين كلمة مرور جديدة</a></p>
         <p>الرابط صالح لمدة ${args.ttlMinutes} دقيقة ويُستخدم مرة واحدة. إن لم تطلب ذلك، تجاهل هذه الرسالة ولن يتغيّر شيء.</p>`,
      )
    : shell(
        'Reset your password',
        `<p>Hi ${escapeHtml(args.name)}, we received a request to reset your Sinemai AI password.</p>
         <p><a style="color:#4fd1c5" href="${args.url}">Choose a new password</a></p>
         <p>The link is valid for ${args.ttlMinutes} minutes and can be used once. If you did not request this, ignore this email — nothing changes.</p>`,
      );
}
