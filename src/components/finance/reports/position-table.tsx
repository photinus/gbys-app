import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { FinancialPosition, PositionGroup } from "@/lib/finance/report-math";
import { Amt, NUM, SectionRow } from "./report-ui";

function Groups({ groups }: { groups: PositionGroup[] }) {
  return (
    <>
      {groups.map((g) => (
        <GroupRows key={g.label} g={g} />
      ))}
    </>
  );
}

function GroupRows({ g }: { g: PositionGroup }) {
  return (
    <>
      <TR>
        <TD colSpan={2} className="pt-4 pb-1 text-sm font-semibold text-stone-700">
          {g.label}
        </TD>
      </TR>
      {g.rows.map((r) => (
        <TR key={r.accountId}>
          <TD className="py-2 pl-5">
            <span className="text-stone-400 tabular-nums mr-2">{r.code}</span>
            {r.name}
          </TD>
          <TD className={NUM}>
            <Amt cents={r.cents} dash={false} />
          </TD>
        </TR>
      ))}
      <TR className="border-t border-line">
        <TD className="py-2 pl-5 font-semibold">Total {g.label}</TD>
        <TD className={NUM}>
          <Amt cents={g.subtotal} bold dash={false} />
        </TD>
      </TR>
    </>
  );
}

function Total({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <TR className={strong ? "border-t-2 border-charcoal bg-alabaster/60" : "border-t border-line"}>
      <TD className="font-bold">{label}</TD>
      <TD className={NUM}>
        <Amt cents={cents} bold dash={false} />
      </TD>
    </TR>
  );
}

export function PositionTable({ p }: { p: FinancialPosition }) {
  const na = p.netAssets;
  return (
    <Table>
      <THead>
        <tr>
          <TH className="text-left">&nbsp;</TH>
          <TH className="text-right">Amount</TH>
        </tr>
      </THead>
      <TBody>
        <SectionRow label="Assets" cols={2} />
        {p.assetGroups.length === 0 ? (
          <TR>
            <TD colSpan={2} className="text-stone-500">
              No asset balances.
            </TD>
          </TR>
        ) : (
          <Groups groups={p.assetGroups} />
        )}
        <Total label="Total assets" cents={p.totalAssets} strong />

        <SectionRow label="Liabilities" cols={2} />
        {p.liabilityGroups.length === 0 ? (
          <TR>
            <TD colSpan={2} className="text-stone-500">
              No liabilities.
            </TD>
          </TR>
        ) : (
          <Groups groups={p.liabilityGroups} />
        )}
        <Total label="Total liabilities" cents={p.totalLiabilities} />

        <SectionRow label="Net assets" cols={2} />
        <TR>
          <TD className="pl-5">
            Without donor restrictions
            <span className="block text-xs text-stone-500">
              Opening balances {formatMini(na.openingWithout)} + earnings to date {formatMini(na.surplusWithout)}
            </span>
          </TD>
          <TD className={NUM}>
            <Amt cents={na.without} dash={false} />
          </TD>
        </TR>
        <TR>
          <TD className="pl-5">
            With donor restrictions
            <span className="block text-xs text-stone-500">
              Opening balances {formatMini(na.openingWith)} + restricted funds’ unspent balance {formatMini(na.surplusWith)}
            </span>
          </TD>
          <TD className={NUM}>
            <Amt cents={na.with} dash={false} />
          </TD>
        </TR>
        <Total label="Total net assets" cents={na.total} />
        <Total label="Total liabilities and net assets" cents={p.totalLiabilitiesAndNetAssets} strong />
      </TBody>
    </Table>
  );
}

function formatMini(cents: number): string {
  const abs = Math.abs(cents) / 100;
  const s = abs.toLocaleString("en-US", { style: "currency", currency: "USD" });
  return cents < 0 ? `(${s})` : s;
}
