import { useState } from "react";
import { damageDealtBy } from "../lib/demoGenerator";
import { OFFLINE_MESSAGE, RESTING_MESSAGE, type Generator, type ReskinRequest } from "../lib/generatorApi";
import { DAMAGE_TYPES, label, type DamageType } from "../lib/options";
import type { Monster } from "../types/monster";

interface ReskinPanelProps {
  monster: Monster;
  mode: Generator["mode"];
  /** True when the server says its daily allowance is used up. */
  resting?: boolean;
  /** Makes the reskin. Resolves to null on success, or to the message to show when it failed. */
  onReskin: (request: ReskinRequest) => Promise<string | null>;
}

// The Reskin button plus its small panel. Both sit in the stat block's button row; the panel takes a full row.
// The parent gives this component a key of the monster's id, so its choices reset when another monster opens.
export default function ReskinPanel({ monster, mode, resting = false, onReskin }: ReskinPanelProps) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<DamageType | "">("");
  const [to, setTo] = useState<DamageType | "">("");
  const [elite, setElite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const offline = mode === "offline";
  const hasSwap = from !== "" && to !== "";
  const blocked = offline || resting || busy || !(hasSwap || elite);

  async function make() {
    if (blocked) return;
    setBusy(true);
    setMessage("");
    const failure = await onReskin({
      base: monster,
      damageSwap: from !== "" && to !== "" ? { from, to } : null,
      template: elite ? "elite" : null,
    });
    setBusy(false);
    if (failure) setMessage(failure);
  }

  return (
    <>
      <button type="button" className="action-button" aria-expanded={open} aria-controls="reskin-panel" onClick={() => setOpen(!open)}>
        Reskin
      </button>
      {open && (
        <div id="reskin-panel" className="reskin-panel">
          <label>
            Change damage type{" "}
            <select
              value={from}
              onChange={(e) => {
                setFrom(e.target.value as DamageType | "");
                setTo("");
              }}
            >
              <option value="">Leave as is</option>
              {damageDealtBy(monster).map((t) => (
                <option key={t} value={t}>
                  {label(t)}
                </option>
              ))}
            </select>
          </label>
          {from !== "" && (
            <label>
              to{" "}
              <select value={to} onChange={(e) => setTo(e.target.value as DamageType | "")}>
                <option value="">Choose…</option>
                {DAMAGE_TYPES.filter((t) => t !== from).map((t) => (
                  <option key={t} value={t}>
                    {label(t)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <input type="checkbox" checked={elite} onChange={(e) => setElite(e.target.checked)} /> Elite version
          </label>
          <button type="button" className="action-button" aria-disabled={blocked} aria-describedby="reskin-status" onClick={make}>
            Make reskin
          </button>
          <p id="reskin-status" role="status" className="detail-note">
            {busy ? "Reskinning…" : offline ? OFFLINE_MESSAGE : resting ? RESTING_MESSAGE : message || (!(hasSwap || elite) ? "Pick a damage swap, the elite version, or both." : "")}
          </p>
        </div>
      )}
    </>
  );
}
