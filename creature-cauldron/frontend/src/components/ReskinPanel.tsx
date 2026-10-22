import { useState } from "react";
import { OFFLINE_MESSAGE, RESTING_MESSAGE, type Generator, type ReskinRequest } from "../lib/generatorApi";
import { DAMAGE_THEMES, label, type DamageTheme } from "../lib/options";
import { MOVE_GROUPS, SURPRISE, movesFor } from "../lib/remixMoves";
import DropMenu from "./DropMenu";
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
// Reflavor is one click: a new name, description and ability names, no number changed. Remix gives the monster a new theme
// (optionally changing only the damage, not its defences) and/or a signature move; either may be left to the server with
// "Surprise me". A remix can also level the monster up. The parent gives this component a key of the monster's id, so its
// choices reset when another monster opens.
export default function ReskinPanel({ monster, mode, resting = false, onReskin }: ReskinPanelProps) {
  const [theme, setTheme] = useState<DamageTheme | typeof SURPRISE | "">("");
  const [damageOnly, setDamageOnly] = useState(false);
  const [move, setMove] = useState("");
  const [levelUp, setLevelUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const offline = mode === "offline";
  const hasChange = theme !== "" || move !== "" || levelUp;
  const unavailable = offline || resting || busy;
  const blocked = unavailable || !hasChange;
  const moves = movesFor(monster);

  async function run(asked: ReskinRequest) {
    setBusy(true);
    setMessage("");
    const failure = await onReskin(asked);
    setBusy(false);
    if (failure) setMessage(failure);
  }

  const reflavor = () => !unavailable && run({ base: monster, reflavor: true });
  const remix = () =>
    !blocked && run({ base: monster, theme: theme === "" ? null : theme, damageOnly: theme !== "" && damageOnly, move: move === "" ? null : move, levelUp });

  const surprising = theme === SURPRISE || move === SURPRISE;

  return (
    <DropMenu label="Reskin" ariaLabel="Reskin" align="right" keepMounted closeOnOutside={false} panelClassName="reskin-panel">
      <button type="button" className="action-button" aria-disabled={unavailable} aria-describedby="reskin-status" onClick={reflavor}>
        Reflavor
      </button>
      <p className="detail-note">New name, description and ability names. Numbers stay the same.</p>
      <hr />

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
      {theme !== "" && (
        <label>
          <input type="checkbox" checked={damageOnly} onChange={(e) => setDamageOnly(e.target.checked)} /> Only change the damage; leave its resistances and
          immunities
        </label>
      )}
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

      <label>
        <input type="checkbox" checked={levelUp} onChange={(e) => setLevelUp(e.target.checked)} /> Level up (about +1 CR)
      </label>
      <button type="button" className="action-button" aria-disabled={blocked} aria-describedby="reskin-status" onClick={remix}>
        Make remix
      </button>
      <p id="reskin-status" role="status" className="detail-note">
        {busy
          ? "Reskinning…"
          : offline
            ? OFFLINE_MESSAGE
            : resting
              ? RESTING_MESSAGE
              : message || (!hasChange ? "Pick a theme, a signature move, level up, or any mix." : surprising ? "Surprise choices are made fresh each time, so they are not reused." : "")}
      </p>
    </DropMenu>
  );
}
