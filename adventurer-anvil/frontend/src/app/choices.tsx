// Generic choice controls, one per choice kind. They know nothing about any game: they draw a ChoiceSpec and
// report what was picked.
import { useId } from "react";
import type { ChoiceSpec, ChoiceValue, Derived, ListItem, Option, ResolvedIssue, RollRecord } from "../core";
import { Allocate, Assign, Roll } from "./slots";

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
      return props.spec.presentation === "segmented" ? <Segmented {...props} /> : <PickOne {...props} />;
    case "pick-many":
      return <PickMany {...props} />;
    case "assign":
      return <Assign {...props} />;
    case "allocate":
      return <Allocate {...props} />;
    case "roll":
      return <Roll {...props} />;
    case "text":
    case "long-text":
      return <TextChoice {...props} />;
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
  return parts.length ? <p className="meta">{parts.join(" · ")}</p> : null;
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
      <div className="cards">
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
  return (
    <section className="choice" id={id} tabIndex={-1}>
      <label htmlFor={`${id}-input`} className="choice-title">{spec.label}</label>
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
