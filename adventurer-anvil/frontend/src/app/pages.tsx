// The Review and Licences pages: built from the core's evaluation and the loaded packs, so every system gets them.
import type { CharacterView } from "../core";
import type { LoadedPack } from "./packs";

export function Review({ view, stepLabel, onGoTo, onClear }: {
  view: CharacterView;
  stepLabel: (id: string) => string;
  onGoTo: (step: string, key?: string) => void;
  onClear: (keys: string[]) => void;
}) {
  const errors = view.issues.filter((i) => i.severity === "error");
  const warnings = view.issues.filter((i) => i.severity === "warning");
  const todo = view.steps.filter((s) => s.status !== "done");
  return (
    <>
      <h1 tabIndex={-1}>Review</h1>
      <p className="dim" style={{ marginTop: 4 }}>Everything still to settle before this character is finished.</p>

      <section className="section" aria-labelledby="review-steps">
        <h2 id="review-steps">Steps</h2>
        {todo.length === 0 ? (
          <p className="dim" style={{ marginTop: 6 }}>Every step is done.</p>
        ) : (
          <ul>
            {todo.map((s) => (
              <li key={s.id}>
                <button type="button" className="link" onClick={() => onGoTo(s.id)}>{s.label}</button>
                <span className="dim"> · {s.status === "problem" ? "has a problem" : "to do"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(errors.length > 0 || warnings.length > 0) && (
        <section className="section" aria-labelledby="review-issues">
          <h2 id="review-issues">Problems and notes</h2>
          <ul>
            {[...errors, ...warnings].map((issue) => (
              <li key={issue.id}>
                <span className={issue.severity === "error" ? "attention" : "dim"}>{issue.message}</span>
                {issue.override && <span className="dim"> Allowed: {issue.override.note}</span>}{" "}
                <button type="button" className="link" onClick={() => onGoTo(issue.step, issue.key)}>
                  Go to {stepLabel(issue.step)}
                </button>
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
    </>
  );
}

export function Licences({ packs }: { packs: LoadedPack[] }) {
  return (
    <>
      <h1 tabIndex={-1}>Licences</h1>
      <p className="dim" style={{ marginTop: 4 }}>The content this app uses, and the credit each source asks for.</p>
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
