// The Review and Licences pages: built from the core's evaluation and the loaded packs, so every system gets them.
import { useId, useState } from "react";
import { NAME_KEY, type CharacterDocument, type CharacterView, type ChoiceSpec, type ChoiceValue, type LevelUp, type ResolvedIssue } from "../core";
import { coinsText } from "./format";
import { LICENCE_NAME, SOURCE_URL } from "./source";
import type { LoadedPack } from "./packs";

const SHOWN = 6;

/** A choice's answer in words: option names, slot values, the start of a text. Nothing for an unanswered choice. */
export function answerText(spec: ChoiceSpec, value: ChoiceValue | undefined): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const nameOf = (v: unknown) => spec.options?.find((o) => o.value === v)?.name ?? String(v);
  const list = (names: string[]) => (names.length > SHOWN ? `${names.slice(0, SHOWN).join(", ")} and ${names.length - SHOWN} more` : names.join(", "));
  switch (spec.kind) {
    case "pick-one":
      return nameOf(value);
    case "pick-many":
      return Array.isArray(value) && value.length ? list(value.map(nameOf)) : undefined;
    case "assign":
    case "allocate": {
      if (typeof value !== "object" || Array.isArray(value)) return undefined;
      const v = value as Record<string, unknown>;
      // Values that start from 0 (an increase) are shown as "+2", and the zeros left out.
      const increase = spec.kind === "allocate" && (spec.range?.min ?? 0) === 0;
      const parts = (spec.slots ?? [])
        .filter((s) => v[s.id] !== undefined && !(increase && !v[s.id]))
        .map((s) => `${s.name.slice(0, 3)} ${increase ? "+" : ""}${v[s.id]}`);
      return parts.length ? parts.join(", ") : undefined;
    }
    case "records": {
      const n = Array.isArray(value) ? value.length : 0;
      return n ? `${n} ${n === 1 ? spec.recordName?.one ?? "row" : spec.recordName?.many ?? "rows"}` : undefined;
    }
    case "quantities": {
      if (typeof value !== "object" || Array.isArray(value)) return undefined;
      if (spec.presentation === "adjust") {
        const parts = Object.entries(value).filter(([, n]) => typeof n === "number" && n !== 0).map(([v, n]) => `${nameOf(v)} ${(n as number) > 0 ? "+" : "−"}${Math.abs(n as number)}`);
        return parts.length ? list(parts) : undefined;
      }
      // A shop's "Rope × 2"; a short list of steppers' "Wizard 1".
      const parts = Object.entries(value).filter(([, n]) => typeof n === "number" && n > 0)
        .map(([v, n]) => (spec.presentation === "steppers" ? `${nameOf(v)} ${n}` : n === 1 ? nameOf(v) : `${nameOf(v)} × ${n}`));
      const spent = Object.entries(value).reduce((t, [v, n]) => t + (spec.budget?.cost[v] ?? 0) * (typeof n === "number" ? n : 0), 0);
      return parts.length ? `${list(parts)}${spec.budget?.format === "coins" ? ` (${coinsText(spent)})` : ""}` : undefined;
    }
    case "text":
    case "long-text": {
      const t = String(value).trim().replace(/\s+/g, " ");
      return t ? (t.length > 80 ? `${t.slice(0, 77)}…` : t) : undefined;
    }
    case "number":
      return String(value);
    case "image":
      return "Added";
    default:
      return undefined;
  }
}

/** A choice's label as a heading for its answer: "Choose a race" → "Race", "Choose your Divine Domain" → "Divine Domain". */
export const shortLabel = (label: string) => {
  const m = /^Choose (?:a |an |your |the )?(.+)$/.exec(label);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : label;
};

/** Asks for a short note, then records a DM ruling that lets one problem stand. */
function Allow({ issue, onAllow }: { issue: ResolvedIssue; onAllow: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const id = useId();
  if (!open) {
    return <button type="button" className="link" onClick={() => setOpen(true)}>Allow…<span className="sr-only"> {issue.message}</span></button>;
  }
  return (
    <form className="allow-form" onSubmit={(e) => { e.preventDefault(); if (note.trim()) onAllow(note.trim()); }}>
      <label htmlFor={id} className="sr-only">Why it's allowed (a short note for the sheet)</label>
      <input id={id} className="text-input" value={note} placeholder="Why it's allowed, e.g. a gift from the DM" onChange={(e) => setNote(e.target.value)} autoFocus />
      <button type="submit" className="button small" disabled={!note.trim()}>Allow</button>
      <button type="button" className="button small" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

export function Review({ view, doc, stepLabel, onGoTo, onClear, onAllow, onDisallow, onDownload, levelUp, onLevelUp, exports }: {
  view: CharacterView;
  doc: CharacterDocument;
  stepLabel: (id: string) => string;
  onGoTo: (step: string, key?: string) => void;
  onClear: (keys: string[]) => void;
  onAllow: (issueId: string, note: string) => void;
  onDisallow: (issueId: string) => void;
  onDownload: () => void;
  /** Whether the character can go up a level (for systems that have levels), and doing it. */
  levelUp?: LevelUp;
  onLevelUp?: () => void;
  /** Buttons for the system's exporters (another program's file). */
  exports?: React.ReactNode;
}) {
  const open = view.issues.filter((i) => !i.override);
  const errors = open.filter((i) => i.severity === "error");
  const warnings = open.filter((i) => i.severity === "warning");
  const allowed = view.issues.filter((i) => i.override);
  const ready = view.steps.every((s) => s.status === "done") && errors.length === 0;
  const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

  return (
    <>
      <h1 tabIndex={-1}>Review</h1>
      {ready ? (
        <p className="ready">✓ Ready: every step is done{allowed.length ? `, with ${allowed.length} DM ruling${allowed.length > 1 ? "s" : ""}` : ""}.</p>
      ) : (
        <p className="dim" style={{ marginTop: 4 }}>Everything chosen so far, and what's still to settle.</p>
      )}

      <section className="section" aria-labelledby="review-steps">
        <h2 id="review-steps">Your choices</h2>
        <ul className="answers">
          {view.steps.map((step) => {
            const answers = step.choices
              .map((c) => ({ spec: c, label: shortLabel(c.label), text: answerText(c, c.key === NAME_KEY ? doc.name : (doc.choices[c.key] ?? c.defaultValue)) }))
              .filter((a): a is { spec: ChoiceSpec; label: string; text: string } => Boolean(a.text));
            return (
              <li key={step.id}>
                <span>
                  {step.label}
                  {step.status !== "done" && <span className={step.status === "problem" ? "attention" : "dim"}> · {step.status === "problem" ? "has a problem" : "to do"}</span>}
                </span>
                <span className="answer-list">
                  {answers.length ? answers.map((a) => <span key={a.spec.key} style={{ display: "block" }}><span className="dim">{a.label}: </span>{a.text}</span>) : <span className="dim">Nothing chosen yet</span>}
                </span>
                <button type="button" className="link" onClick={() => onGoTo(step.id)}>Change<span className="sr-only"> {step.label}</span></button>
              </li>
            );
          })}
        </ul>
      </section>

      {(errors.length > 0 || warnings.length > 0) && (
        <section className="section" aria-labelledby="review-issues">
          <h2 id="review-issues">Problems and notes</h2>
          <ul>
            {[...errors, ...warnings].map((issue) => (
              <li key={issue.id}>
                <span className={issue.severity === "error" ? "attention" : "dim"}>{issue.message}</span>{" "}
                <button type="button" className="link" onClick={() => onGoTo(issue.step, issue.key)}>
                  Go to {stepLabel(issue.step)}
                </button>
                {issue.overridable && issue.severity === "error" && <>{" · "}<Allow issue={issue} onAllow={(note) => onAllow(issue.id, note)} /></>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(allowed.length > 0 || view.staleOverrides.length > 0) && (
        <section className="section" aria-labelledby="review-rulings">
          <h2 id="review-rulings">DM rulings</h2>
          <ul>
            {allowed.map((issue) => (
              <li key={issue.id}>
                Allowed: {issue.message} <span className="dim">“{issue.override!.note}” ({when(issue.override!.at)})</span>{" "}
                <button type="button" className="link" onClick={() => onDisallow(issue.id)}>Remove<span className="sr-only"> this ruling</span></button>
              </li>
            ))}
            {view.staleOverrides.map((id) => (
              <li key={id}>
                <span className="dim">A ruling for something that no longer arises ({id}).</span>{" "}
                <button type="button" className="link" onClick={() => onDisallow(id)}>Remove<span className="sr-only"> this ruling</span></button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.unused.length > 0 && (
        <section className="section" aria-labelledby="review-unused">
          <h2 id="review-unused">Choices left behind</h2>
          <p className="dim" style={{ marginTop: 6, fontSize: 14 }}>
            Picks from earlier choices that no longer apply. They're kept in case you switch back.
          </p>
          <ul>
            {view.unused.map((key) => <li key={key}><code>{key}</code></li>)}
          </ul>
          <button type="button" className="button" onClick={() => onClear(view.unused)}>Clear these</button>
        </section>
      )}

      {levelUp && (
        <section className="section" aria-labelledby="review-level">
          <h2 id="review-level">Level up</h2>
          {levelUp.ok ? (
            <>
              <p className="dim" style={{ marginTop: 6, fontSize: 14 }}>
                Adds a level and opens the step where you choose what comes with it.
              </p>
              <button type="button" className="button" style={{ marginTop: 8 }} onClick={onLevelUp}>{levelUp.label}</button>
            </>
          ) : (
            <p className="dim" style={{ marginTop: 6, fontSize: 14 }}>{levelUp.reason}</p>
          )}
        </section>
      )}

      <section className="section" aria-labelledby="review-file">
        <h2 id="review-file">A copy of your own</h2>
        <p className="dim" style={{ marginTop: 6, fontSize: 14 }}>
          The character is saved in this browser. Download a file to keep it safe, move it to another device, or share it.
        </p>
        <div className="banner-actions" style={{ marginTop: 8 }}>
          <button type="button" className="button" onClick={onDownload}>Download character file</button>
          {exports}
        </div>
      </section>
    </>
  );
}

export function Licences({ packs }: { packs: LoadedPack[] }) {
  return (
    <>
      <h1 tabIndex={-1}>Licences</h1>
      <p className="dim" style={{ marginTop: 4 }}>The app's own licence, the content it uses, and the credit each source asks for.</p>
      <section className="section">
        <h2>Adventurer Anvil</h2>
        <p style={{ fontSize: 14 }}>
          The app is free software under the GNU Affero General Public License, version 3 ({LICENCE_NAME}). Its source code
          is at <a href={SOURCE_URL} rel="noopener">{SOURCE_URL.replace(/^https:\/\//, "")}</a>.
        </p>
      </section>
      {packs.map((pack) => (
        <section key={pack.id} className="section">
          <h2>{pack.file.title}</h2>
          <p className="dim" style={{ fontSize: 14 }}>Pack {pack.id}, version {pack.version}</p>
          {pack.file.attribution ? <blockquote>{pack.file.attribution}</blockquote> : <p className="dim">No credit required.</p>}
        </section>
      ))}
    </>
  );
}
