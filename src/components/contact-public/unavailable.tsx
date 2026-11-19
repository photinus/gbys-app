export function FormUnavailable({ title = "This form is temporarily unavailable", compact = false }: { title?: string; compact?: boolean }) {
  return (
    <div role="status" className={`rounded-2xl border border-line bg-white text-center ${compact ? "p-5" : "p-8"}`}>
      <h1 className="text-lg font-bold tracking-tight text-charcoal">{title}</h1>
      <p className="mt-1 text-sm text-stone-500">Please try again later.</p>
    </div>
  );
}
