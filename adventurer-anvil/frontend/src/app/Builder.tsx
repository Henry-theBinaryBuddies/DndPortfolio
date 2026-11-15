// The builder: header, step list, the current step (or Review or Licences), the summary, and the footer.
// It asks the core for the whole picture on every change and calculates nothing itself.
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createContentIndex, rollSet, rollSets, viewCharacter, type ChoiceSpec, type SystemModule } from "../core";
import { ChoiceView, choiceDomId, StepList } from "./choices";
import type { LoadedPack } from "./packs";
import { Licences, Review } from "./pages";
import { freshCharacter, reducer } from "./state";
import { Summary, type TodoItem } from "./Summary";

type Page = { kind: "step"; id: string } | { kind: "review" } | { kind: "licences" };

const MARK = { done: "✓", todo: "○", problem: "!" } as const;
const MARK_TEXT = { done: "done", todo: "to do", problem: "has a problem" } as const;

export function Builder({ system, packs }: { system: SystemModule; packs: LoadedPack[] }) {
  const [doc, dispatch] = useReducer(reducer, undefined, () => freshCharacter(system, packs));
  const content = useMemo(() => createContentIndex(packs), [packs]);
  const view = useMemo(() => viewCharacter(system, doc, content), [system, doc, content]);
  const [page, setPage] = useState<Page>(() => ({ kind: "step", id: view.steps[0]?.id ?? "review" }));
  const [summaryOpen, setSummaryOpen] = useState(false);
  const focusTarget = useRef<string | null>(null);

  const stepLabel = (id: string) => view.steps.find((s) => s.id === id)?.label ?? id;
  const order: Page[] = [...view.steps.map((s): Page => ({ kind: "step", id: s.id })), { kind: "review" }];
  const at = order.findIndex((p) => p.kind === page.kind && (p.kind !== "step" || (page.kind === "step" && p.id === page.id)));
  const pageName = (p: Page) => (p.kind === "step" ? stepLabel(p.id) : p.kind === "review" ? "Review" : "Licences");

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
          <span className="name">{doc.name || "New character"}</span>
          <span className="dim">Not saved yet</span>
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
          </ol>
        </nav>

        <main className="page" id="main">
          {page.kind === "step" && step && (
            <>
              <p className="mobile-step">
                <span>Step {at + 1} of {order.length} · {step.label}</span>
              </p>
              <h1 tabIndex={-1} style={{ marginBottom: 14 }}>{step.label}</h1>
              {view.issues.filter((i) => i.step === step.id && !i.key).map((i) => (
                <p key={i.id} className={`issue ${i.severity}`}>{i.message}</p>
              ))}
              {step.choices.map((spec) => (
                <ChoiceView
                  key={spec.key}
                  spec={spec}
                  value={doc.choices[spec.key]}
                  issues={view.issues.filter((i) => i.key === spec.key && !i.id.startsWith("no-options:"))}
                  onChange={(value) => dispatch({ type: "set", key: spec.key, value })}
                  derived={view.derived}
                  rollSets={spec.kind === "roll" ? rollSets(doc, spec.key) : []}
                  onRoll={roll}
                />
              ))}
              {step.choices.length === 0 && !view.issues.some((i) => i.step === step.id) && (
                <p className="notice">Nothing to choose here yet: earlier steps decide what appears.</p>
              )}
              {(system.stepLists?.[step.id] ?? []).map((l) => (
                <StepList key={l.list} label={l.label} items={view.lists[l.list] ?? []} />
              ))}
            </>
          )}
          {page.kind === "review" && (
            <Review view={view} stepLabel={stepLabel} onGoTo={goTo} onClear={(keys) => dispatch({ type: "clear", keys })} />
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
