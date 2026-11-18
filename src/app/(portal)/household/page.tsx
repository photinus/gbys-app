import { requireSession } from "@/lib/dal/context";
import {
  getMyProfile,
  listGuardians,
  listMyAthletes,
  listMyPendingInvites,
} from "@/lib/dal/households";
import { AthleteTable } from "@/components/household/athlete-table";
import { GuardianList } from "@/components/household/guardian-list";
import { InviteGuardianButton } from "@/components/household/invite-guardian-modal";
import { PendingInvitesList } from "@/components/household/pending-invites-list";
import { ProfileCard } from "@/components/household/profile-card";

export const metadata = { title: "Household | GBYS" };

export default async function HouseholdPage() {
  const ctx = await requireSession("/household");
  const [profile, athletes, guardians, invites] = await Promise.all([
    getMyProfile(ctx),
    listMyAthletes(ctx),
    listGuardians(ctx),
    listMyPendingInvites(ctx),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-charcoal">Household</h1>
          <p className="mt-1 text-sm text-stone-500">
            Your profile, the athletes you manage, and the other adults who can act for them.
          </p>
        </div>
        <InviteGuardianButton athletes={athletes} />
      </div>
      <ProfileCard profile={profile} />
      <AthleteTable athletes={athletes} />
      <GuardianList guardians={guardians} />
      <PendingInvitesList invites={invites} />
    </div>
  );
}
