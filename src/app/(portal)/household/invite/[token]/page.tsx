import Link from "next/link";
import { Badge, buttonStyles, Card } from "@/components/ui";
import { AcceptInviteButton } from "@/components/household/accept-invite-button";
import { requireSession } from "@/lib/dal/context";
import { getInviteForAccept } from "@/lib/dal/households";

export const metadata = { title: "Guardian invitation | GBYS" };

const MESSAGES = {
  not_found: ["Invitation not found", "This link is not valid. Ask the sender for a new invitation."],
  expired: ["Invitation expired", "Invitations are valid for 7 days. Ask the sender for a new one."],
  revoked: ["Invitation revoked", "The sender cancelled this invitation."],
  accepted: ["Already accepted", "This invitation has already been used."],
} as const;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await requireSession(`/household/invite/${token}`);
  const invite = await getInviteForAccept(ctx, token);

  return (
    <div className="mx-auto w-full max-w-lg py-6">
      <Card>
        {invite.status === "valid" ? (
          <div className="space-y-5">
            <div>
              <Badge tone="info">Guardian invitation</Badge>
              <h1 className="mt-3 text-xl font-bold text-charcoal">Join {invite.inviterName}&apos;s household</h1>
              <p className="mt-2 text-sm text-stone-600">
                {invite.inviterName} invited you as <strong>{invite.relationship}</strong> of:
              </p>
            </div>
            <ul className="space-y-1.5">
              {invite.athleteNames.map((n) => (
                <li key={n} className="rounded-xl bg-alabaster px-3.5 py-2.5 text-sm font-semibold text-charcoal">
                  {n}
                </li>
              ))}
            </ul>
            <p className="text-xs text-stone-500">
              Signed in as {ctx.email}. Accepting gives you access to these athletes&apos; details, including emergency
              contacts and medical notes.
            </p>
            <AcceptInviteButton token={token} />
          </div>
        ) : invite.status === "email_mismatch" ? (
          <div className="space-y-4">
            <h1 className="text-xl font-bold text-charcoal">Wrong account</h1>
            <p className="text-sm text-stone-600">
              This invitation was sent to <strong>{invite.invitedEmail}</strong>, but you are signed in as{" "}
              <strong>{ctx.email}</strong>. Sign out and sign in with the invited address to accept it.
            </p>
            <Link href="/household" className={buttonStyles({ variant: "secondary" })}>
              Back to household
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <h1 className="text-xl font-bold text-charcoal">{MESSAGES[invite.status][0]}</h1>
            <p className="text-sm text-stone-600">{MESSAGES[invite.status][1]}</p>
            <Link href="/household" className={buttonStyles({ variant: "secondary" })}>
              Go to household
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
