import nodemailer from 'nodemailer';
import { escapeHtml, escapeHtmlMultiline } from '@/lib/security';
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
    // A bounced approval or inquiry mail is invisible to the user, so it has to
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

export function inquiryEmail(args: {
  recipientName: string;
  producerName: string;
  projectName?: string | null;
  subject: string;
  message: string;
  contactEmail: string;
  contactPhone?: string | null;
}) {
  // Every field below is attacker-controlled and this is hand-built HTML, so
  // each one is escaped — React's protection does not extend to mail bodies.
  return shell(
    `New inquiry from ${escapeHtml(args.producerName)}`,
    `<p><strong>${escapeHtml(args.subject)}</strong></p>
     ${args.projectName ? `<p>Project: ${escapeHtml(args.projectName)}</p>` : ''}
     <blockquote style="border-inline-start:3px solid #d4a94f;margin:16px 0;padding:4px 16px">${escapeHtmlMultiline(args.message)}</blockquote>
     <p>Reply to: <a style="color:#4fd1c5" href="mailto:${encodeURIComponent(args.contactEmail)}">${escapeHtml(args.contactEmail)}</a>${
       args.contactPhone ? ` · ${escapeHtml(args.contactPhone)}` : ''
     }</p>`,
  );
}

export function approvalEmail(args: { name: string; approved: boolean; reason?: string | null; loginUrl: string }) {
  return args.approved
    ? shell(
        `Your account is approved`,
        `<p>Hi ${escapeHtml(args.name)}, your Sinemai AI listing is live. Producers can now find and contact you.</p>
         <p><a style="color:#4fd1c5" href="${args.loginUrl}">Open your dashboard</a></p>`,
      )
    : shell(
        `Your application needs changes`,
        `<p>Hi ${escapeHtml(args.name)}, we could not verify your listing yet.</p>
         ${args.reason ? `<p>Reviewer note: ${escapeHtml(args.reason)}</p>` : ''}
         <p><a style="color:#4fd1c5" href="${args.loginUrl}">Update your profile and resubmit</a></p>`,
      );
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

export function inquiryReplyEmail(args: {
  recipientName: string;
  senderName: string;
  subject: string;
  message: string;
  projectName?: string | null;
}) {
  return shell(
    `${escapeHtml(args.senderName)} replied`,
    `<p><strong>${escapeHtml(args.subject)}</strong></p>
     ${args.projectName ? `<p>Project: ${escapeHtml(args.projectName)}</p>` : ''}
     <blockquote style="border-inline-start:3px solid #d4a94f;margin:16px 0;padding:4px 16px">${escapeHtmlMultiline(args.message)}</blockquote>
     <p style="color:#6d7385">Reply from inside Sinemai AI to keep the thread in one place.</p>`,
  );
}
