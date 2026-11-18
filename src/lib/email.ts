import { Nuntly } from "@nuntly/sdk";
import { formatDate, formatDateTime } from "@/lib/format";

let client: Nuntly | null = null;

function getClient(): Nuntly | null {
  if (!process.env.NUNTLY_API_KEY) return null;
  client ??= new Nuntly({ apiKey: process.env.NUNTLY_API_KEY });
  return client;
}

function fromAddress() {
  return (
    process.env.NUNTLY_FROM_EMAIL ?? "Gold Beach Youth Sports <noreply@goldbeachyouthsports.org>"
  );
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  const nuntly = getClient();
  if (!nuntly) {
    // No API key configured (local dev / CI): log instead of sending.
    console.log(`[EMAIL not sent: NUNTLY_API_KEY missing] to=${to} subject="${subject}"\n${html}`);
    return;
  }
  await nuntly.emails.send({ from: fromAddress(), to, subject, html });
}

function layout(body: string) {
  return `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">${body}</div>`;
}

function button(href: string, label: string) {
  return `<p style="margin: 24px 0;"><a href="${escapeHtml(href)}" style="background: #0f172a; color: #ffffff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">${escapeHtml(label)}</a></p>`;
}

export async function sendMagicLinkEmail({ to, url }: { to: string; url: string }) {
  return sendEmail({
    to,
    subject: "Sign in to Gold Beach Youth Sports",
    html: layout(`
        <h2>Gold Beach Youth Sports</h2>
        <p>Click the button below to sign in to your account:</p>
        ${button(url, "Sign In to GBYS")}
        <p style="color: #64748b; font-size: 13px;">This link expires in 10 minutes. If you didn't request this email, you can safely ignore it.</p>
    `),
  });
}

export async function sendCredentialExpiringEmail({
  to,
  volunteerName,
  credentialName,
  expiresAtDate,
}: {
  to: string;
  volunteerName: string;
  credentialName: string;
  expiresAtDate: string;
}) {
  return sendEmail({
    to,
    subject: `Action Needed: Your ${credentialName} expires on ${expiresAtDate}`,
    html: layout(`
        <h2>Volunteer Clearance Reminder</h2>
        <p>Hi ${escapeHtml(volunteerName)},</p>
        <p>Your <strong>${escapeHtml(credentialName)}</strong> on file with Gold Beach Youth Sports is scheduled to expire on <strong>${escapeHtml(expiresAtDate)}</strong>.</p>
        <p>Please renew your clearance through your league partner portal and upload your updated confirmation receipt in the GBYS Volunteer Portal so there is no interruption to your coaching or volunteer eligibility.</p>
    `),
  });
}

export async function sendGuardianInviteEmail({
  to,
  inviterName,
  athleteNames,
  acceptUrl,
}: {
  to: string;
  inviterName: string;
  athleteNames: string[];
  acceptUrl: string;
}) {
  const names = athleteNames.map(escapeHtml).join(", ");
  return sendEmail({
    to,
    subject: `${inviterName} invited you to join their household on GBYS`,
    html: layout(`
        <h2>Gold Beach Youth Sports</h2>
        <p><strong>${escapeHtml(inviterName)}</strong> has invited you to be a guardian for <strong>${names}</strong> on the GBYS platform.</p>
        <p>Sign in with this email address (${escapeHtml(to)}) and accept the invitation:</p>
        ${button(acceptUrl, "View Invitation")}
        <p style="color: #64748b; font-size: 13px;">This invitation expires in 7 days. If you weren't expecting it, you can safely ignore this email.</p>
    `),
  });
}

export async function sendCredentialReviewedEmail({
  to,
  name,
  credentialName,
  decision,
  notes,
}: {
  to: string;
  name: string;
  credentialName: string;
  decision: "verified" | "rejected";
  notes?: string;
}) {
  const approved = decision === "verified";
  return sendEmail({
    to,
    subject: approved
      ? `Your ${credentialName} has been verified`
      : `Action needed: your ${credentialName} was not accepted`,
    html: layout(`
        <h2>Volunteer Clearance Update</h2>
        <p>Hi ${escapeHtml(name)},</p>
        ${
          approved
            ? `<p>Your <strong>${escapeHtml(credentialName)}</strong> has been reviewed and <strong>verified</strong>. Thank you!</p>`
            : `<p>Your <strong>${escapeHtml(credentialName)}</strong> was reviewed but could <strong>not be accepted</strong>. Please review the notes below and upload a new submission in the GBYS Volunteer Portal.</p>`
        }
        ${notes ? `<p style="background: #f1f5f9; padding: 12px; border-radius: 6px;">${escapeHtml(notes)}</p>` : ""}
    `),
  });
}

export async function sendComplianceLapseAlertEmail({
  to,
  recipientName,
  coachName,
  programName,
  credentialName,
  expiredAt,
}: {
  to: string;
  recipientName: string;
  coachName: string;
  programName: string;
  credentialName: string;
  expiredAt: Date;
}) {
  // Dates are always rendered in America/Los_Angeles (invariant 9).
  const expiredOn = formatDate(expiredAt);
  return sendEmail({
    to,
    subject: `Compliance lapse: ${coachName} (${programName}) - ${credentialName} expired`,
    html: layout(`
        <h2>Coach Compliance Lapse</h2>
        <p>Hi ${escapeHtml(recipientName)},</p>
        <p><strong>${escapeHtml(coachName)}</strong>, a coach in <strong>${escapeHtml(programName)}</strong>, no longer has a current <strong>${escapeHtml(credentialName)}</strong>. It expired on <strong>${escapeHtml(expiredOn)}</strong>, and this credential is required for the program.</p>
        <p>Please follow up with the coach to renew and upload their updated clearance in the GBYS Volunteer Portal before they continue coaching.</p>
    `),
  });
}

/** Notice that a director's vote is requested on an action without a meeting. */
export async function sendBoardVoteRequestEmail({
  to,
  recipientName,
  motionTitle,
  closesAt,
  voteUrl,
}: {
  to: string;
  recipientName: string;
  motionTitle: string;
  closesAt: Date;
  voteUrl: string;
}) {
  // Dates are always rendered in America/Los_Angeles (invariant 9).
  const deadline = formatDateTime(closesAt);
  return sendEmail({
    to,
    subject: `Board vote requested: ${motionTitle}`,
    html: layout(`
        <h2>Board action without a meeting</h2>
        <p>Hi ${escapeHtml(recipientName)},</p>
        <p>Your vote is requested on <strong>${escapeHtml(motionTitle)}</strong>. Voting closes <strong>${escapeHtml(deadline)}</strong> (Pacific time).</p>
        <p>An action without a meeting passes only if <strong>every</strong> eligible director votes yes. Any no or abstain vote, or a missing vote at the deadline, means it does not pass. Your vote is final once recorded.</p>
        ${button(voteUrl, "Review and vote")}
    `),
  });
}
