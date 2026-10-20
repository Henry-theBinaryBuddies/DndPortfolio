import { useState } from "react";
import { damageDealtBy } from "../lib/demoGenerator";
import { OFFLINE_MESSAGE, RESTING_MESSAGE, type Generator, type ReskinRequest } from "../lib/generatorApi";
import { DAMAGE_THEMES, DAMAGE_TYPES, label, type DamageTheme, type DamageType } from "../lib/options";
import { MOVE_GROUPS, SURPRISE, movesFor } from "../lib/remixMoves";
import type { Monster } from "../types/monster";

interface ReskinPanelProps {
  monster: Monster;
  mode: Generator["mode"];
  /** True when the server says its daily allowance is used up. */
  resting?: boolean;
  /** Makes the reskin. Resolves to null on success, or to the message to show when it failed. */
  onReskin: (request: ReskinRequest) => Promise<string | null>;
}

type Kind = "quick" | "remix";

// The Reskin button plus its small panel. Both sit in the stat block's button row; the panel takes a full row.
// Quick reskin swaps one damage type. Remix gives the monster a new theme and/or a signature move; either may be left to
// the server with "Surprise me". Both can also level the monster up. The parent gives this component a key of the monster's
// id, so its choices reset when another monster opens.
export default function ReskinPanel({ monster, mode, resting = false, onReskin }: ReskinPanelProps) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("quick");
  const [from, setFrom] = useState<DamageType | "">("");
  const [to, setTo] = useState<DamageType | "">("");
  const [theme, setTheme] = useState<DamageTheme | typeof SURPRISE | "">("");
  const [move, setMove] = useState("");
  const [levelUp, setLevelUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const offline = mode === "offline";
  const hasSwap = from !== "" && to !== "";
  const hasRemix = theme !== "" || move !== "";
  const hasChange = (kind === "quick" ? hasSwap : hasRemix) || levelUp;
  const blocked = offline || resting || busy || !hasChange;
  const moves = movesFor(monster);

  function request(): ReskinRequest {
    if (kind === "quick") return { base: monster, damageSwap: hasSwap ? { from: from as DamageType, to: to as DamageType } : null, levelUp };
    return { base: monster, damageSwap: null, theme: theme === "" ? null : theme, move: move === "" ? null : move, levelUp };
  }

  async function make() {
    if (blocked) return;
    setBusy(true);
    setMessage("");
    const failure = await onReskin(request());
    setBusy(false);
    if (failure) setMessage(failure);
  }

  const hint = kind === "quick" ? "Pick a damage swap, level up, or both." : "Pick a theme, a signature move, level up, or any mix.";
  const surprising = theme === SURPRISE || move === SURPRISE;

  return (
    <>
      <button type="button" className="action-button" aria-expanded={open} aria-controls="reskin-panel" onClick={() => setOpen(!open)}>
        Reskin
      </button>
      {open && (
        <div id="reskin-panel" className="reskin-panel">
          <fieldset className="reskin-kind">
            <legend className="sr-only">Kind of reskin</legend>
            <label>
              <input type="radio" name="reskin-kind" checked={kind === "quick"} onChange={() => setKind("quick")} /> Quick reskin
            </label>
            <label>
              <input type="radio" name="reskin-kind" checked={kind === "remix"} onChange={() => setKind("remix")} /> Remix
            </label>
          </fieldset>

          {kind === "quick" ? (
            <>
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
            </>
          ) : (
            <>
              <label>
                New damage theme{" "}
                <select value={theme} onChange={(e) => setTheme(e.target.value as DamageTheme | typeof SURPRISE | "")}>
                  <option value="">Leave as is</option>
                  <option value={SURPRISE}>Surprise me</option>
                  {DAMAGE_THEMES.map((t) => (
                    <option key={t} value={t}>
                      {label(t)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Signature move{" "}
                <select value={move} onChange={(e) => setMove(e.target.value)}>
                  <option value="">None</option>
                  <option value={SURPRISE}>Surprise me</option>
                  {MOVE_GROUPS.map((group) => {
                    const inGroup = moves.filter((m) => m.group === group);
                    return inGroup.length === 0 ? null : (
                      <optgroup key={group} label={group}>
                        {inGroup.map((m) => (
                          <option key={m.key} value={m.key} title={m.blurb}>
                            {m.label}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </label>
              {moves.find((m) => m.key === move) && <p className="detail-note">{moves.find((m) => m.key === move)?.blurb}</p>}
            </>
          )}

          <label>
            <input type="checkbox" checked={levelUp} onChange={(e) => setLevelUp(e.target.checked)} /> Level up (about +1 CR)
          </label>
          <button type="button" className="action-button" aria-disabled={blocked} aria-describedby="reskin-status" onClick={make}>
            {kind === "remix" ? "Make remix" : "Make reskin"}
          </button>
          <p id="reskin-status" role="status" className="detail-note">
            {busy
              ? "Reskinning…"
              : offline
                ? OFFLINE_MESSAGE
                : resting
                  ? RESTING_MESSAGE
                  : message || (!hasChange ? hint : surprising ? "Surprise choices are made fresh each time, so they are not reused." : "")}
          </p>
        </div>
      )}
    </>
  );
}
