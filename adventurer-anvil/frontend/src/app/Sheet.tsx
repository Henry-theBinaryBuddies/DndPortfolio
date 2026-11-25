// The character sheet: drawn from the system's layout (SystemModule.sheet), page by page, so the app knows no game.
// It prints with the browser's own print (see the print styles in theme.css): light, without the app's frame, each
// page on its own sheet of paper, and long text only when asked for. DM rulings and the content's credits come last.
import { useId, useState } from "react";
import type { CharacterDocument, CharacterView, ContentIndex, ListItem, SheetSection, SystemModule } from "../core";
import { formatValue } from "./format";
import { answerText } from "./pages";
import { asRecords } from "./records";

const MARK = { 1: "●", 2: "◆" } as const;

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

export function Sheet({ system, view, doc, content, attributions, onReview }: {
  system: SystemModule;
  view: CharacterView;
  doc: CharacterDocument;
  content: ContentIndex;
  attributions: string[];
  onReview: () => void;
}) {
  const [full, setFull] = useState(false);
  const fullId = useId();
  const pages = system.sheet ?? [];
  const toDo = view.steps.filter((s) => s.status !== "done");
  const rulings = view.issues.filter((i) => i.override);
  const name = doc.name || "Unnamed character";

  return (
    <div className={`sheet${full ? " full-text" : ""}`}>
      <h1 tabIndex={-1} className="screen-only">Sheet</h1>
      <div className="sheet-tools screen-only">
        <button type="button" className="button primary" onClick={() => window.print()}>Print</button>
        <label htmlFor={fullId} className="check">
          <input id={fullId} type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> Print full text
        </label>
      </div>
      {toDo.length > 0 && (
        <p className="notice banner screen-only">
          Not finished: {toDo.length} step{toDo.length > 1 ? "s" : ""} to do ({toDo.map((s) => s.label).join(", ")}).{" "}
          <button type="button" className="link" onClick={onReview}>Go to Review</button>
        </p>
      )}

      {pages.map((page, p) => (
        <section key={page.label} className="sheet-page" aria-label={page.label}>
          {page.sections.map((section) => (
            <Section key={`${section.kind}:${section.label}`} section={section} view={view} doc={doc} name={name} picture={system.describe(doc, content)} rulings={rulings.length} />
          ))}
          {p === pages.length - 1 && rulings.length > 0 && (
            <section className="sheet-box rulings" aria-labelledby="sheet-rulings">
              <h3 id="sheet-rulings" className="label">DM rulings</h3>
              <ul>
                {rulings.map((r) => (
                  <li key={r.id}>{r.message} <span className="dim">Allowed{r.override?.note ? `: “${r.override.note}”` : ""}.</span></li>
                ))}
              </ul>
            </section>
          )}
          {p === pages.length - 1 && attributions.length > 0 && (
            <p className="dim sheet-credits">{attributions.join(" ")}</p>
          )}
        </section>
      ))}
    </div>
  );
}

function Section({ section, view, doc, name, picture, rulings }: {
  section: SheetSection;
  view: CharacterView;
  doc: CharacterDocument;
  name: string;
  picture: { text: string; picture?: string };
  rulings: number;
}) {
  const id = useId();
  const box = (body: React.ReactNode, className = "") => (
    <section className={`sheet-box ${className}`} aria-labelledby={id}>
      <h3 id={id} className="label">{section.label}</h3>
      {body}
    </section>
  );
  const value = (key: string, format?: Parameters<typeof formatValue>[1]) => (view.derived[key] ? formatValue(view.derived[key].value, format) : "–");
  const withPrefix = (prefix?: { key: string }) => (prefix ? Object.keys(view.derived).filter((k) => k.startsWith(prefix.key)) : []);

  switch (section.kind) {
    case "identity": {
      const specs = new Map(view.steps.flatMap((s) => s.choices).map((c) => [c.key, c]));
      return (
        <section className="sheet-box identity" aria-labelledby={id}>
          {picture.picture ? <img src={picture.picture} alt={`Portrait of ${name}`} className="avatar" /> : <span className="avatar" aria-hidden="true">{initials(name)}</span>}
          <div className="identity-text">
            <h2 id={id} className="sheet-name">{name}</h2>
            {picture.text && <p className="dim">{picture.text}</p>}
            <dl className="facts">
              {section.fields.map((f) => {
                const label = f.label ?? ("choice" in f ? specs.get(f.choice)?.label : view.derived[f.derived]?.label) ?? "";
                const shown = "choice" in f
                  ? (specs.get(f.choice) && answerText(specs.get(f.choice)!, doc.choices[f.choice])) || "–"
                  : value(f.derived, f.format);
                return <div key={label}><dt>{label}</dt><dd>{shown}</dd></div>;
              })}
              {rulings > 0 && <div><dt>DM rulings</dt><dd className="attention">{rulings}</dd></div>}
            </dl>
          </div>
        </section>
      );
    }
    case "tiles":
      return box(
        <ul className="sheet-tiles">
          {section.items.map((t) => (
            <li key={t.key}>
              <span className="label">{t.short}</span>
              <span className="sheet-big">{value(t.key)}</span>
              {t.note && <span className="dim">{value(t.note, "signed")}</span>}
            </li>
          ))}
        </ul>,
      );
    case "stats":
      return box(
        <ul className="sheet-stats">
          {section.items.map((s) => (
            <li key={s.key}>
              <span className="dim">{s.label ?? view.derived[s.key]?.label ?? s.key}</span>
              <span className="sheet-big">{value(s.key, s.format)}</span>
            </li>
          ))}
        </ul>,
      );
    case "checklist": {
      const keys = [...section.items.map((i) => i.key), ...withPrefix(section.prefix)];
      return box(
        <ul className="sheet-checklist">
          {keys.map((k) => {
            const d = view.derived[k];
            if (!d) return null;
            return (
              <li key={k}>
                <span className="sheet-mark" aria-hidden="true">{d.mark ? MARK[d.mark.level] : "○"}</span>
                <span className="sr-only">{d.mark?.label ?? section.unmarked}: </span>
                <span>{d.label}</span>
                <span className="final">{formatValue(d.value, "signed")}</span>
              </li>
            );
          })}
        </ul>,
      );
    }
    case "rows": {
      const rows = [...section.items, ...withPrefix(section.prefix).map((key) => ({ key, format: section.prefix?.format }))].filter((r) => view.derived[r.key]);
      if (!rows.length) return null;
      return box(
        <dl className="sheet-rows">
          {rows.map((r) => <div key={r.key}><dt>{view.derived[r.key].label}</dt><dd>{value(r.key, r.format)}</dd></div>)}
        </dl>,
      );
    }
    case "list": {
      const items = view.lists[section.list] ?? [];
      if (!items.length) return null;
      return box(<SheetList items={items} full={section.full ?? false} />, section.full ? "wide" : "");
    }
    case "records": {
      const spec = view.steps.flatMap((s) => s.choices).find((c) => c.key === section.key);
      const rows = asRecords(doc.choices[section.key]);
      if (!spec || !rows.length) return null;
      const fields = spec.fields ?? [];
      const shown = section.newestFirst ? [...rows].reverse() : rows;
      return box(
        <ul className="sheet-records">
          {shown.map((r) => {
            const line = fields
              .filter((f) => f.type !== "long-text")
              .map((f) => (f.type === "check" ? (r[f.id] === true ? f.label : "") : r[f.id] === null || r[f.id] === undefined ? "" : String(r[f.id])))
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={r.id}>
                {line && <span className="gain-name">{line}</span>}
                {fields.filter((f) => f.type === "long-text" && typeof r[f.id] === "string" && r[f.id]).map((f) => <p key={f.id} className="sheet-record-text">{String(r[f.id])}</p>)}
              </li>
            );
          })}
        </ul>,
        `wide${section.print === "full-only" ? " print-full-only" : ""}`,
      );
    }
    case "text": {
      const specs = new Map(view.steps.flatMap((s) => s.choices).map((c) => [c.key, c]));
      const answered = section.keys
        .map((k) => ({ k, label: specs.get(k)?.label, text: doc.choices[k] }))
        .filter((a): a is { k: string; label: string; text: string } => Boolean(a.label) && typeof a.text === "string" && a.text.trim() !== "");
      if (!answered.length) return null;
      return box(
        <dl className="sheet-text">
          {answered.map((a) => <div key={a.k}><dt>{a.label}</dt><dd>{a.text}</dd></div>)}
        </dl>,
        "wide",
      );
    }
  }
}

/** A list, under its groups' headings; long text behind "Read more" on screen, and printed only when asked for. */
function SheetList({ items, full }: { items: ListItem[]; full: boolean }) {
  const parts: { group?: string; items: ListItem[] }[] = [];
  for (const item of items) {
    const last = parts.at(-1);
    if (last && last.group === item.group) last.items.push(item);
    else parts.push({ group: item.group, items: [item] });
  }
  return (
    <>
      {parts.map((part, i) => (
        <div key={`${part.group ?? ""}:${i}`}>
          {part.group && <h4 className="sheet-group">{part.group}</h4>}
          <ul className="sheet-list">
            {part.items.map((item, j) => (
              <li key={`${item.source}:${item.name}:${j}`}>
                <span className="gain-name">{item.name}</span>
                <span className="dim">{[item.detail, item.source].filter(Boolean).map((t) => ` · ${t}`).join("")}</span>
                {full && item.description && (
                  <>
                    <details className="more screen-only">
                      <summary>Read more<span className="sr-only"> about {item.name}</span></summary>
                      <p>{item.description}</p>
                    </details>
                    <p className="print-only item-description">{item.description}</p>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
