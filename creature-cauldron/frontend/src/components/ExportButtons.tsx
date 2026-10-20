import { useState } from "react";
import { downloadTextFile } from "../lib/download";
import { exportFileName, toJsonText } from "../lib/exportCommon";
import { buildMonsterFile } from "../lib/exportJson";
import { exportFoundryActor } from "../lib/foundry";
import { FOUNDRY_TARGET } from "../lib/foundryMaps";
import type { Monster } from "../types/monster";

// The export buttons for one monster. The handlers only build a file with the pure functions in
// lib/ and hand it to the browser; the decisions about what goes in a file live (and are tested) there.
// The parent gives this component key={monster.id}, so its status text starts fresh for each monster.
export default function ExportButtons({ monster }: { monster: Monster }) {
  const [status, setStatus] = useState("");

  const exportJson = () => {
    const filename = exportFileName("monster", monster.name);
    downloadTextFile(filename, toJsonText(buildMonsterFile(monster, new Date().toISOString())));
    // "started", not "done": a blocked download, or a phone showing a preview first, cannot be detected.
    setStatus(`Download started: ${filename}`);
  };

  const exportFoundry = () => {
    const { actor, notes } = exportFoundryActor(monster);
    const filename = exportFileName(FOUNDRY_TARGET.filePrefix, monster.name);
    downloadTextFile(filename, toJsonText(actor));
    // Notes say what Foundry will show differently or what could not be converted.
    setStatus(`Download started: ${filename}${notes.length > 0 ? ` Notes: ${notes.join(" ")}` : ""}`);
  };

  return (
    <>
      <button type="button" className="action-button" onClick={exportJson}>
        Export JSON
      </button>
      <button type="button" className="action-button" onClick={exportFoundry}>
        Export for Foundry (experimental)
      </button>
      {/* Always on the page (empty when idle), so a screen reader announces the text when it changes. */}
      <span role="status" className="detail-note export-status">
        {status}
      </span>
      <details className="export-help">
        <summary>Importing into Foundry</summary>
        <ol>
          <li>In Foundry, create a blank NPC actor (Actors tab, Create Actor, type NPC).</li>
          <li>Right-click that actor in the Actors tab, choose Import Data, and pick the downloaded file.</li>
          <li>In the D&amp;D 5e system settings, set Rules Version to Legacy (2014).</li>
          <li>Spellcasting, Multiattack and Legendary Resistance come across as text only.</li>
          <li>
            Written for {FOUNDRY_TARGET.label} and checked against real SRD files, but not yet confirmed in a live
            game, so it is marked experimental.
          </li>
        </ol>
      </details>
    </>
  );
}
