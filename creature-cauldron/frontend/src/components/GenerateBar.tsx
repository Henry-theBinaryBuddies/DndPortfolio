import { OFFLINE_MESSAGE, type Generator } from "../lib/generatorApi";

interface GenerateBarProps {
  /** A prompt about a short list ("Only 1 match."), or null when the list is long enough. */
  prompt: string | null;
  /** What pressing the button would ask for, in plain words. Null when the choices cannot be requested. */
  summary: string | null;
  /** Why the choices cannot be requested, when they can't. */
  problem: string | null;
  mode: Generator["mode"];
  busy: boolean;
  /** The outcome of the last attempt. */
  message: string;
  /** True once something has been generated, so the button offers another. */
  hasResult: boolean;
  onGenerate: () => void;
}

export default function GenerateBar({ prompt, summary, problem, mode, busy, message, hasResult, onGenerate }: GenerateBarProps) {
  const offline = mode === "offline";
  const blocked = offline || busy || problem !== null;
  // Always rendered, so a screen reader notices when its text changes.
  const status = busy ? "Generating…" : offline ? OFFLINE_MESSAGE : message;

  return (
    <div className="generate-bar">
      {prompt && <p className="generate-prompt">{prompt}</p>}
      <p className="detail-note">{problem ?? (summary ? `Would request: ${summary}` : "")}</p>
      {/* aria-disabled, not disabled, so the button keeps keyboard focus while it waits or is unavailable. */}
      <button
        type="button"
        className="action-button"
        aria-disabled={blocked}
        aria-describedby="generate-status"
        onClick={() => {
          if (!blocked) onGenerate();
        }}
      >
        {hasResult ? "Generate another" : "Generate a monster"}
      </button>
      <p id="generate-status" role="status" className="detail-note">
        {status}
      </p>
    </div>
  );
}
