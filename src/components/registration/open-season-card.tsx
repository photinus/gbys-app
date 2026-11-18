import { ArrowRight, CalendarDays } from "lucide-react";
import Link from "next/link";
import { Badge, buttonStyles, Card } from "@/components/ui";
import type { OpenSeason } from "@/lib/dal/registrations";
import { closesLabel, eligibilityLabel, feeLabel, seasonDatesLabel } from "./format";

/** Public season card: only non-sensitive program / season facts. */
export function OpenSeasonCard({ season }: { season: OpenSeason }) {
  const elig = eligibilityLabel(season.eligibleBirthDateFrom, season.eligibleBirthDateTo);
  const dates = seasonDatesLabel(season.startsOn, season.endsOn);
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">
            {season.program.sport}
          </p>
          <h3 className="mt-0.5 break-words text-base font-bold text-charcoal">{season.program.name}</h3>
          <p className="break-words text-sm text-stone-600">{season.name}</p>
        </div>
        <Badge tone={season.feeCents === 0 ? "success" : "info"}>{feeLabel(season.feeCents)}</Badge>
      </div>
      {season.description ? (
        <p className="line-clamp-3 text-xs leading-relaxed text-stone-500">{season.description}</p>
      ) : null}
      <ul className="space-y-1 text-xs text-stone-500">
        {dates ? (
          <li className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden /> {dates}
          </li>
        ) : null}
        {elig ? <li>{elig}</li> : null}
        <li className="font-medium text-stone-600">{closesLabel(season.closesAt)}</li>
      </ul>
      <div className="mt-auto pt-1">
        <Link
          href={`/register/${season.program.slug}`}
          className={buttonStyles({ size: "sm" })}
          aria-label={`Register for ${season.program.name}, ${season.name}`}
        >
          Register <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </Card>
  );
}
