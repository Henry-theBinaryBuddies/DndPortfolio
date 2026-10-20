import { useState } from "react";
import { downloadTextFile } from "../lib/download";
import { exportFileName, toJsonText } from "../lib/exportCommon";
import { buildMonsterFile } from "../lib/exportJson";
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

  return (
    <>
      <button type="button" className="action-button" onClick={exportJson}>
        Export JSON
      </button>
      {/* Always on the page (empty when idle), so a screen reader announces the text when it changes. */}
      <span role="status" className="detail-note">
        {status}
      </span>
    </>
  );
}
