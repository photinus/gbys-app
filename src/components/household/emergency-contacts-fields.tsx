"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Input, Label, Select } from "@/components/ui";
import type { EmergencyContact } from "@/db/schema/household";
import { formatPhone } from "@/lib/validation/household";
import { listSavedContactsAction } from "./saved-contacts-action";

const MAX_CONTACTS = 5;

/**
 * Repeatable emergency-contact rows (1-5). Inputs are named
 * ec_name / ec_phone / ec_relationship, read by the server action via FormData.
 * Each row can be filled from a contact already saved on another of my athletes
 * ("Use a saved contact"); typing a contact manually always works too.
 */
export function EmergencyContactsFields({ initial }: { initial?: EmergencyContact[] }) {
  const nextKey = useRef(0);
  const [rows, setRows] = useState(() =>
    (initial && initial.length > 0 ? initial : [{ name: "", phone: "", relationship: "" }]).map((c) => ({
      key: nextKey.current++,
      name: c.name,
      phone: formatPhone(c.phone),
      relationship: c.relationship,
    }))
  );
  const [saved, setSaved] = useState<EmergencyContact[]>([]);

  useEffect(() => {
    let cancelled = false;
    listSavedContactsAction()
      .then((res) => {
        if (!cancelled && res.ok) setSaved(res.data);
      })
      .catch(() => {
        /* the picker is a convenience; manual entry still works */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = (key: number, p: Partial<{ name: string; phone: string; relationship: string }>) =>
    setRows((r) => r.map((x) => (x.key === key ? { ...x, ...p } : x)));

  return (
    <fieldset className="space-y-3">
      <div className="flex items-center justify-between">
        <legend className="text-xs font-semibold text-stone-600">
          Emergency contacts <span className="font-normal text-stone-400">(1-{MAX_CONTACTS})</span>
        </legend>
        <Button
          size="sm"
          variant="secondary"
          disabled={rows.length >= MAX_CONTACTS}
          onClick={() =>
            setRows((r) => [...r, { key: nextKey.current++, name: "", phone: "", relationship: "" }])
          }
        >
          <Plus className="h-3.5 w-3.5" /> Add contact
        </Button>
      </div>
      {rows.map((row, i) => (
        <div key={row.key} className="space-y-2 rounded-2xl border border-line bg-alabaster/50 p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-500">Contact {i + 1}</span>
            {rows.length > 1 ? (
              <button
                type="button"
                onClick={() => setRows((r) => r.filter((x) => x.key !== row.key))}
                className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 hover:underline"
                aria-label={`Remove contact ${i + 1}`}
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            ) : null}
          </div>
          {saved.length > 0 ? (
            <div>
              <Label htmlFor={`ec-saved-${row.key}`}>Use a saved contact</Label>
              <Select
                id={`ec-saved-${row.key}`}
                value=""
                onChange={(e) => {
                  const c = saved[Number(e.target.value)];
                  if (c) patch(row.key, { name: c.name, phone: formatPhone(c.phone), relationship: c.relationship });
                }}
                className="bg-white"
              >
                <option value="">Choose a saved contact...</option>
                {saved.map((c, idx) => (
                  <option key={`${c.name}|${c.phone}`} value={idx}>
                    {c.name}
                    {c.relationship ? ` (${c.relationship})` : ""} · {formatPhone(c.phone)}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`ec-name-${row.key}`}>Name</Label>
              <Input
                id={`ec-name-${row.key}`}
                name="ec_name"
                value={row.name}
                onChange={(e) => patch(row.key, { name: e.target.value })}
                required
                maxLength={100}
                className="bg-white"
              />
            </div>
            <div>
              <Label htmlFor={`ec-rel-${row.key}`}>Relationship</Label>
              <Input
                id={`ec-rel-${row.key}`}
                name="ec_relationship"
                value={row.relationship}
                onChange={(e) => patch(row.key, { relationship: e.target.value })}
                required
                maxLength={50}
                placeholder="e.g. Aunt"
                className="bg-white"
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor={`ec-phone-${row.key}`}>Phone</Label>
              <Input
                id={`ec-phone-${row.key}`}
                name="ec_phone"
                type="tel"
                value={row.phone}
                onChange={(e) => patch(row.key, { phone: e.target.value })}
                required
                placeholder="(541) 555-0123"
                className="bg-white"
              />
            </div>
          </div>
        </div>
      ))}
    </fieldset>
  );
}
