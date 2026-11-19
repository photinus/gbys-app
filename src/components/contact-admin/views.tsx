import Link from "next/link";
import { Card, CardHeader, buttonStyles } from "@/components/ui";
import {
  countNewSubmissions,
  listContactForms,
  listSubmissions,
  type ContactScope,
} from "@/lib/dal/contact-forms";
import { isBoard, type SessionContext } from "@/lib/dal/context";
import { inboxFiltersToQuery, parseInboxFilters } from "@/lib/validation/contact-forms";
import { FormsList } from "./forms-list";
import { Inbox } from "./inbox";
import { InboxFilterForm } from "./inbox-filters";
import { ContactTabs } from "./section-tabs";

type SearchParams = Record<string, string | string[] | undefined>;

/** Inbox tab: used by /admin/contact (scope all) and /programs/[slug]/contact (scope programId). */
export async function InboxView({
  ctx,
  scope,
  basePath,
  searchParams,
}: {
  ctx: SessionContext;
  scope: ContactScope;
  basePath: string;
  searchParams: SearchParams;
}) {
  const filters = parseInboxFilters(searchParams);
  const [forms, page, newCount] = await Promise.all([
    listContactForms(ctx, scope),
    listSubmissions(ctx, { scope, formId: filters.formId, status: filters.status, q: filters.q }),
    countNewSubmissions(ctx, scope),
  ]);
  const query = inboxFiltersToQuery(filters).toString();
  return (
    <div className="space-y-6">
      <ContactTabs basePath={basePath} active="inbox" newCount={newCount} />
      <Card>
        <CardHeader title="Filters" />
        <InboxFilterForm basePath={basePath} forms={forms.map((f) => ({ id: f.id, title: f.title }))} filters={filters} />
      </Card>
      <Card data-testid="inbox-card">
        <CardHeader
          title="Messages"
          description="Newest first. Times are Pacific. Opening a message marks it read."
          action={
            forms.length === 0 ? (
              <Link href={`${basePath}/forms/new`} className={buttonStyles({ size: "sm" })}>
                Create a form
              </Link>
            ) : undefined
          }
        />
        {/* key: a new filter set remounts the list so "load more" state never leaks across filters */}
        <Inbox
          key={query}
          scope={scope}
          filters={filters}
          initialRows={page.rows}
          initialCursor={page.nextCursor}
          canDelete={isBoard(ctx)}
          showForm={forms.length > 1}
        />
      </Card>
    </div>
  );
}

export async function FormsView({
  ctx,
  scope,
  basePath,
}: {
  ctx: SessionContext;
  scope: ContactScope;
  basePath: string;
}) {
  const [forms, newCount] = await Promise.all([listContactForms(ctx, scope), countNewSubmissions(ctx, scope)]);
  return (
    <div className="space-y-6">
      <ContactTabs basePath={basePath} active="forms" newCount={newCount} />
      <Card>
        <CardHeader
          title="Contact forms"
          description="Each form has a hosted page and an embeddable version."
          action={
            forms.length > 0 ? (
              <Link href={`${basePath}/forms/new`} className={buttonStyles({ size: "sm" })} data-testid="new-form">
                New form
              </Link>
            ) : undefined
          }
        />
        <FormsList forms={forms} basePath={basePath} showProgram={"all" in scope} />
      </Card>
    </div>
  );
}
