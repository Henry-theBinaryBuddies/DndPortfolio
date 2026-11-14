// The always-visible summary, drawn from the system's layout. Any number opens its breakdown.
import { useState } from "react";
import type { CharacterView, SummaryGroup, ValueFormat } from "../core";
import { breakdownText, formatValue } from "./format";

export interface TodoItem {
  label: string;
  step: string;
  stepLabel: string;
  key?: string;
}

interface Props {
  layout: SummaryGroup[];
  view: CharacterView;
  todo: TodoItem[];
  onGoTo: (item: TodoItem) => void;
}

export function Summary({ layout, view, todo, onGoTo }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (key: string) => setOpen(open === key ? null : key);

  const breakdownFor = (keys: string[], formats: Record<string, ValueFormat | undefined> = {}) => {
    if (!open || !keys.includes(open)) return null;
    const d = view.derived[open];
    if (!d) return null;
    const format = formats[open];
    return (
      <p className="breakdown" id={`breakdown-${open}`}>
        <span className="dim">{d.label} {formatValue(d.value, format === "signed" ? undefined : format)} = </span>
        {breakdownText(d.breakdown, format)}
      </p>
    );
  };

  return (
    <div className="side-body">
      <h2 className="label">Summary</h2>
      {layout.map((group) => {
        if (group.kind === "tiles") {
          const keys = group.items.map((i) => i.key);
          return (
            <section key={group.label} className="group" aria-label={group.label}>
              <div className="tiles">
                {group.items.map((item) => {
                  const d = view.derived[item.key];
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={`tile${d && d.breakdown.length > 1 ? " modified" : ""}`}
                      aria-expanded={open === item.key}
                      aria-controls={open === item.key ? `breakdown-${item.key}` : undefined}
                      onClick={() => toggle(item.key)}
                    >
                      {/* The spoken name starts with the visible text ("Dex 12"), as WCAG 2.5.3 asks. */}
                      <span className="label">{item.short}</span>{" "}
                      <span className="num">{formatValue(d?.value)}</span>
                      <span className="sr-only"> ({d?.label ?? item.short}): show how it's worked out</span>
                    </button>
                  );
                })}
              </div>
              {breakdownFor(keys)}
            </section>
          );
        }
        if (group.kind === "rows") {
          const prefix = group.prefix;
          const extra = prefix ? Object.keys(view.derived).filter((k) => k.startsWith(prefix.key)).map((key) => ({ key, format: prefix.format })) : [];
          const items = [...group.items, ...extra].filter((i) => view.derived[i.key]);
          if (items.length === 0) return null;
          const keys = items.map((i) => i.key);
          const formats = Object.fromEntries(items.map((i) => [i.key, i.format]));
          return (
            <section key={group.label} className="group" aria-label={group.label}>
              {prefix && <h3 className="label">{group.label}</h3>}
              <div className="rows">
                {items.map((item) => {
                  const d = view.derived[item.key];
                  if (!d) return null;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className="row"
                      aria-expanded={open === item.key}
                      aria-controls={open === item.key ? `breakdown-${item.key}` : undefined}
                      onClick={() => toggle(item.key)}
                    >
                      <span className="dim">{d.label}</span>
                      <span>{formatValue(d.value, item.format)}</span>
                    </button>
                  );
                })}
              </div>
              {breakdownFor(keys, formats)}
            </section>
          );
        }
        const items = view.lists[group.list] ?? [];
        if (items.length === 0) return null;
        return (
          <section key={group.label} className="group">
            <h3 className="label">{group.label}</h3>
            <p className="items">{items.map((i) => i.name).join(", ")}</p>
          </section>
        );
      })}
      {todo.length > 0 && (
        <section className="group">
          <h3 className="label">Needs attention</h3>
          <ul className="todo-list">
            {todo.map((item, i) => (
              <li key={i}>
                <button type="button" className="link" onClick={() => onGoTo(item)}>
                  {item.label}
                </button>
                <span className="dim"> ({item.stepLabel})</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
