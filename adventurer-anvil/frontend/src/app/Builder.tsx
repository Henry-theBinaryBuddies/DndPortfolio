// The builder: header, step list, the current step (or Review or Licences), the summary, and the footer.
// It asks the core for the whole picture on every change and calculates nothing itself, and saves as it goes.
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { NAME_KEY, rollSet, rollSets, viewCharacter, type CharacterDocument, type ChoiceSpec, type ContentIndex, type SystemModule } from "../core";
import { ChoiceView, choiceDomId, StepList } from "./choices";
import { downloadCharacter } from "./files";
import type { LoadedPack } from "./packs";
import { Licences, Review } from "./pages";
import { Sheet } from "./Sheet";
import { ExportButtons } from "./Exports";
import { reducer } from "./state";
import type { CharacterStore } from "./store";
import { Summary, type TodoItem } from "./Summary";
import { useAutosave, type SaveStatus } from "./useAutosave";

type Page = { kind: "step"; id: string } | { kind: "review" } | { kind: "sheet" } | { kind: "licences" };

/** Runs of choices sharing a group become one part, drawn together; every other choice is a part of its own. */
function groupChoices(specs: ChoiceSpec[]): { group?: string; specs: ChoiceSpec[] }[] {
  const parts: { group?: string; specs: ChoiceSpec[] }[] = [];
  for (const spec of specs) {
    const last = parts.at(-1);
    if (spec.group && last?.group === spec.group) last.specs.push(spec);
    else parts.push({ group: spec.group, specs: [spec] });
  }
  return parts;
}

const MARK = { done: "✓", todo: "○", problem: "!" } as const;
const MARK_TEXT = { done: "done", todo: "to do", problem: "has a problem" } as const;

/** "Saved 9:41 pm" today, "Saved 18 Nov" before. */
function savedText(at: Date): string {
  const today = at.toDateString() === new Date().toDateString();
  return `Saved ${today ? at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : at.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

function SaveState({ status }: { status: SaveStatus }) {
  switch (status.kind) {
    case "blank": return <span className="dim">Not saved yet</span>;
    case "saving": return <span className="dim">Saving…</span>;
    case "saved": return <span className="dim">{savedText(status.at)}</span>;
    case "full": return <span className="attention" role="alert">Not saved: browser storage is full. Download a copy from Review.</span>;
    case "failed": return <span className="attention" role="alert">Not saved: {status.message}</span>;
  }
}

/** The character the builder opens with: a new one, or one opened from storage or a file (and anything to note), and the step to show first. */
export interface Opening {
  doc: CharacterDocument;
  saved: boolean;
  notes: string[];
  step?: string;
  /** Open on the sheet rather than a step. */
  sheet?: boolean;
}

export function Builder({ system, packs, content, store, opening, onLeave, focusHeading }: {
  system: SystemModule;
  packs: LoadedPack[];
  content: ContentIndex;
  store: CharacterStore;
  opening: Opening;
  /** Back to the list of characters (after any waiting change is saved). */
  onLeave: () => void;
  focusHeading: boolean;
}) {
  const [doc, dispatch] = useReducer(reducer, opening.doc);
  const save = useAutosave({ doc, store, system, content, startSaved: opening.saved, onReplace: (d) => dispatch({ type: "replace", doc: d }) });
  const [notes, setNotes] = useState(opening.notes);
  const view = useMemo(() => viewCharacter(system, doc, content), [system, doc, content]);
  // Open at the step asked for, else the first that still needs something (a new character skips steps already done, such as rules with defaults).
  const [page, setPage] = useState<Page>(() => opening.sheet && system.sheet ? { kind: "sheet" } : ({
    kind: "step",
    id: (opening.step && view.steps.some((s) => s.id === opening.step) ? opening.step : (view.steps.find((s) => s.status !== "done") ?? view.steps[0])?.id) ?? "review",
  }));
  const levelUp = useMemo(() => system.levelUp?.(doc, content), [system, doc, content]);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const focusTarget = useRef<string | null>(null);

  const stepLabel = (id: string) => view.steps.find((s) => s.id === id)?.label ?? id;
  const order: Page[] = [...view.steps.map((s): Page => ({ kind: "step", id: s.id })), { kind: "review" }, ...(system.sheet ? [{ kind: "sheet" } as Page] : [])];
  const at = order.findIndex((p) => p.kind === page.kind && (p.kind !== "step" || (page.kind === "step" && p.id === page.id)));
  const pageName = (p: Page) => (p.kind === "step" ? stepLabel(p.id) : p.kind === "review" ? "Review" : p.kind === "sheet" ? "Sheet" : "Licences");

  // Dice are rolled here, in the click, and the results logged: never inside the reducer, which React may run twice.
  const roll = (spec: ChoiceSpec) => {
    if (!spec.dice) return;
    const rolls = rollSet({ expression: spec.dice, times: spec.times ?? 1, for: spec.key, now: new Date().toISOString(), newId: () => crypto.randomUUID() });
    dispatch({ type: "rolls", rolls });
  };

  const goTo = (step: string, key?: string) => {
    focusTarget.current = key ? choiceDomId(key) : null;
    setPage(step === "review" ? { kind: "review" } : { kind: "step", id: step });
  };

  // After a page change, move focus to the choice asked for, or to the page's heading (for screen readers).
  // Only when the page really changed: on first load focus starts at the top, where the skip link is.
  // (Comparing with the page last shown, rather than a "first time" flag, also holds when React runs effects twice.)
  const shownPage = useRef(page);
  useEffect(() => { if (focusHeading) document.querySelector<HTMLElement>("#main h1")?.focus(); }, []);
  useEffect(() => {
    if (shownPage.current === page) return;
    shownPage.current = page;
    const target = focusTarget.current ? document.getElementById(focusTarget.current) : document.querySelector<HTMLElement>("#main h1");
    focusTarget.current = null;
    target?.focus();
    if (target && "scrollIntoView" in target) target.scrollIntoView({ block: "nearest" });
  }, [page]);

  const todo: TodoItem[] = [];
  for (const step of view.steps) {
    for (const spec of step.choices) {
      const empty = spec.options !== undefined && spec.options.length === 0;
      if (spec.required && !(spec.answered ?? doc.choices[spec.key] !== undefined) && !empty) {
        todo.push({ label: spec.label, step: step.id, stepLabel: step.label, key: spec.key });
      }
    }
  }
  for (const issue of view.issues) {
    if (issue.severity === "error" && !issue.override) todo.push({ label: issue.message, step: issue.step, stepLabel: stepLabel(issue.step), key: issue.key });
  }

  const step = page.kind === "step" ? view.steps.find((s) => s.id === page.id) : undefined;
  const prev = at > 0 ? order[at - 1] : undefined;
  const next = at >= 0 && at < order.length - 1 ? order[at + 1] : undefined;
  const go = (p: Page) => setPage(p);
  const attributions = [...new Set(packs.map((p) => p.file.attribution).filter((a): a is string => Boolean(a)))];

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to the step</a>
      <header className="top">
        <span className="brand">Adventurer Anvil</span>
        <div className="who">
          <button type="button" className="button small" onClick={() => void save.flush().then(onLeave)}>Characters</button>
          <span className="name">{doc.name || "New character"}</span>
          <SaveState status={save.status} />
        </div>
      </header>

      <div className="layout">
        <nav className="rail" aria-label="Steps">
          <span className="label" style={{ padding: "0 14px" }}>Steps</span>
          <ol>
            {view.steps.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  aria-label={`${s.label}, ${MARK_TEXT[s.status]}`}
                  aria-current={page.kind === "step" && page.id === s.id ? "step" : undefined}
                  onClick={() => go({ kind: "step", id: s.id })}
                >
                  <span className={`mark ${s.status}`} aria-hidden="true">{MARK[s.status]}</span>
                  {s.label}
                </button>
              </li>
            ))}
            <li className="divider" aria-hidden="true" />
            <li>
              <button type="button" aria-current={page.kind === "review" ? "step" : undefined} onClick={() => go({ kind: "review" })}>
                <span className="mark" aria-hidden="true">≡</span>Review
              </button>
            </li>
            {system.sheet && (
              <li>
                <button type="button" aria-current={page.kind === "sheet" ? "step" : undefined} onClick={() => go({ kind: "sheet" })}>
                  <span className="mark" aria-hidden="true">▤</span>Sheet
                </button>
              </li>
            )}
          </ol>
        </nav>

        <main className="page" id="main">
          {save.elsewhere && (
            <div className="notice banner" role="alert">
              <p>{save.elsewhere === "changed" ? "This character was changed in another tab." : "This character was deleted in another tab."} Saving here is paused.</p>
              <p className="banner-actions">
                {save.elsewhere === "changed" && <button type="button" className="button small primary" onClick={() => void save.reload()}>Reload it</button>}
                <button type="button" className="button small" onClick={save.keepMine}>{save.elsewhere === "changed" ? "Keep this tab's version" : "Save it again"}</button>
              </p>
            </div>
          )}
          {notes.length > 0 && (
            <div className="notice banner">
              <ul>{notes.map((n) => <li key={n}>{n}</li>)}</ul>
              <p className="banner-actions"><button type="button" className="button small" onClick={() => setNotes([])}>Dismiss</button></p>
            </div>
          )}
          {page.kind === "step" && step && (
            <>
              <p className="mobile-step">
                <span>Step {at + 1} of {order.length} · {step.label}</span>
              </p>
              <h1 tabIndex={-1} style={{ marginBottom: 14 }}>{step.label}</h1>
              {view.issues.filter((i) => i.step === step.id && !i.key).map((i) => (
                <p key={i.id} className={`issue ${i.severity}`}>{i.message}</p>
              ))}
              {groupChoices(step.choices).map((part) => {
                const one = (spec: ChoiceSpec) => (
                  <ChoiceView
                    key={spec.key}
                    spec={spec}
                    value={spec.key === NAME_KEY ? doc.name : (doc.choices[spec.key] ?? spec.defaultValue)}
                    issues={view.issues.filter((i) => i.key === spec.key && !i.id.startsWith("no-options:"))}
                    onChange={(value) => dispatch({ type: "set", key: spec.key, value })}
                    derived={view.derived}
                    rollSets={spec.kind === "roll" ? rollSets(doc, spec.key) : []}
                    onRoll={roll}
                  />
                );
                if (!part.group) return one(part.specs[0]);
                return (
                  <fieldset key={`group-${part.specs[0].key}`} className="choice">
                    <legend>{part.group}</legend>
                    {part.specs[0].source && part.specs.some((s) => s.suggestions?.length) && (
                      <p className="meta">Suggestions from {part.specs.find((s) => s.suggestions?.length)!.source}</p>
                    )}
                    <div className="choice-grid">{part.specs.map(one)}</div>
                  </fieldset>
                );
              })}
              {step.choices.length === 0 && !view.issues.some((i) => i.step === step.id) && (
                <p className="notice">Nothing to choose here yet: earlier steps decide what appears.</p>
              )}
              {(system.stepLists?.[step.id] ?? []).map((l) => (
                <StepList key={l.list} label={l.label} items={view.lists[l.list] ?? []} />
              ))}
            </>
          )}
          {page.kind === "review" && (
            <Review
              view={view}
              doc={doc}
              stepLabel={stepLabel}
              onGoTo={goTo}
              onClear={(keys) => dispatch({ type: "clear", keys })}
              onAllow={(issueId, note) => dispatch({ type: "allow", issueId, note })}
              onDisallow={(issueId) => dispatch({ type: "disallow", issueId })}
              onDownload={() => downloadCharacter(doc)}
              levelUp={levelUp}
              exports={<ExportButtons system={system} content={content} getDoc={() => doc} />}
              onLevelUp={() => {
                if (!levelUp?.ok) return;
                dispatch({ type: "set-many", choices: levelUp.choices });
                goTo(levelUp.step);
              }}
            />
          )}
          {page.kind === "sheet" && (
            <Sheet system={system} view={view} doc={doc} content={content} attributions={attributions} onReview={() => go({ kind: "review" })}
              exports={<ExportButtons system={system} content={content} getDoc={() => doc} />} />
          )}
          {page.kind === "licences" && <Licences packs={packs} />}

          <div className="nav">
            {prev && <button type="button" className="button" onClick={() => go(prev)}>Back</button>}
            {next && <button type="button" className="button primary" onClick={() => go(next)}>Next: {pageName(next)}</button>}
          </div>
        </main>

        <aside className={`side${summaryOpen ? "" : " collapsed"}`} aria-label="Character summary">
          <p className="mobile-step">
            <span className="dim">{doc.name || "New character"}</span>
            <button type="button" className="link mobile-summary-toggle" aria-expanded={summaryOpen} onClick={() => setSummaryOpen(!summaryOpen)}>
              {summaryOpen ? "Hide summary" : "Show summary"}
            </button>
          </p>
          <Summary layout={system.summary} view={view} todo={todo} onGoTo={(item) => goTo(item.step, item.key)} />
        </aside>
      </div>

      <footer className="foot">
        {attributions.map((a) => <span key={a}>{a}</span>)}
        <button type="button" className="link" onClick={() => go({ kind: "licences" })}>Licences</button>
      </footer>

      <div className="mobile-bar">
        {prev ? <button type="button" className="button" onClick={() => go(prev)}>Back</button> : <span style={{ flex: 1 }} />}
        {next && <button type="button" className="button primary" onClick={() => go(next)}>Next: {pageName(next)}</button>}
      </div>
    </div>
  );
}
