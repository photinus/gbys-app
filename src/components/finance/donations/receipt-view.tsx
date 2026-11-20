import { fmtLongDate, fmtMoney, type ReceiptDoc } from "@/lib/finance/receipt-content";

/** A receipt / yearly statement as a printable letter. Renders the same ReceiptDoc the email uses. */
export function ReceiptView({ doc }: { doc: ReceiptDoc }) {
  const t = doc.totals;
  return (
    <article className="receipt-sheet mx-auto w-full max-w-[720px] rounded-[26px] border border-line/80 bg-white p-6 text-[14px] leading-relaxed text-charcoal shadow-card sm:p-10 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-lg font-bold">{doc.org.name}</p>
          <p className="text-xs text-stone-500">{fmtLongDate(doc.issuedOn)}</p>
        </div>
        {doc.org.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={doc.org.logoUrl} alt="" className="h-14 w-auto max-w-[180px] object-contain" />
        ) : null}
      </header>

      <section className="mt-6">
        <p className="font-semibold">{doc.donor.name}</p>
        {doc.addressLines.map((l, i) => (
          <p key={i} className="text-stone-600">
            {l}
          </p>
        ))}
      </section>

      <h2 className="mt-6 text-xl font-bold">{doc.title}</h2>
      {doc.kind === "annual" ? <p className="text-xs text-stone-500">Gifts received January 1 to December 31, {doc.taxYear}</p> : null}
      <p className="mt-4">Dear {doc.donor.name},</p>
      <p className="mt-2 whitespace-pre-line">{doc.message}</p>

      {doc.kind === "gift" ? (
        <dl className="mt-5 divide-y divide-line-soft border-y border-line-soft">
          {doc.gifts.map((g) => (
            <div key={g.giftId} className="divide-y divide-line-soft">
              <Row label="Date of gift" value={fmtLongDate(g.date)} />
              {g.isInKind ? (
                <Row label="Donated goods or services" value={g.description} />
              ) : (
                <>
                  <Row label="Amount of contribution" value={fmtMoney(g.amountCents ?? 0)} />
                  <Row label="Type of gift" value={g.description} />
                  {g.goodsServicesCents > 0 ? (
                    <>
                      <Row label="Value of goods or services provided" value={fmtMoney(g.goodsServicesCents)} />
                      <Row label="Tax-deductible amount" value={fmtMoney(g.deductibleCents ?? 0)} />
                    </>
                  ) : null}
                </>
              )}
            </div>
          ))}
        </dl>
      ) : (
        <div className="mt-5 overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-[520px] border-collapse text-sm print:min-w-0">
            <thead>
              <tr className="border-b-2 border-stone-300 text-left text-xs text-stone-500">
                <th className="py-2 pr-2">Date</th>
                <th className="py-2 pr-2">Gift</th>
                <th className="py-2 pr-2 text-right">Amount</th>
                <th className="py-2 pr-2 text-right">Goods or services provided</th>
                <th className="py-2 text-right">Deductible</th>
              </tr>
            </thead>
            <tbody>
              {doc.gifts.map((g) => (
                <tr key={g.giftId} className="border-b border-line-soft align-top">
                  <td className="py-2 pr-2 whitespace-nowrap">{fmtLongDate(g.date)}</td>
                  <td className="py-2 pr-2">{g.description}</td>
                  <td className="py-2 pr-2 text-right whitespace-nowrap tabular-nums">{g.isInKind ? "Non-cash gift" : fmtMoney(g.amountCents ?? 0)}</td>
                  <td className="py-2 pr-2 text-right whitespace-nowrap tabular-nums">{g.goodsServicesCents > 0 ? fmtMoney(g.goodsServicesCents) : "None"}</td>
                  <td className="py-2 text-right whitespace-nowrap tabular-nums">{g.isInKind ? "See below" : fmtMoney(g.deductibleCents ?? 0)}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td colSpan={2} className="py-2.5">
                  Total (cash gifts)
                </td>
                <td className="py-2.5 pr-2 text-right tabular-nums">{fmtMoney(t.amountCents)}</td>
                <td className="py-2.5 pr-2 text-right font-normal tabular-nums">{fmtMoney(t.goodsServicesCents)}</td>
                <td className="py-2.5 text-right tabular-nums">{fmtMoney(t.deductibleCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5 space-y-2.5">
        {doc.statements.map((s, i) => (
          <p key={i}>{s}</p>
        ))}
      </div>

      <footer className="mt-8">
        {doc.signerName ? (
          <p>
            <strong>{doc.signerName}</strong>
            {doc.signerTitle ? <span className="block">{doc.signerTitle}</span> : null}
            <span className="block">{doc.org.name}</span>
          </p>
        ) : (
          <p>
            <strong>{doc.org.name}</strong>
          </p>
        )}
      </footer>
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
      <dt className="text-stone-600 sm:w-1/2">{label}</dt>
      <dd className="font-semibold sm:w-1/2">{value}</dd>
    </div>
  );
}
