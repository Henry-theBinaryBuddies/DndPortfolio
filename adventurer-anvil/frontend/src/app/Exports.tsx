// A button for each of the system's exporters (SystemModule.exporters): it builds the file and downloads it, or first
// shows what the exporter wants the person to know (an unfinished character), with "Download anyway".
import { useState } from "react";
import type { CharacterDocument, ContentIndex, Exporter, SystemModule } from "../core";
import { downloadText } from "./files";

type Built = ReturnType<Exporter["build"]>;

export function ExportButtons({ system, content, getDoc, small = false, nameForScreenReaders }: {
  system: SystemModule;
  content: ContentIndex;
  /** The character to export (from memory, or loaded from storage); null if it couldn't be read. */
  getDoc: () => CharacterDocument | null | Promise<CharacterDocument | null>;
  small?: boolean;
  /** Added for screen readers when several characters' buttons share a page ("Export for Tome & Tile Borin"). */
  nameForScreenReaders?: string;
}) {
  const [pending, setPending] = useState<{ label: string; built: Built } | null>(null);
  const exporters = system.exporters ?? [];
  if (!exporters.length) return null;

  const run = async (exporter: Exporter) => {
    const doc = await getDoc();
    if (!doc) return;
    const built = exporter.build(doc, content);
    if (built.warnings.length) setPending({ label: exporter.label, built });
    else downloadText(built.fileName, built.mediaType, built.text);
  };

  return (
    <>
      {exporters.map((e) => (
        <button key={e.id} type="button" className={`button${small ? " small" : ""}`} onClick={() => void run(e)}>
          {e.label}{nameForScreenReaders && <span className="sr-only"> {nameForScreenReaders}</span>}
        </button>
      ))}
      {pending && (
        <div className="notice export-warning" role="alert">
          <p>Before you {pending.label.charAt(0).toLowerCase() + pending.label.slice(1)}:</p>
          <ul>{pending.built.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          <p className="banner-actions">
            <button type="button" className="button small primary" onClick={() => { downloadText(pending.built.fileName, pending.built.mediaType, pending.built.text); setPending(null); }}>
              Download anyway
            </button>
            <button type="button" className="button small" onClick={() => setPending(null)}>Cancel</button>
          </p>
        </div>
      )}
    </>
  );
}
