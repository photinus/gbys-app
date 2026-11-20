"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { saveSectionsAction } from "@/app/(portal)/programs/[slug]/home-page/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Badge, Button, Field, Input, Textarea, useToast } from "@/components/ui";
import type { SiteSection } from "@/db/schema";
import { SECTION_KIND_LABELS, SITE_LIMITS, type SectionKind } from "@/lib/validation/program-sites";

type FaqItem = { key: string; q: string; a: string };
type LinkItem = { key: string; label: string; url: string };
type Draft =
  | { key: string; id: string; kind: "text"; title: string; body: string }
  | { key: string; id: string; kind: "faq"; title: string; items: FaqItem[] }
  | { key: string; id: string; kind: "links"; title: string; items: LinkItem[] };

let counter = 0;
const k = () => `k${++counter}`;

function toDrafts(sections: SiteSection[]): Draft[] {
  return sections.map((s): Draft => {
    if (s.kind === "text") return { key: k(), id: s.id, kind: "text", title: s.title, body: s.body };
    if (s.kind === "faq") return { key: k(), id: s.id, kind: "faq", title: s.title, items: s.items.map((i) => ({ key: k(), ...i })) };
    return { key: k(), id: s.id, kind: "links", title: s.title, items: s.items.map((i) => ({ key: k(), ...i })) };
  });
}

function toPayload(drafts: Draft[]) {
  return drafts.map((d) => {
    if (d.kind === "text") return { id: d.id, kind: d.kind, title: d.title, body: d.body };
    if (d.kind === "faq") return { id: d.id, kind: d.kind, title: d.title, items: d.items.map((i) => ({ q: i.q, a: i.a })) };
    return { id: d.id, kind: d.kind, title: d.title, items: d.items.map((i) => ({ label: i.label, url: i.url })) };
  });
}

function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const next = arr.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

const iconBtn =
  "inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white text-stone-600 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-periwinkle/60 disabled:opacity-40 disabled:pointer-events-none";

export function SectionsEditor({ programId, sections }: { programId: string; sections: SiteSection[] }) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(saveSectionsAction);
  const [drafts, setDrafts] = useState<Draft[]>(() => toDrafts(sections));
  const [dirty, setDirty] = useState(false);
  const lastAdded = useRef<string | null>(null);

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.data.changed.length ? "Page blocks saved" : "No changes to save");
      setDrafts(toDrafts(state.data.sections));
      setDirty(false);
    }
  }, [state, toast]);

  const edit = (fn: (d: Draft[]) => Draft[]) => {
    setDrafts(fn);
    setDirty(true);
  };
  const patch = (key: string, p: Partial<Draft>) => edit((ds) => ds.map((d) => (d.key === key ? ({ ...d, ...p } as Draft) : d)));

  function add(kind: SectionKind) {
    const key = k();
    lastAdded.current = key;
    const base = { key, id: "", title: "" };
    const d: Draft =
      kind === "text"
        ? { ...base, kind, body: "" }
        : kind === "faq"
          ? { ...base, kind, items: [{ key: k(), q: "", a: "" }] }
          : { ...base, kind, items: [{ key: k(), label: "", url: "" }] };
    edit((ds) => [...ds, d]);
  }

  const atCap = drafts.length >= SITE_LIMITS.sections;

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm" data-testid="sections-form">
      <input type="hidden" name="programId" value={programId} />
      <input type="hidden" name="sections" value={JSON.stringify(toPayload(drafts))} />

      {drafts.length === 0 ? (
        <p className="rounded-2xl bg-alabaster px-4 py-6 text-center text-xs text-stone-500" data-testid="no-sections">
          No extra blocks yet. Add a text block for things like “What to bring”, questions &amp; answers for common
          questions, or a list of useful links.
        </p>
      ) : null}

      <ol className="space-y-4">
        {drafts.map((d, i) => (
          <li key={d.key} className="rounded-2xl border border-line p-4" data-testid="section-block">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
              <Badge tone="info">{SECTION_KIND_LABELS[d.kind]}</Badge>
              <div className="flex gap-1.5">
                <button type="button" className={iconBtn} aria-label={`Move block ${i + 1} up`} disabled={i === 0} onClick={() => edit((ds) => move(ds, i, -1))}>
                  <ArrowUp className="h-4 w-4" aria-hidden />
                </button>
                <button type="button" className={iconBtn} aria-label={`Move block ${i + 1} down`} disabled={i === drafts.length - 1} onClick={() => edit((ds) => move(ds, i, 1))}>
                  <ArrowDown className="h-4 w-4" aria-hidden />
                </button>
                <button type="button" className={iconBtn} aria-label={`Remove block ${i + 1}`} data-testid="remove-section" onClick={() => edit((ds) => ds.filter((x) => x.key !== d.key))}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
            <div className="space-y-3">
              <Field label="Block title">
                <Input
                  value={d.title}
                  maxLength={SITE_LIMITS.sectionTitle}
                  data-testid="section-title"
                  autoFocus={lastAdded.current === d.key}
                  onChange={(e) => patch(d.key, { title: e.target.value })}
                />
              </Field>

              {d.kind === "text" ? (
                <Field label="Text" hint="Plain text. Blank line between paragraphs.">
                  <Textarea
                    rows={5}
                    value={d.body}
                    maxLength={SITE_LIMITS.textBody}
                    data-testid="section-body"
                    onChange={(e) => patch(d.key, { body: e.target.value })}
                  />
                </Field>
              ) : null}

              {d.kind === "faq" ? (
                <ItemList
                  count={d.items.length}
                  addLabel="Add a question"
                  onAdd={() => patch(d.key, { items: [...d.items, { key: k(), q: "", a: "" }] })}
                >
                  {d.items.map((it, j) => (
                    <ItemRow
                      key={it.key}
                      label={`Question ${j + 1}`}
                      first={j === 0}
                      last={j === d.items.length - 1}
                      onUp={() => patch(d.key, { items: move(d.items, j, -1) })}
                      onDown={() => patch(d.key, { items: move(d.items, j, 1) })}
                      onRemove={() => patch(d.key, { items: d.items.filter((x) => x.key !== it.key) })}
                    >
                      <Input
                        aria-label={`Question ${j + 1}`}
                        placeholder="Question"
                        value={it.q}
                        maxLength={SITE_LIMITS.faqQuestion}
                        data-testid="faq-q"
                        onChange={(e) => patch(d.key, { items: d.items.map((x) => (x.key === it.key ? { ...x, q: e.target.value } : x)) })}
                      />
                      <Textarea
                        aria-label={`Answer ${j + 1}`}
                        placeholder="Answer"
                        rows={3}
                        value={it.a}
                        maxLength={SITE_LIMITS.faqAnswer}
                        data-testid="faq-a"
                        onChange={(e) => patch(d.key, { items: d.items.map((x) => (x.key === it.key ? { ...x, a: e.target.value } : x)) })}
                      />
                    </ItemRow>
                  ))}
                </ItemList>
              ) : null}

              {d.kind === "links" ? (
                <ItemList
                  count={d.items.length}
                  addLabel="Add a link"
                  onAdd={() => patch(d.key, { items: [...d.items, { key: k(), label: "", url: "" }] })}
                >
                  {d.items.map((it, j) => (
                    <ItemRow
                      key={it.key}
                      label={`Link ${j + 1}`}
                      first={j === 0}
                      last={j === d.items.length - 1}
                      onUp={() => patch(d.key, { items: move(d.items, j, -1) })}
                      onDown={() => patch(d.key, { items: move(d.items, j, 1) })}
                      onRemove={() => patch(d.key, { items: d.items.filter((x) => x.key !== it.key) })}
                    >
                      <Input
                        aria-label={`Link ${j + 1} label`}
                        placeholder="Label, like “Season schedule”"
                        value={it.label}
                        maxLength={SITE_LIMITS.linkLabel}
                        data-testid="link-label"
                        onChange={(e) => patch(d.key, { items: d.items.map((x) => (x.key === it.key ? { ...x, label: e.target.value } : x)) })}
                      />
                      <Input
                        aria-label={`Link ${j + 1} address`}
                        placeholder="https://example.org or mailto:name@example.org"
                        value={it.url}
                        maxLength={SITE_LIMITS.linkUrl}
                        inputMode="url"
                        autoCapitalize="none"
                        spellCheck={false}
                        data-testid="link-url"
                        onChange={(e) => patch(d.key, { items: d.items.map((x) => (x.key === it.key ? { ...x, url: e.target.value } : x)) })}
                      />
                    </ItemRow>
                  ))}
                </ItemList>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-stone-600">
          Add a block ({drafts.length} of {SITE_LIMITS.sections})
        </p>
        <div className="flex flex-wrap gap-2">
          {(["text", "faq", "links"] as const).map((kind) => (
            <Button key={kind} variant="secondary" size="sm" disabled={atCap} onClick={() => add(kind)} data-testid={`add-${kind}`}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> {SECTION_KIND_LABELS[kind]}
            </Button>
          ))}
        </div>
        {atCap ? <p className="text-xs text-stone-500">That&apos;s the maximum number of blocks.</p> : null}
      </div>

      <FormError state={state} />
      <div className="flex flex-wrap items-center justify-end gap-3">
        {dirty ? <span className="text-xs font-medium text-amber-800" data-testid="sections-dirty">Unsaved changes</span> : null}
        <Button type="submit" disabled={pending} data-testid="save-sections">
          {pending ? "Saving..." : "Save blocks"}
        </Button>
      </div>
    </form>
  );
}

function ItemList({ count, addLabel, onAdd, children }: { count: number; addLabel: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <ul className="space-y-3">{children}</ul>
      <Button variant="ghost" size="sm" disabled={count >= SITE_LIMITS.items} onClick={onAdd}>
        <Plus className="h-3.5 w-3.5" aria-hidden /> {addLabel}
      </Button>
      {count >= SITE_LIMITS.items ? <p className="text-xs text-stone-500">Up to {SITE_LIMITS.items} items per block.</p> : null}
    </div>
  );
}

function ItemRow({
  label,
  first,
  last,
  onUp,
  onDown,
  onRemove,
  children,
}: {
  label: string;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-2 rounded-xl bg-alabaster p-3" data-testid="section-item">
      <div className="min-w-0 flex-1 space-y-2">{children}</div>
      <div className="flex shrink-0 flex-col gap-1">
        <button type="button" className={iconBtn} aria-label={`Move ${label} up`} disabled={first} onClick={onUp}>
          <ArrowUp className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" className={iconBtn} aria-label={`Move ${label} down`} disabled={last} onClick={onDown}>
          <ArrowDown className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" className={iconBtn} aria-label={`Remove ${label}`} onClick={onRemove}>
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </li>
  );
}
