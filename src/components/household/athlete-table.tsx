"use client";

import { HeartPulse, Plus } from "lucide-react";
import { useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import { fetchAthleteDetailAction } from "@/app/(portal)/household/actions";
import type { AthleteDetail, AthleteListItem } from "@/lib/dal/households";
import { formatDob } from "@/lib/format";
import { ageFromDob } from "./age";
import { AthleteDetailSheet, detailStateFromResult, type DetailState } from "./athlete-detail-sheet";
import { AthleteFormModal } from "./athlete-form-modal";

export function AthleteTable({ athletes }: { athletes: AthleteListItem[] }) {
  const [selected, setSelected] = useState<AthleteListItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [detail, setDetail] = useState<DetailState>({ status: "loading" });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AthleteDetail | null>(null);
  const currentId = useRef<string | null>(null);

  // Opening the sheet performs the audited read; triggered by a click, not an effect.
  async function openDetail(a: AthleteListItem) {
    currentId.current = a.id;
    setSelected(a);
    setDetail({ status: "loading" });
    setSheetOpen(true);
    const res = await fetchAthleteDetailAction(a.id);
    if (currentId.current === a.id) setDetail(detailStateFromResult(res));
  }

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
  }

  return (
    <>
      <Card id="athletes">
        <CardHeader
          title="Athletes"
          description="Click an athlete to view medical notes and emergency contacts."
          action={
            <>
              <Badge tone="neutral" className="border border-line">
                <HeartPulse className="mr-1.5 h-3.5 w-3.5 text-rose-500" /> Medical access audited
              </Badge>
              <Button size="sm" onClick={openAdd}>
                <Plus className="h-4 w-4" /> Add athlete
              </Button>
            </>
          }
        />
        {athletes.length === 0 ? (
          <EmptyState
            title="No athletes yet"
            description="Add your first athlete to register for programs and invite co-guardians."
            action={
              <Button size="sm" onClick={openAdd}>
                <Plus className="h-4 w-4" /> Add athlete
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH className="pl-2">Athlete</TH>
                <TH>Date of birth</TH>
                <TH>Your role</TH>
                <TH className="pr-2 text-right">Medical</TH>
              </tr>
            </THead>
            <TBody>
              {athletes.map((a) => {
                const age = ageFromDob(a.dateOfBirth);
                return (
                  <TR key={a.id}>
                    <TD className="pl-2">
                      <button
                        type="button"
                        onClick={() => openDetail(a)}
                        className="text-left font-semibold text-charcoal hover:underline"
                      >
                        {a.firstName} {a.lastName}
                      </button>
                      <p className="text-xs text-stone-400">
                        {[age !== null ? `Age ${age}` : null, a.gradeLevel ? `Grade ${a.gradeLevel}` : null]
                          .filter(Boolean)
                          .join(" - ")}
                      </p>
                    </TD>
                    <TD className="text-xs font-medium text-charcoal sm:text-sm">{formatDob(a.dateOfBirth)}</TD>
                    <TD className="text-xs text-stone-600">
                      {a.relationship}
                      {!a.canRegister ? <span className="text-stone-400"> (view only)</span> : null}
                    </TD>
                    <TD className="pr-2 text-right">
                      <button
                        type="button"
                        onClick={() => openDetail(a)}
                        className={
                          a.hasMedicalNotes
                            ? "rounded-full bg-coral/35 px-2.5 py-1 text-[11px] font-semibold text-rose-950"
                            : "rounded-full bg-alabaster px-2.5 py-1 text-[11px] font-semibold text-stone-500"
                        }
                      >
                        {a.hasMedicalNotes ? "Medical alert" : "No alerts"}
                      </button>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>

      <AthleteDetailSheet
        open={sheetOpen}
        onClose={() => {
          currentId.current = null;
          setSheetOpen(false);
        }}
        athlete={selected}
        state={detail}
        onEdit={(d) => {
          setSheetOpen(false);
          setEditing(d);
          setFormOpen(true);
        }}
      />
      <AthleteFormModal open={formOpen} onClose={() => setFormOpen(false)} athlete={editing} />
    </>
  );
}
