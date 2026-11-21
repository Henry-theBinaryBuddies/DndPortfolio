// Generic choice controls, one per choice kind. They know nothing about any game: they draw a ChoiceSpec and
// report what was picked.
import { useId, useState } from "react";
import type { ChoiceSpec, ChoiceValue, Derived, ListItem, Option, ResolvedIssue, RollRecord } from "../core";
import { coinsText } from "./format";
import { Allocate, Assign, CompactRoll, Roll } from "./slots";

export interface ChoiceProps {
  spec: ChoiceSpec;
  value: ChoiceValue | undefined;
  issues: ResolvedIssue[];
  onChange: (value: ChoiceValue) => void;
  /** For slots that show the derived value they feed. */
  derived: Record<string, Derived>;
  /** For roll choices: the sets rolled so far, oldest first, and how to roll another. */
  rollSets: RollRecord[][];
  onRoll: (spec: ChoiceSpec) => void;
}

/** The DOM id of a choice, so "needs attention" links can jump to it. */
export const choiceDomId = (key: string) => `choice-${key}`;

export function ChoiceView(props: ChoiceProps) {
  switch (props.spec.kind) {
    case "pick-one":
      return props.spec.presentation === "segmented" ? <Segmented {...props} /> : props.spec.presentation === "list" ? <ListPick {...props} /> : <PickOne {...props} />;
    case "pick-many":
      return props.spec.presentation === "list" ? <ListPick {...props} /> : <PickMany {...props} />;
    case "assign":
      return <Assign {...props} />;
    case "allocate":
      return <Allocate {...props} />;
    case "roll":
      return props.spec.presentation === "compact" ? <CompactRoll {...props} /> : <Roll {...props} />;
    case "text":
    case "long-text":
      return <TextChoice {...props} />;
    case "number":
      return <NumberChoice {...props} />;
    case "quantities":
      return props.spec.presentation === "steppers" ? <Steppers {...props} /> : <Quantities {...props} />;
    case "image":
      return <ImageChoice {...props} />;
    default:
      return (
        <section className="choice" id={choiceDomId(props.spec.key)} tabIndex={-1}>
          <h2>{props.spec.label}</h2>
          <p className="notice" style={{ marginTop: 8 }}>This kind of choice has no screen yet.</p>
        </section>
      );
  }
}

/** A short pick-one list drawn as a switch (e.g. the ability score method). Still radio buttons underneath. */
function Segmented({ spec, value, issues, onChange }: ChoiceProps) {
  const name = useId();
  return (
    <fieldset className="choice" id={choiceDomId(spec.key)} tabIndex={-1}>
      <legend>{spec.label}</legend>
      {spec.source && <p className="meta">From {spec.source}</p>}
      {spec.hint && <p className="meta">{spec.hint}</p>}
      <div className="segmented">
        {(spec.options ?? []).map((option) => (
          <label key={String(option.value)} className={option.value === value ? "on" : undefined}>
            <input type="radio" name={name} checked={option.value === value} onChange={() => onChange(option.value)} />
            {option.name}
          </label>
        ))}
      </div>
      <Issues issues={issues} />
    </fieldset>
  );
}

function Meta({ spec, picked }: { spec: ChoiceSpec; picked: number }) {
  const parts: string[] = [];
  if (spec.source) parts.push(`From ${spec.source}`);
  if (spec.kind === "pick-many" && spec.count) parts.push(`${picked} of ${spec.count.max} chosen`);
  else if (spec.required && picked === 0) parts.push("To do");
  return (
    <>
      {parts.length > 0 && <p className="meta">{parts.join(" · ")}</p>}
      {spec.hint && <p className="meta">{spec.hint}</p>}
    </>
  );
}

export function Issues({ issues }: { issues: ResolvedIssue[] }) {
  return (
    <>
      {issues.map((issue) => (
        <p key={issue.id} className={`issue ${issue.severity}`} role={issue.severity === "error" ? "alert" : undefined}>
          {issue.message}
          {issue.override ? ` (allowed: ${issue.override.note})` : ""}
        </p>
      ))}
    </>
  );
}

function PickOne({ spec, value, issues, onChange }: ChoiceProps) {
  const name = useId();
  const options = spec.options ?? [];
  const selected = options.find((o) => o.value === value);
  if (options.length === 0) {
    return (
      <fieldset className="choice" id={choiceDomId(spec.key)} tabIndex={-1}>
        <legend>{spec.label}</legend>
        {spec.source && <p className="meta">From {spec.source}</p>}
        <p className="notice">Nothing to choose from in the loaded packs yet.</p>
      </fieldset>
    );
  }
  return (
    <fieldset className="choice" id={choiceDomId(spec.key)} tabIndex={-1}>
      <legend>{spec.label}</legend>
      <Meta spec={spec} picked={value === undefined ? 0 : 1} />
      <div className="cards" style={spec.columns ? { gridTemplateColumns: `repeat(${spec.columns}, minmax(0, 1fr))` } : undefined}>
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <label key={String(option.value)} className={`card${isSelected ? " selected" : ""}${option.unavailable ? " unavailable" : ""}`}>
              <input
                type="radio"
                name={name}
                checked={isSelected}
                disabled={Boolean(option.unavailable) && !isSelected}
                onChange={() => onChange(option.value)}
              />
              <span className="card-name">{option.name}</span>
              <span className="card-sub">{option.unavailable ?? option.tags?.[0] ?? option.summary ?? ""}</span>
            </label>
          );
        })}
      </div>
      {selected && <OptionDetail option={selected} />}
      <Issues issues={issues} />
    </fieldset>
  );
}

function OptionDetail({ option }: { option: Option }) {
  return (
    <div className="detail" aria-live="polite">
      <div className="detail-head">
        <h3>{option.name}</h3>
      </div>
      {option.summary && <p className="dim" style={{ fontSize: 14, marginTop: 4 }}>{option.summary}</p>}
      {option.tags && option.tags.length > 0 && (
        <ul className="chips" aria-label={`What ${option.name} gives`}>
          {option.tags.map((tag) => <li key={tag} className="chip">{tag}</li>)}
        </ul>
      )}
      {option.description && (
        <details className="more">
          <summary>Read more</summary>
          <p>{option.description}</p>
        </details>
      )}
    </div>
  );
}

function PickMany({ spec, value, issues, onChange }: ChoiceProps) {
  const options = spec.options ?? [];
  const picked = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  const max = spec.count?.max ?? options.length;
  const counterId = useId();
  const toggle = (option: Option) => {
    const v = String(option.value);
    onChange(picked.includes(v) ? picked.filter((p) => p !== v) : [...picked, v]);
  };
  return (
    <fieldset className="choice" id={choiceDomId(spec.key)} tabIndex={-1} aria-describedby={counterId}>
      <legend>{spec.label}</legend>
      <p className="meta" id={counterId}>
        {spec.source ? `From ${spec.source} · ` : ""}
        {picked.length} of {max} chosen
      </p>
      {options.length === 0 ? (
        <p className="notice">Nothing to choose from in the loaded packs yet.</p>
      ) : (
        <div className="picks">
          {options.map((option) => {
            const v = String(option.value);
            const on = picked.includes(v);
            const full = !on && picked.length >= max;
            const blocked = Boolean(option.unavailable) && !on;
            return (
              <label key={v} className={`chip-pick${on ? " selected" : ""}${option.unavailable ? " unavailable" : ""}`}>
                <input type="checkbox" checked={on} disabled={blocked || full} onChange={() => toggle(option)} />
                {option.name}
                {option.unavailable && <span className="dim" style={{ fontSize: 12 }}>· {option.unavailable}</span>}
              </label>
            );
          })}
        </div>
      )}
      <Issues issues={issues} />
    </fieldset>
  );
}

/** A read-only list on a step's page (what the chosen class gives), each item's full text behind "Read more". */
export function StepList({ label, items }: { label: string; items: ListItem[] }) {
  const id = useId();
  if (!items.length) return null;
  return (
    <section className="choice" aria-labelledby={id}>
      <h2 id={id} className="choice-title">{label}</h2>
      <ul className="gains">
        {items.map((item, i) => (
          <li key={`${item.source}:${item.name}:${i}`}>
            <span className="gain-name">{item.name}</span>
            <span className="dim">{[item.detail, item.source].filter(Boolean).map((t) => ` · ${t}`).join("")}</span>
            {item.description && (
              <details className="more">
                <summary>Read more<span className="sr-only"> about {item.name}</span></summary>
                <p>{item.description}</p>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Free text, with the system's suggestions to pick from or draw at random. Where several lines are wanted
 * (count.max > 1) a suggestion is added as a new line; otherwise it replaces the text. Nothing goes in the
 * roll log: suggestions are a writing aid, not a game roll.
 */
function TextChoice({ spec, value, issues, onChange }: ChoiceProps) {
  const id = choiceDomId(spec.key);
  const text = typeof value === "string" ? value : "";
  const suggestions = spec.suggestions ?? [];
  const lines = (spec.count?.max ?? 1) > 1;
  const use = (t: string) => onChange(lines && text.trim() ? `${text.trimEnd()}\n${t}` : t);
  const suggest = () => {
    const unused = suggestions.filter((s) => !text.includes(s.text));
    const pool = unused.length ? unused : suggestions;
    use(pool[Math.floor(Math.random() * pool.length)].text);
  };
  if (spec.group) {
    return (
      <div className="compact" id={id} tabIndex={-1}>
        <label htmlFor={`${id}-input`} className="label">{spec.label}</label>
        <div className="compact-row">
          <input id={`${id}-input`} className="text-input" value={text} onChange={(e) => onChange(e.target.value)} />
          {suggestions.length > 0 && (
            <button type="button" className="button small" onClick={suggest}>
              Suggest<span className="sr-only"> {spec.label.toLowerCase()}{spec.source ? ` for a ${spec.source.toLowerCase()}` : ""}</span>
            </button>
          )}
        </div>
        <Issues issues={issues} />
      </div>
    );
  }
  return (
    <section className="choice" id={id} tabIndex={-1}>
      <label htmlFor={`${id}-input`} className="choice-title">{spec.label}</label>
      {spec.hint && <p className="meta">{spec.hint}</p>}
      {spec.source && <p className="meta">Suggestions from {spec.source}</p>}
      {spec.kind === "long-text" ? (
        <textarea id={`${id}-input`} className="text-input" rows={lines ? 3 : 2} value={text} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={`${id}-input`} className="text-input" value={text} onChange={(e) => onChange(e.target.value)} />
      )}
      {suggestions.length > 0 && (
        <>
          <button type="button" className="button small" onClick={suggest}>
            Suggest<span className="sr-only"> {spec.label.toLowerCase()}</span>
          </button>
          <details className="more">
            <summary>All suggestions ({suggestions.length})<span className="sr-only"> for {spec.label.toLowerCase()}</span></summary>
            <ul className="suggestions">
              {suggestions.map((s) => (
                <li key={s.text}>
                  <button type="button" className="link" onClick={() => use(s.text)}>
                    {s.text}{s.note && <span className="dim"> ({s.note})</span>}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      <Issues issues={issues} />
    </section>
  );
}

/** A number in a range (e.g. the gold a DM gives). An empty box stores null: not answered yet. */
function NumberChoice({ spec, value, issues, onChange }: ChoiceProps) {
  const id = choiceDomId(spec.key);
  return (
    <section className="choice" id={id} tabIndex={-1}>
      <label htmlFor={`${id}-input`} className="choice-title">{spec.label}</label>
      {spec.hint && <p className="meta" id={`${id}-hint`}>{spec.hint}</p>}
      <input
        id={`${id}-input`}
        className="text-input number-input"
        type="number"
        inputMode="decimal"
        min={spec.range?.min}
        max={spec.range?.max}
        step="any"
        aria-describedby={spec.hint ? `${id}-hint` : undefined}
        value={typeof value === "number" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
      <Issues issues={issues} />
    </section>
  );
}

/** Stored quantities: option value → a whole number above 0. */
function asCounts(value: ChoiceValue | undefined): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((e): e is [string, number] => Number.isInteger(e[1]) && (e[1] as number) > 0));
}

const SHOWN = 40;

/**
 * How many of each option, within a budget: a shop. What's bought is listed first; the rest is found by searching
 * or browsing. Buying what can't be afforded is blocked here (the file may still say otherwise, and a DM can allow it).
 */
function Quantities({ spec, value, issues, onChange }: ChoiceProps) {
  const id = choiceDomId(spec.key);
  const [query, setQuery] = useState("");
  const options = spec.options ?? [];
  const counts = asCounts(value);
  const budget = spec.budget;
  const show = (n: number) => (budget?.format === "coins" ? coinsText(n) : String(n));
  const cost = (o: Option) => budget?.cost[String(o.value)] ?? 0;
  const spent = options.reduce((total, o) => total + cost(o) * (counts[String(o.value)] ?? 0), 0);
  const left = (budget?.total ?? 0) - spent;
  const set = (v: string, n: number) => {
    const next = { ...counts };
    if (n > 0) next[v] = n;
    else delete next[v];
    onChange(next);
  };
  const q = query.trim().toLowerCase();
  const matches = q ? options.filter((o) => o.name.toLowerCase().includes(q) || o.tags?.some((t) => t.toLowerCase().includes(q))) : [];
  const bought = options.filter((o) => counts[String(o.value)]);

  const row = (o: Option) => {
    const v = String(o.value);
    const n = counts[v] ?? 0;
    const tooDear = budget !== undefined && cost(o) > left;
    return (
      <li key={v}>
        <span className="shop-name">{o.name}</span>
        <span className="dim shop-tags">{o.tags?.join(" · ")}</span>
        <span className="stepper">
          <button type="button" className="button small" disabled={n === 0} onClick={() => set(v, n - 1)}>
            −<span className="sr-only"> remove one {o.name}</span>
          </button>
          <span className="final">{n}<span className="sr-only"> bought</span></span>
          <button type="button" className="button small" disabled={tooDear} onClick={() => set(v, n + 1)}>
            +<span className="sr-only"> buy one {o.name}{tooDear ? " (not enough money)" : ""}</span>
          </button>
        </span>
      </li>
    );
  };

  return (
    <section className="choice" id={id} tabIndex={-1} aria-labelledby={`${id}-label`}>
      <h2 id={`${id}-label`} className="choice-title">{spec.label}</h2>
      {spec.hint && <p className="meta">{spec.hint}</p>}
      {budget && (
        <p className="meta" aria-live="polite">
          Spent {show(spent)} of {show(budget.total)} · {left >= 0 ? `${show(left)} left` : <span className="attention">{show(-left)} over</span>}
        </p>
      )}
      {bought.length > 0 && (
        <>
          <h3 className="label">Bought</h3>
          <ul className="shop">{bought.map(row)}</ul>
        </>
      )}
      <label htmlFor={`${id}-search`} className="label shop-search-label">Search {options.length} items</label>
      <input id={`${id}-search`} className="text-input" type="search" value={query} placeholder="e.g. sword, armor, pack" onChange={(e) => setQuery(e.target.value)} />
      {q &&
        (matches.length ? (
          <>
            <ul className="shop">{matches.slice(0, SHOWN).map(row)}</ul>
            {matches.length > SHOWN && <p className="dim">Showing {SHOWN} of {matches.length}: type more to narrow it down.</p>}
          </>
        ) : (
          <p className="notice">Nothing matches “{query}”.</p>
        ))}
      {!q && (
        <details className="more">
          <summary>Browse all {options.length} items</summary>
          <ul className="shop">{options.map(row)}</ul>
        </details>
      )}
      <Issues issues={issues} />
    </section>
  );
}

/**
 * How many of each of a few options, all listed with their own − and +, within a budget (levels given to other
 * classes). An option that can't be taken says why but stays usable: the file may say otherwise and a DM can allow it.
 */
function Steppers({ spec, value, issues, onChange }: ChoiceProps) {
  const id = choiceDomId(spec.key);
  const options = spec.options ?? [];
  const counts = asCounts(value);
  const budget = spec.budget;
  const cost = (o: Option) => budget?.cost[String(o.value)] ?? 1;
  const spent = options.reduce((total, o) => total + cost(o) * (counts[String(o.value)] ?? 0), 0);
  const left = (budget?.total ?? 0) - spent;
  const set = (v: string, n: number) => {
    const next = { ...counts };
    if (n > 0) next[v] = n;
    else delete next[v];
    onChange(next);
  };
  return (
    <section className="choice" id={id} tabIndex={-1} aria-labelledby={`${id}-label`}>
      <h2 id={`${id}-label`} className="choice-title">{spec.label}</h2>
      {spec.hint && <p className="meta">{spec.hint}</p>}
      {budget && (
        <p className="meta" aria-live="polite">
          {spent} of {budget.total} given · {left >= 0 ? `${left} left` : <span className="attention">{-left} too many</span>}
        </p>
      )}
      <ul className="shop">
        {options.map((o) => {
          const v = String(o.value);
          const n = counts[v] ?? 0;
          const full = budget !== undefined && cost(o) > left;
          return (
            <li key={v}>
              <span className="shop-name">{o.name}</span>
              <span className={`shop-tags ${o.unavailable ? "attention" : "dim"}`}>{o.unavailable ?? [o.summary, ...(o.tags ?? [])].filter(Boolean).join(" · ")}</span>
              <span className="stepper">
                <button type="button" className="button small" disabled={n === 0} onClick={() => set(v, n - 1)}>
                  −<span className="sr-only"> one fewer for {o.name}</span>
                </button>
                <span className="final">{n}<span className="sr-only"> for {o.name}</span></span>
                <button type="button" className="button small" disabled={full} onClick={() => set(v, n + 1)}>
                  +<span className="sr-only"> one more for {o.name}{full ? " (none left to give)" : ""}</span>
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <Issues issues={issues} />
    </section>
  );
}

/** Tags the summary line doesn't already say (a spell's school is in it; Concentration and Ritual aren't). They all still filter. */
const extraTags = (o: Option) => (o.tags ?? []).filter((t) => !(o.summary ?? "").toLowerCase().includes(t.toLowerCase()));

/**
 * A long list of options as rows (spells): each with its one-line summary and tags, the full text behind "Read more",
 * a search, and a filter by tag. Radio buttons for one pick, checkboxes for several.
 */
function ListPick({ spec, value, issues, onChange }: ChoiceProps) {
  const id = choiceDomId(spec.key);
  const name = useId();
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const options = spec.options ?? [];
  const multi = spec.kind === "pick-many";
  const picked = multi
    ? (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [])
    : typeof value === "string" ? [value] : [];
  const max = multi ? (spec.count?.max ?? options.length) : 1;
  const tags = [...new Set(options.flatMap((o) => o.tags ?? []))].sort();
  const q = query.trim().toLowerCase();
  const shown = options.filter(
    (o) => (!q || o.name.toLowerCase().includes(q) || (o.summary ?? "").toLowerCase().includes(q)) && (!tag || o.tags?.includes(tag)),
  );
  const toggle = (v: string) => {
    if (!multi) return onChange(v);
    onChange(picked.includes(v) ? picked.filter((p) => p !== v) : [...picked, v]);
  };
  const chosen = options.filter((o) => picked.includes(String(o.value))).map((o) => o.name);
  const parts = [spec.source ? `From ${spec.source}` : "", multi ? `${picked.length} of ${max} chosen` : picked.length ? "" : spec.required ? "To do" : ""].filter(Boolean);

  if (options.length === 0) {
    return (
      <fieldset className="choice" id={id} tabIndex={-1}>
        <legend>{spec.label}</legend>
        {spec.source && <p className="meta">From {spec.source}</p>}
        <p className="notice">Nothing to choose from in the loaded packs yet.</p>
      </fieldset>
    );
  }
  return (
    <fieldset className="choice" id={id} tabIndex={-1} aria-describedby={`${id}-count`}>
      <legend>{spec.label}</legend>
      <p className="meta" id={`${id}-count`} aria-live="polite">
        {parts.join(" · ")}
        {chosen.length > 0 && <>{parts.length ? " · " : ""}Chosen: {chosen.join(", ")}</>}
      </p>
      {spec.hint && <p className="meta">{spec.hint}</p>}
      {options.length > 6 && (
        <div className="toolbar">
          <label>
            <span className="label">Search</span>
            <input className="text-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label={`Search: ${spec.label}`} />
          </label>
          {tags.length > 1 && (
            <label>
              <span className="label">Show only</span>
              <select className="text-input" value={tag} onChange={(e) => setTag(e.target.value)} aria-label={`Show only: ${spec.label}`}>
                <option value="">Everything</option>
                {tags.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      {shown.length === 0 && <p className="notice">Nothing matches. Clear the search or the filter to see all {options.length}.</p>}
      <ul className="option-list">
        {shown.map((option) => {
          const v = String(option.value);
          const on = picked.includes(v);
          const blocked = (Boolean(option.unavailable) || (multi && picked.length >= max)) && !on;
          return (
            <li key={v} className={`${on ? "selected" : ""}${option.unavailable ? " unavailable" : ""}`}>
              <label>
                <input type={multi ? "checkbox" : "radio"} name={name} checked={on} disabled={blocked} onChange={() => toggle(v)} />
                <span className="option-name">{option.name}</span>
                <span className="dim option-summary">{option.unavailable ?? option.summary}</span>
              </label>
              {extraTags(option).length > 0 && (
                <ul className="chips" aria-label={`About ${option.name}`}>
                  {extraTags(option).map((t) => <li key={t} className="chip">{t}</li>)}
                </ul>
              )}
              {option.description && (
                <details className="more">
                  <summary>Read more<span className="sr-only"> about {option.name}</span></summary>
                  <p className="pre-line">{option.description}</p>
                </details>
              )}
            </li>
          );
        })}
      </ul>
      <Issues issues={issues} />
    </fieldset>
  );
}

/** The longest side of a stored picture, in pixels. */
const IMAGE_SIZE = 256;

/** Reads a picture file and shrinks it to fit IMAGE_SIZE, as a data: URL (PNG stays PNG, for transparent tokens; the rest become JPEG). */
async function shrinkImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, IMAGE_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return file.type === "image/png" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A picture (a portrait): choose a file, see it, remove it. It is shrunk here, in the browser, before it is stored. */
function ImageChoice({ spec, value, issues, onChange }: ChoiceProps) {
  const id = choiceDomId(spec.key);
  const [error, setError] = useState<string | null>(null);
  const src = typeof value === "string" && value.startsWith("data:image/") ? value : undefined;
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setError("Choose a PNG, JPEG or WebP picture.");
    try {
      onChange(await shrinkImage(file));
    } catch {
      setError("That picture couldn't be read. Try another.");
    }
  };
  return (
    <section className="choice" id={id} tabIndex={-1}>
      <label htmlFor={`${id}-input`} className="choice-title">{spec.label}</label>
      {spec.hint && <p className="meta">{spec.hint}</p>}
      <div className="image-choice">
        {src ? <img src={src} alt={`${spec.label} chosen`} className="image-preview" /> : <div className="image-preview empty" aria-hidden="true">No picture</div>}
        <div>
          <input id={`${id}-input`} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void choose(e.target.files?.[0])} />
          {src && <button type="button" className="button small" onClick={() => onChange(null)}>Remove<span className="sr-only"> {spec.label.toLowerCase()}</span></button>}
        </div>
      </div>
      {error && <p className="issue error" role="alert">{error}</p>}
      <Issues issues={issues} />
    </section>
  );
}
