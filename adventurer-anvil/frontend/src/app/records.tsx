// Two editors for things a character keeps changing: a list of rows (records: your own items, money changes, a
// journal), and steppers that start from a count and store only the change (what's carried after a package).
import { useEffect, useId, useRef } from "react";
import type { ChoiceValue, RecordField, RecordRow } from "../core";
import { choiceDomId, Issues, type ChoiceProps } from "./choices";

/** The stored rows: objects with a string id. Anything else is dropped. */
export function asRecords(value: ChoiceValue | undefined): RecordRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter((r): r is RecordRow => Boolean(r) && typeof r === "object" && !Array.isArray(r) && typeof (r as { id?: unknown }).id === "string");
}

/** Stored changes: option value → a whole number other than 0 (negative takes away). */
export function asChanges(value: ChoiceValue | undefined): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((e): e is [string, number] => Number.isInteger(e[1]) && e[1] !== 0));
}

const today = () => new Date().toISOString().slice(0, 10);

function blankRow(fields: RecordField[]): RecordRow {
  const row: RecordRow = { id: crypto.randomUUID() };
  for (const f of fields) row[f.id] = f.today ? today() : f.type === "check" ? false : f.type === "select" ? (f.options?.[0]?.value ?? "") : f.type === "number" ? null : "";
  return row;
}

/** A list of rows, each with the system's fields, to add, edit and remove. */
export function Records({ spec, value, issues, onChange }: ChoiceProps) {
  const id = choiceDomId(spec.key);
  const fields = spec.fields ?? [];
  const rows = asRecords(value);
  const name = spec.recordName ?? { one: "row", many: "rows" };
  const shown = spec.newestFirst ? [...rows].reverse() : rows;
  const focusRow = useRef<string | null>(null);
  const local = useId();

  useEffect(() => {
    if (!focusRow.current) return;
    document.getElementById(`${local}-${focusRow.current}-${fields[0]?.id}`)?.focus();
    focusRow.current = null;
  });

  const set = (rowId: string, field: string, v: string | number | boolean | null) => onChange(rows.map((r) => (r.id === rowId ? { ...r, [field]: v } : r)));
  const add = () => {
    const row = blankRow(fields);
    focusRow.current = row.id;
    onChange([...rows, row]);
  };
  const remove = (rowId: string) => onChange(rows.filter((r) => r.id !== rowId));

  return (
    <section className="choice" id={id} tabIndex={-1} aria-labelledby={`${id}-label`}>
      <h2 id={`${id}-label`} className="choice-title">{spec.label}</h2>
      {spec.hint && <p className="meta">{spec.hint}</p>}
      {rows.length === 0 && <p className="dim" style={{ fontSize: 14 }}>No {name.many} yet.</p>}
      <ol className="records">
        {shown.map((row) => {
          const n = rows.indexOf(row) + 1;
          return (
            <li key={row.id}>
              <fieldset>
                <legend className="sr-only">{capital(name.one)} {n}</legend>
                <div className="record-fields">
                  {fields.map((f) => {
                    const fid = `${local}-${row.id}-${f.id}`;
                    const v = row[f.id];
                    const wide = f.type === "long-text" ? " wide" : "";
                    if (f.type === "check") {
                      return (
                        <label key={f.id} className="check record-check" htmlFor={fid}>
                          <input id={fid} type="checkbox" checked={v === true} onChange={(e) => set(row.id, f.id, e.target.checked)} /> {f.label}
                        </label>
                      );
                    }
                    return (
                      <div key={f.id} className={`record-field${wide}`}>
                        <label htmlFor={fid} className="label">{f.label}</label>
                        {f.type === "long-text" ? (
                          <textarea id={fid} className="text-input" rows={3} value={typeof v === "string" ? v : ""} onChange={(e) => set(row.id, f.id, e.target.value)} />
                        ) : f.type === "select" ? (
                          <select id={fid} className="text-input" value={typeof v === "string" ? v : ""} onChange={(e) => set(row.id, f.id, e.target.value)}>
                            {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.name}</option>)}
                          </select>
                        ) : f.type === "number" ? (
                          <input id={fid} className="text-input number-input" type="number" inputMode="decimal" step="any" value={typeof v === "number" ? v : ""} onChange={(e) => set(row.id, f.id, e.target.value === "" ? null : Number(e.target.value))} />
                        ) : (
                          <input id={fid} className="text-input" type="text" value={typeof v === "string" ? v : ""} onChange={(e) => set(row.id, f.id, e.target.value)} />
                        )}
                      </div>
                    );
                  })}
                </div>
                <button type="button" className="button small" onClick={() => remove(row.id)}>Remove<span className="sr-only"> {name.one} {n}</span></button>
              </fieldset>
            </li>
          );
        })}
      </ol>
      <button type="button" className="button" onClick={add}>Add {name.one}</button>
      <Issues issues={issues} />
    </section>
  );
}

/** Each option with its starting count and − and +; the stored value is the change. A count can't go below 0. */
export function Adjust({ spec, value, issues, onChange }: ChoiceProps) {
  const id = choiceDomId(spec.key);
  const changes = asChanges(value);
  const set = (v: string, change: number) => {
    const next = { ...changes };
    if (change !== 0) next[v] = change;
    else delete next[v];
    onChange(next);
  };
  const options = spec.options ?? [];
  return (
    <section className="choice" id={id} tabIndex={-1} aria-labelledby={`${id}-label`}>
      <h2 id={`${id}-label`} className="choice-title">{spec.label}</h2>
      {spec.hint && <p className="meta">{spec.hint}</p>}
      {options.length === 0 ? (
        <p className="dim" style={{ fontSize: 14 }}>Nothing carried yet.</p>
      ) : (
        <ul className="shop">
          {options.map((o) => {
            const v = String(o.value);
            const start = spec.base?.[v] ?? 0;
            const change = changes[v] ?? 0;
            const n = start + change;
            return (
              <li key={v}>
                <span className="shop-name">{o.name}</span>
                <span className="dim shop-tags">{change ? `was ${start}` : o.summary ?? ""}</span>
                <span className="stepper">
                  <button type="button" className="button small" disabled={n <= 0} onClick={() => set(v, change - 1)}>
                    −<span className="sr-only"> one fewer {o.name}</span>
                  </button>
                  <span className="final">{n}<span className="sr-only"> {o.name}</span></span>
                  <button type="button" className="button small" onClick={() => set(v, change + 1)}>
                    +<span className="sr-only"> one more {o.name}</span>
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Issues issues={issues} />
    </section>
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
