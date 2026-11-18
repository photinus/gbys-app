import { Nuntly } from "@nuntly/sdk";

const nuntly = new Nuntly({
  apiKey: process.env.NUNTLY_API_KEY!,
});

const FROM_ADDRESS =
  process.env.NUNTLY_FROM_EMAIL ?? "Gold Beach Youth Sports <noreply@goldbeachyouthsports.org>";

export async function sendMagicLinkEmail({ to, url }: { to: string; url: string }) {
  return nuntly.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: "Sign in to Gold Beach Youth Sports",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Gold Beach Youth Sports</h2>
        <p>Click the button below to sign in to your account:</p>
        <p style="margin: 24px 0;">
          <a href="${url}" style="background: #0f172a; color: #ffffff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">
            Sign In to GBYS
          </a>
        </p>
        <p style="color: #64748b; font-size: 13px;">This link expires in 10 minutes. If you didn't request this email, you can safely ignore it.</p>
      </div>
    `,
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
  return nuntly.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `Action Needed: Your ${credentialName} expires on ${expiresAtDate}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Volunteer Clearance Reminder</h2>
        <p>Hi ${volunteerName},</p>
        <p>Your <strong>${credentialName}</strong> on file with Gold Beach Youth Sports is scheduled to expire on <strong>${expiresAtDate}</strong>.</p>
        <p>Please renew your clearance through your league partner portal and upload your updated confirmation receipt in the GBYS Volunteer Portal so there is no interruption to your coaching or volunteer eligibility.</p>
      </div>
    `,
  });
}
