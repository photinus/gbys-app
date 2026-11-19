import Link from "next/link";
import { buttonStyles, EmptyState } from "@/components/ui";
import { OpenSeasonCard } from "@/components/registration/open-season-card";
import type { OpenSeasonForFamily } from "@/lib/dal/registrations";

export function OpenForFamilySection({
  items,
  hasRegisterableAthletes,
}: {
  items: OpenSeasonForFamily[];
  hasRegisterableAthletes: boolean;
}) {
  return (
    <section aria-labelledby="open-for-family" data-testid="dash-open-for-family">
      <h2 id="open-for-family" className="mb-3 text-sm font-bold uppercase tracking-wider text-stone-400">
        Open for your family
      </h2>
      {items.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((i) => (
            <OpenSeasonCard
              key={i.season.seasonId}
              season={i.season}
              eligibleAthletes={i.athletes.map((a) => a.firstName)}
            />
          ))}
        </div>
      ) : hasRegisterableAthletes ? (
        <EmptyState
          className="py-6"
          title="No open registrations for your athletes right now"
          description="New seasons show up here as soon as they open."
          action={
            <Link href="/#open-registrations" className={buttonStyles({ variant: "secondary", size: "sm" })}>
              See all open registrations
            </Link>
          }
        />
      ) : (
        <EmptyState
          className="py-6"
          title="Add an athlete to see programs they can join"
          description="We will show the open registrations that fit your athlete's age."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link href="/household" className={buttonStyles({ size: "sm" })}>
                Add an athlete
              </Link>
              <Link href="/#open-registrations" className={buttonStyles({ variant: "secondary", size: "sm" })}>
                Browse open registrations
              </Link>
            </div>
          }
        />
      )}
    </section>
  );
}
