/** Round avatar: the athlete's photo when there is one, otherwise initials. Decorative (the name sits beside it). */
export function MemberAvatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photoUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
  ) : (
    <span
      aria-hidden
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-periwinkle/30 text-sm font-bold text-indigo-700"
    >
      {initials || "?"}
    </span>
  );
}
