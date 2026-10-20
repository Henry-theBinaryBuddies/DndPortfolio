import { useState } from "react";
import { downloadTextFile } from "../lib/download";
import { exportFileName, toJsonText } from "../lib/exportCommon";
import { buildMonsterFile } from "../lib/exportJson";
import { buildFiveToolsFile } from "../lib/fiveTools";
import { exportFoundryActor } from "../lib/foundry";
import { FOUNDRY_TARGET } from "../lib/foundryMaps";
import type { Monster } from "../types/monster";
import DropMenu from "./DropMenu";

// The export menu for one monster, and the help for importing what it makes. The handlers only build a file with the pure
// functions in lib/ and hand it to the browser; the decisions about what goes in a file live (and are tested) there.
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

  const exportFiveTools = () => {
    const { file, notes } = buildFiveToolsFile([monster], new Date().toISOString());
    const filename = exportFileName("5etools", monster.name);
    downloadTextFile(filename, toJsonText(file));
    setStatus(`Download started: ${filename}${notes.length > 0 ? ` Notes: ${notes.join(" ")}` : ""}`);
  };

  return (
    <>
      <DropMenu label={<>Export <span aria-hidden="true">▾</span></>} ariaLabel="Export" align="right">
        {(close) => (
          <ul className="dropmenu__items">
            {[
              ["JSON", exportJson],
              ["5etools", exportFiveTools],
              ["Foundry", exportFoundry],
            ].map(([name, run]) => (
              <li key={name as string}>
                <button
                  type="button"
                  className="dropmenu__item"
                  onClick={() => {
                    (run as () => void)();
                    close();
                  }}
                >
                  {name as string}
                </button>
              </li>
            ))}
          </ul>
        )}
      </DropMenu>
      <DropMenu
        label={<span aria-hidden="true">ⓘ</span>}
        ariaLabel="Importing into Foundry"
        buttonClassName="info-button"
        align="right"
        panelClassName="export-help"
      >
        <p>
          <strong>Foundry, from the Foundry file:</strong> the actor's own Import Data, not Plutonium's importer.
        </p>
        <ol>
          <li>In Foundry, create a blank NPC actor (Actors tab, Create Actor, type NPC).</li>
          <li>Right-click that actor in the Actors tab, choose Import Data, and pick the downloaded file.</li>
          <li>In the D&amp;D 5e system settings, set Rules Version to Legacy (2014).</li>
          <li>Spellcasting, Multiattack and Legendary Resistance come across as text only.</li>
          <li>Written for {FOUNDRY_TARGET.label}. The import has been confirmed in a live Foundry.</li>
        </ol>
        <p>
          <strong>5etools file:</strong> a homebrew file for Plutonium's importer in Foundry (Choose Importer, then the
          creature importer).
        </p>
      </DropMenu>
      {/* Always on the page (empty when idle), so a screen reader announces the text when it changes. */}
      <span role="status" className="detail-note export-status">
        {status}
      </span>
    </>
  );
}
