import { EmptyState } from "@/components/ui";
import type { OpenSeason } from "@/lib/dal/registrations";
import { OpenSeasonCard } from "./open-season-card";

export function OpenRegistrationsSection({ seasons }: { seasons: OpenSeason[] }) {
  return (
    <section id="open-registrations" aria-labelledby="open-registrations-title" className="mt-14">
      <h2 id="open-registrations-title" className="text-2xl font-bold tracking-tight text-charcoal">
        Open registrations
      </h2>
      <p className="mt-1 text-sm text-stone-500">Sign your athlete up. You will be asked to sign in first.</p>
      <div className="mt-5">
        {seasons.length === 0 ? (
          <EmptyState
            title="No registrations are open right now"
            description="New seasons are posted here as soon as they open."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {seasons.map((s) => (
              <OpenSeasonCard key={s.seasonId} season={s} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
