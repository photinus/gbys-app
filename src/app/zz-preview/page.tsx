import { Users } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { Card, CardHeader, Badge, Button, KpiCard, PastelCard, Table, THead, TH, TBody, TR, TD, Field, Input, Select, Switch, EmptyState } from "@/components/ui";
import Demo from "./demo";
export default function P() {
  return (
    <AppShell user={{ name: "Will McCloskey", email: "w@x.org", image: null, orgRole: "board_member" }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 pb-6">
        <KpiCard icon={<Users className="w-5 h-5" />} label="Pending" value="12" delta="+4" hint="hint" tone="periwinkle" />
        <KpiCard icon={Users} label="Verified" value="30" tone="sage" />
        <KpiCard icon={Users} label="Expiring" value="3" tone="amber" />
        <KpiCard icon={Users} label="Expired" value="1" tone="coral" />
      </div>
      <Card>
        <CardHeader title="Queue" description="desc" action={<Button size="sm">Act</Button>} />
        <Table><THead><tr><TH>A</TH><TH>B</TH></tr></THead><TBody><TR onClick={undefined}><TD>x</TD><TD><Badge tone="success">Cleared</Badge> <Badge tone="warning">Exp</Badge> <Badge tone="danger">Req</Badge> <Badge tone="info">Pend</Badge></TD></TR></TBody></Table>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <Field label="Name" hint="hint"><Input placeholder="x" /></Field>
          <Field label="Sel" error="bad"><Select><option>a</option></Select></Field>
          <Switch defaultChecked />
        </div>
        <div className="flex gap-2 mt-4"><Button variant="secondary">Sec</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Del</Button></div>
        <div className="mt-4"><EmptyState title="Nothing" description="d" /></div>
        <div className="mt-4 grid grid-cols-3 gap-3"><PastelCard tone="lavender" title="L">x</PastelCard><PastelCard tone="peach" title="P">x</PastelCard><PastelCard tone="mint" title="M">x</PastelCard></div>
      </Card>
      <Demo />
    </AppShell>
  );
}
