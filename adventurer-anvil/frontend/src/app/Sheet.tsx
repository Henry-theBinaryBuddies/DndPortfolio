// The character sheet: drawn from the system's layout (SystemModule.sheet), page by page, so the app knows no game.
// A page has a band across the top, columns side by side, then full-width sections; on a phone the columns stack. It
// prints with the browser's own print (see sheet.css): black on white, without the app's frame, each page on its own
// sheet of paper, with empty boxes to fill in by hand at the table, and long text only when asked for. DM rulings and
// the content's credits come last.
import { useId, useState } from "react";
import type { CharacterDocument, CharacterView, ChoiceSpec, ContentIndex, ListItem, SheetPage, SheetSection, SystemModule } from "../core";
import { formatValue } from "./format";
import { answerText } from "./pages";
import { asRecords } from "./records";
import "./sheet.css";

const MARK = { 1: "●", 2: "◆" } as const;

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/** What every section needs to draw itself. */
interface Ctx {
  view: CharacterView;
  doc: CharacterDocument;
  name: string;
  picture: { text: string; picture?: string };
  rulings: number;
  specs: Map<string, ChoiceSpec>;
}

export function Sheet({ system, view, doc, content, attributions, onReview, exports }: {
  system: SystemModule;
  view: CharacterView;
  doc: CharacterDocument;
  content: ContentIndex;
  attributions: string[];
  onReview: () => void;
  exports?: React.ReactNode;
}) {
  const [full, setFull] = useState(false);
  const fullId = useId();
  const pages = (system.sheet ?? []).filter((p) => !p.onlyWithList || (view.lists[p.onlyWithList]?.length ?? 0) > 0);
  const toDo = view.steps.filter((s) => s.status !== "done");
  const rulings = view.issues.filter((i) => i.override);
  const name = doc.name || "Unnamed character";
  const ctx: Ctx = {
    view, doc, name, picture: system.describe(doc, content), rulings: rulings.length,
    specs: new Map(view.steps.flatMap((s) => s.choices).map((c) => [c.key, c])),
  };

  return (
    <div className={`sheet${full ? " full-text" : ""}`}>
      <h1 tabIndex={-1} className="screen-only">Sheet</h1>
      <div className="sheet-tools screen-only">
        <button type="button" className="button primary" onClick={() => window.print()}>Print</button>
        <label htmlFor={fullId} className="check">
          <input id={fullId} type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> Print full text
        </label>
        {exports}
      </div>
      {toDo.length > 0 && (
        <p className="notice banner screen-only">
          Not finished: {toDo.length} step{toDo.length > 1 ? "s" : ""} to do ({toDo.map((s) => s.label).join(", ")}).{" "}
          <button type="button" className="link" onClick={onReview}>Go to Review</button>
        </p>
      )}

      {pages.map((page, p) => (
        <Page key={page.label} page={page} ctx={ctx}>
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
          {p === pages.length - 1 && attributions.length > 0 && <p className="dim sheet-credits">{attributions.join(" ")}</p>}
        </Page>
      ))}
    </div>
  );
}

function Page({ page, ctx, children }: { page: SheetPage; ctx: Ctx; children?: React.ReactNode }) {
  return (
    <section className="sheet-page" aria-label={page.label}>
      {page.header?.map((s) => <Section key={keyOf(s)} section={s} ctx={ctx} />)}
      {page.columns && (
        <div className="sheet-columns" style={{ "--sheet-columns": page.columns.length } as React.CSSProperties}>
          {page.columns.map((column, i) => (
            <div key={i} className="sheet-col">{column.map((s) => <Section key={keyOf(s)} section={s} ctx={ctx} />)}</div>
          ))}
        </div>
      )}
      {page.sections?.map((s) => <Section key={keyOf(s)} section={s} ctx={ctx} />)}
      {children}
    </section>
  );
}

const keyOf = (s: SheetSection) => `${s.kind}:${s.label}`;

/** Empty boxes to tick by hand; screen readers hear how many. */
function Boxes({ count, what }: { count: number; what: string }) {
  return (
    <span className="tick-boxes">
      {Array.from({ length: count }, (_, i) => <span key={i} className="tick-box" aria-hidden="true" />)}
      <span className="sr-only">{count} {count === 1 ? "box" : "boxes"} to tick for {what}</span>
    </span>
  );
}

function Section({ section, ctx }: { section: SheetSection; ctx: Ctx }) {
  const id = useId();
  const { view, doc } = ctx;
  const box = (body: React.ReactNode, className = "") => (
    <section className={`sheet-box kind-${section.kind} ${className}`} aria-labelledby={id}>
      <h3 id={id} className="label sheet-caption">{section.label}</h3>
      {body}
    </section>
  );
  const value = (key: string, format?: Parameters<typeof formatValue>[1]) => (view.derived[key] ? formatValue(view.derived[key].value, format) : "–");
  const withPrefix = (prefix?: { key: string }) => (prefix ? Object.keys(view.derived).filter((k) => k.startsWith(prefix.key)) : []);

  switch (section.kind) {
    case "identity": {
      const facts = (
        <dl className="facts">
          {section.fields.map((f) => {
            if ("blank" in f) return <div key={f.blank} className="blank-field"><dt>{f.blank}</dt><dd>&nbsp;</dd></div>;
            const label = f.label ?? ("choice" in f ? ctx.specs.get(f.choice)?.label : view.derived[f.derived]?.label) ?? "";
            const shown = "choice" in f
              ? (ctx.specs.get(f.choice) && answerText(ctx.specs.get(f.choice)!, doc.choices[f.choice])) || "–"
              : value(f.derived, f.format);
            return <div key={label}><dt>{label}</dt><dd>{shown}</dd></div>;
          })}
          {ctx.rulings > 0 && <div><dt>DM rulings</dt><dd className="attention">{ctx.rulings}</dd></div>}
        </dl>
      );
      if (section.banner) {
        return (
          <section className="sheet-banner" aria-labelledby={id}>
            <div className="sheet-namebox">
              <span className="sheet-caption">Character name</span>
              <h2 id={id} className="sheet-name">{ctx.name}</h2>
            </div>
            {facts}
          </section>
        );
      }
      return (
        <section className="sheet-box kind-identity identity" aria-labelledby={id}>
          <Portrait ctx={ctx} />
          <div className="identity-text">
            <h2 id={id} className="sheet-name">{ctx.name}</h2>
            {ctx.picture.text && <p className="dim">{ctx.picture.text}</p>}
            {facts}
          </div>
        </section>
      );
    }
    case "portrait":
      return box(<Portrait ctx={ctx} />);
    case "split":
      return (
        <div className="sheet-split" role="group" aria-label={section.label}>
          {section.columns.map((column, i) => (
            <div key={i} className="sheet-col">{column.map((s) => <Section key={keyOf(s)} section={s} ctx={ctx} />)}</div>
          ))}
        </div>
      );
    case "tiles":
      return box(
        <ul className={`sheet-tiles${section.tall ? " tall" : ""}`}>
          {section.items.map((t) => (
            <li key={t.key}>
              <span className="label">{t.short}</span>
              {section.tall && t.note ? (
                <>
                  <span className="sheet-big">{value(t.note, "signed")}</span>
                  <span className="sheet-score">{value(t.key)}</span>
                </>
              ) : (
                <>
                  <span className="sheet-big">{value(t.key)}</span>
                  {t.note && <span className="dim">{value(t.note, "signed")}</span>}
                </>
              )}
            </li>
          ))}
        </ul>,
      );
    case "stats":
      if (section.inline) {
        return (
          <section className="sheet-box kind-stats inline" aria-labelledby={id}>
            {section.items.map((s, i) => (
              <p key={s.key} className="sheet-inline">
                <span className="sheet-big">{value(s.key, s.format)}</span>
                <span id={i === 0 ? id : undefined} className="sheet-caption">{s.label ?? view.derived[s.key]?.label ?? s.key}</span>
              </p>
            ))}
          </section>
        );
      }
      return box(
        <ul className={`sheet-stats${section.small ? " small" : ""}`}>
          {section.items.map((s) => (
            <li key={s.key} className={s.shape ?? ""}>
              <span className="sheet-caption">{s.label ?? view.derived[s.key]?.label ?? s.key}</span>
              <span className="sheet-big">{section.blankZero && !view.derived[s.key]?.value ? " " : value(s.key, s.format)}</span>
            </li>
          ))}
        </ul>,
      );
    case "blanks":
      return box(
        <div className="sheet-blanks">
          {section.items.map((b) => (
            <div key={b.label} className={`sheet-blank${b.large ? " large" : ""}`}>
              <span className="sheet-caption">{b.label}</span>
              {b.above && <p className="sheet-above"><span className="dim">{b.above.label}</span> {value(b.above.key, b.above.format)}</p>}
              <div className="write-in" aria-hidden="true" />
            </div>
          ))}
        </div>,
        section.items.length > 1 ? "" : "single",
      );
    case "ticks":
      return box(
        <ul className="sheet-ticks">
          {section.rows.map((r) => (
            <li key={r.label}>
              {section.rows.length > 1 && <span className="dim">{r.label}</span>}
              <Boxes count={r.count} what={r.label} />
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
                <span className="final">{formatValue(d.value, "signed")}</span>
                <span>{section.trim ? d.label.replace(section.trim, "") : d.label}</span>
              </li>
            );
          })}
        </ul>,
      );
    }
    case "rows": {
      const rows = [...section.items, ...withPrefix(section.prefix).map((key) => ({ key, format: section.prefix?.format }))].filter((r) => view.derived[r.key]);
      if (section.table) {
        const { columns, separator } = section.table;
        return box(
          <table className="sheet-table">
            <thead><tr>{columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => {
                const parts = String(view.derived[r.key].value).split(separator);
                return (
                  <tr key={r.key}>
                    <th scope="row">{view.derived[r.key].label}</th>
                    {columns.slice(1).map((c, i) => <td key={c}>{i === columns.length - 2 ? parts.slice(i).join(separator) : parts[i] ?? ""}</td>)}
                  </tr>
                );
              })}
              {/* Empty lines to write more on by hand. */}
              {Array.from({ length: Math.max(2, 5 - rows.length) }, (_, i) => (
                <tr key={`blank-${i}`} aria-hidden="true" className="blank-row">{columns.map((c) => <td key={c}>&nbsp;</td>)}</tr>
              ))}
            </tbody>
          </table>,
        );
      }
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
      if (section.inline) {
        return box(<p className="sheet-inline-list">{items.map((i) => i.name).join(" · ")}</p>);
      }
      const counts = section.groupTicks
        ? Object.fromEntries(Object.entries(section.groupTicks).map(([group, key]) => [group, Number(view.derived[key]?.value ?? 0)]))
        : undefined;
      return box(<SheetList items={items} full={section.full ?? false} ticks={section.ticks ?? false} groupTicks={counts} />, `${section.full ? "wide" : ""}${section.flow === "columns" ? " flow-columns" : ""}`);
    }
    case "ledger": {
      const [qty, what, weight] = section.columns;
      const checks = section.checks ?? [];
      const tables = ledgerColumns(view.lists[section.list] ?? [], section.split ?? 1, section.lines ?? 8);
      return box(
        <div className={`ledger${section.sideAcross ? " across" : ""}`}>
          <dl className="ledger-side">
            {section.side.map((s) => (
              <div key={s.key}>
                <dt>{s.label}</dt>
                <dd>{view.derived[s.key] && view.derived[s.key].value !== 0 ? formatValue(view.derived[s.key].value, s.format) : " "}</dd>
              </div>
            ))}
          </dl>
          <div className="ledger-tables" style={{ "--ledger-split": tables.length } as React.CSSProperties}>
            {tables.map((rows, t) => (
              <table key={t} className="sheet-table ledger-table">
                <thead>
                  <tr>
                    <th scope="col">{qty}</th><th scope="col">{what}</th>
                    {checks.map((c) => <th key={c.flag} scope="col" className="ledger-check"><abbr title={c.name}>{c.short}</abbr></th>)}
                    <th scope="col">{weight}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) =>
                    row.kind === "group" ? (
                      <tr key={i} className="ledger-group"><td /><td colSpan={2 + checks.length}>{row.text}</td></tr>
                    ) : row.kind === "item" ? (
                      <tr key={i} className={row.item.detail ? "in-group" : ""}>
                        <td>{row.item.count?.qty ?? 1}</td>
                        <th scope="row">{row.item.count?.name ?? row.item.name}</th>
                        {checks.map((c) => {
                          const on = row.item.flags?.includes(c.flag) ?? false;
                          return (
                            <td key={c.flag} className="ledger-check">
                              <span className={`tick-box${on ? " ticked" : ""}`} aria-hidden="true" />
                              <span className="sr-only">{on ? c.name : `not ${c.name.toLowerCase()}`}</span>
                            </td>
                          );
                        })}
                        <td>{row.item.weight ? row.item.weight : "–"}</td>
                      </tr>
                    ) : (
                      // Empty lines to write more on by hand.
                      <tr key={i} aria-hidden="true" className="blank-row"><td>&nbsp;</td><td>&nbsp;</td>{checks.map((c) => <td key={c.flag} className="ledger-check"><span className="tick-box" /></td>)}<td>&nbsp;</td></tr>
                    ),
                  )}
                </tbody>
              </table>
            ))}
          </div>
        </div>,
      );
    }
    case "records": {
      const spec = ctx.specs.get(section.key);
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
      const all = section.keys.map((k) => ({ k, label: ctx.specs.get(k)?.label, text: doc.choices[k] }));
      if (section.boxes) {
        const shown = all.filter((a): a is typeof a & { label: string } => Boolean(a.label));
        if (!shown.length) return null;
        return (
          <div className="sheet-textboxes" role="group" aria-label={section.label}>
            {shown.map((a) => (
              <section key={a.k} className="sheet-box text-box" aria-label={a.label}>
                <h3 className="label sheet-caption">{a.label}</h3>
                <p className="sheet-text-body">{typeof a.text === "string" && a.text.trim() ? a.text : " "}</p>
              </section>
            ))}
          </div>
        );
      }
      const answered = all.filter((a): a is { k: string; label: string; text: string } => Boolean(a.label) && typeof a.text === "string" && a.text.trim() !== "");
      if (!answered.length) return null;
      return box(
        <dl className="sheet-text">
          {answered.map((a) => <div key={a.k}><dt>{a.label}</dt><dd>{a.text}</dd></div>)}
        </dl>,
      );
    }
  }
}

function Portrait({ ctx }: { ctx: Ctx }) {
  return ctx.picture.picture
    ? <img src={ctx.picture.picture} alt={`Portrait of ${ctx.name}`} className="avatar" />
    : <span className="avatar" aria-hidden="true">{initials(ctx.name)}</span>;
}

type LedgerRow = { kind: "group"; text: string } | { kind: "item"; item: ListItem } | { kind: "blank" };

/**
 * A ledger's rows, cut into `split` tables of at least `lines` rows each: things sharing a detail (what they came in) sit
 * under it, said once; a cut is moved back to keep such a group in one table when it fits; and every table is filled
 * with blank lines to the same length, at least two of them after the last thing.
 */
export function ledgerColumns(items: ListItem[], split: number, lines: number): LedgerRow[][] {
  const rows: LedgerRow[] = [];
  // For each row, the index of its group's heading row (-1 when it's in no group).
  const groupOf: number[] = [];
  items.forEach((item, i) => {
    if (item.detail && item.detail !== items[i - 1]?.detail) {
      rows.push({ kind: "group", text: item.detail });
      groupOf.push(rows.length - 1);
    }
    rows.push({ kind: "item", item });
    groupOf.push(item.detail ? groupOf[groupOf.length - 1] : -1);
  });
  const per = Math.max(lines, Math.ceil((rows.length + 2) / split));
  const tables: LedgerRow[][] = [];
  let at = 0;
  for (let t = 0; t < split; t++) {
    let end = t === split - 1 ? rows.length : Math.min(rows.length, at + per);
    const group = end < rows.length ? groupOf[end] : -1;
    if (group > at && groupOf.filter((g) => g === group).length <= per) end = group;
    const table = rows.slice(at, end);
    at = end;
    while (table.length < per) table.push({ kind: "blank" });
    tables.push(table);
  }
  return tables;
}

/**
 * A list, under its groups' headings (with boxes to tick after a heading, when the group has a count); boxes to tick
 * after items with uses; long text behind "Read more" on screen, and printed only when asked for.
 */
function SheetList({ items, full, ticks, groupTicks }: { items: ListItem[]; full: boolean; ticks: boolean; groupTicks?: Record<string, number> }) {
  const parts: { group?: string; items: ListItem[] }[] = [];
  for (const item of items) {
    const last = parts.at(-1);
    if (last && last.group === item.group) last.items.push(item);
    else parts.push({ group: item.group, items: [item] });
  }
  return (
    <>
      {parts.map((part, i) => (
        <div key={`${part.group ?? ""}:${i}`} className="sheet-list-part">
          {part.group && (
            <h4 className="sheet-group">
              {part.group}
              {groupTicks?.[part.group] ? <Boxes count={groupTicks[part.group]} what={`${part.group} slots`} /> : null}
            </h4>
          )}
          <ul className="sheet-list">
            {part.items.map((item, j) => (
              <li key={`${item.source}:${item.name}:${j}`}>
                <span className="gain-name">{item.name}</span>
                {ticks && item.uses ? <Boxes count={item.uses} what={item.name} /> : null}
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
