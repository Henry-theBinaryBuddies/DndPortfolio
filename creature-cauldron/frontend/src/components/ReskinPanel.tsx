import { useEffect, useMemo, useRef, useState } from "react";
import { OFFLINE_MESSAGE, RESTING_MESSAGE, type BorrowKind, type BorrowOption, type Generator, type ReskinRequest } from "../lib/generatorApi";
import { DAMAGE_THEMES, label, type DamageTheme } from "../lib/options";
import { MOVE_GROUPS, SURPRISE, movesFor } from "../lib/remixMoves";
import DropMenu from "./DropMenu";
import type { Monster } from "../types/monster";

interface ReskinPanelProps {
  monster: Monster;
  mode: Generator["mode"];
  /** True when the server says its daily allowance is used up. */
  resting?: boolean;
  /** Every monster the page knows: the choices for a polymorph donor. */
  donors?: Monster[];
  /** Asks what a donor could lend this monster. */
  graftOptions?: Generator["graftOptions"];
  /** Makes the reskin. Resolves to null on success, or to the message to show when it failed. */
  onReskin: (request: ReskinRequest) => Promise<string | null>;
}

type Kind = "remix" | "polymorph";

const MAX_BORROW = 10; // the server's limit on what one polymorph may borrow
const KIND_HEADINGS: [BorrowKind, string][] = [
  ["damage", "Damage"],
  ["movement", "Movement"],
  ["sense", "Senses"],
  ["trait", "Traits"],
  ["attack", "Attacks"],
];

// The Reskin button plus its small panel. Both sit in the stat block's button row; the panel takes a full row.
// Reflavor is one click: a new name, description and ability names, no number changed. Remix gives the monster a new theme
// (optionally changing only the damage, not its defences) and/or a signature move; either may be left to the server with
// "Surprise me". Polymorph borrows chosen features from a second creature (or lets the forge choose). Remix and polymorph can
// also level the monster up. The parent gives this component a key of the monster's id, so its choices reset when another
// monster opens.
export default function ReskinPanel({ monster, mode, resting = false, donors = [], graftOptions, onReskin }: ReskinPanelProps) {
  const [kind, setKind] = useState<Kind>("remix");
  const [theme, setTheme] = useState<DamageTheme | typeof SURPRISE | "">("");
  const [damageOnly, setDamageOnly] = useState(false);
  const [move, setMove] = useState("");
  const [levelUp, setLevelUp] = useState(false);
  const [donorName, setDonorName] = useState("");
  const [options, setOptions] = useState<BorrowOption[] | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const [forgeChooses, setForgeChooses] = useState(false);
  const [legendary, setLegendary] = useState(false);
  const [optionsMessage, setOptionsMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const offline = mode === "offline";
  const hasLegendary = monster.legendary_actions != null;
  const unavailable = offline || resting || busy;
  const moves = movesFor(monster);

  // The donors on offer: every other creature, once per name (generated monsters can share a name, and the box picks by name).
  const choices = useMemo(() => {
    const byName = new Map<string, Monster>();
    for (const d of donors) if (d.id !== monster.id && !byName.has(d.name.toLowerCase())) byName.set(d.name.toLowerCase(), d);
    return [...byName.values()];
  }, [donors, monster.id]);
  // The donor is whichever creature the typed name matches exactly (the list below the box offers the names).
  const donor = choices.find((d) => d.name.toLowerCase() === donorName.trim().toLowerCase()) ?? null;
  const donorId = donor?.id ?? null;
  const asked = useRef(0);
  useEffect(() => {
    const turn = ++asked.current;
    setOptions(null);
    setTicked([]);
    setForgeChooses(false);
    setLegendary(false);
    setOptionsMessage("");
    if (donorId === null || graftOptions === undefined) return;
    void graftOptions(monster.id, donorId).then((result) => {
      if (turn !== asked.current) return; // a newer donor was chosen while this answer was on its way
      if (result.ok) {
        setOptions(result.options);
        if (result.options.length === 0) setOptionsMessage("That creature has nothing this one could borrow.");
      } else setOptionsMessage(result.message);
    });
  }, [donorId, monster.id, graftOptions]);

  const hasRemix = theme !== "" || move !== "" || levelUp;
  const hasPolymorph = donor !== null && options !== null && options.length > 0 && (forgeChooses || ticked.length > 0);
  const blocked = unavailable || !(kind === "remix" ? hasRemix : hasPolymorph);

  async function run(request: ReskinRequest) {
    setBusy(true);
    setMessage("");
    const failure = await onReskin(request);
    setBusy(false);
    if (failure) setMessage(failure);
  }

  const reflavor = () => !unavailable && run({ base: monster, reflavor: true });
  const make = () => {
    if (blocked) return;
    if (kind === "remix") {
      void run({ base: monster, theme: theme === "" ? null : theme, damageOnly: theme !== "" && damageOnly, move: move === "" ? null : move, levelUp });
    } else if (donor) {
      void run({ base: monster, donorId: donor.id, borrow: forgeChooses ? [] : ticked, forgeChooses, levelUp, legendary });
    }
  };
  const toggleTick = (key: string) => setTicked(ticked.includes(key) ? ticked.filter((k) => k !== key) : [...ticked, key]);

  const surprising = kind === "remix" && (theme === SURPRISE || move === SURPRISE);
  const hint =
    kind === "remix"
      ? "Pick a theme, a signature move, level up, or any mix."
      : donor === null
        ? "Choose a creature to borrow from."
        : "Tick what to borrow, or let the forge choose.";

  return (
    <DropMenu label="Reskin" ariaLabel="Reskin" align="right" keepMounted closeOnOutside={false} panelClassName="reskin-panel">
      <button type="button" className="action-button" aria-disabled={unavailable} aria-describedby="reskin-status" onClick={reflavor}>
        Reflavor
      </button>
      <p className="detail-note">New name, description and ability names. Numbers stay the same.</p>
      <hr />
      <fieldset className="reskin-kind">
        <legend className="sr-only">Kind of reskin</legend>
        <label>
          <input type="radio" name="reskin-kind" checked={kind === "remix"} onChange={() => setKind("remix")} /> Remix
        </label>
        <label>
          <input type="radio" name="reskin-kind" checked={kind === "polymorph"} onChange={() => setKind("polymorph")} /> Polymorph
        </label>
      </fieldset>

      {kind === "remix" ? (
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
          {theme !== "" && (
            <label>
              <input type="checkbox" checked={damageOnly} onChange={(e) => setDamageOnly(e.target.checked)} /> Only change the damage; leave its resistances
              and immunities
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
        </>
      ) : (
        <>
          <label>
            Borrow from{" "}
            <input type="text" list="polymorph-donors" value={donorName} placeholder="Type a creature's name" onChange={(e) => setDonorName(e.target.value)} />
          </label>
          <datalist id="polymorph-donors">
            {choices.map((d) => (
              <option key={d.id} value={d.name} />
            ))}
          </datalist>
          {options !== null && options.length > 0 && (
            <>
              <label>
                <input type="checkbox" checked={forgeChooses} onChange={(e) => setForgeChooses(e.target.checked)} /> Let the forge choose (up to four features)
              </label>
              <div className="graft-options" role="group" aria-label={`What ${donor?.name ?? "the donor"} could lend`}>
                {KIND_HEADINGS.map(([kindName, heading]) => {
                  const group = options.filter((o) => o.kind === kindName);
                  return group.length === 0 ? null : (
                    <fieldset key={kindName} className="graft-group" disabled={forgeChooses}>
                      <legend>{heading}</legend>
                      {group.map((o) => (
                        <label key={o.key}>
                          <input
                            type="checkbox"
                            checked={ticked.includes(o.key)}
                            disabled={!ticked.includes(o.key) && ticked.length >= MAX_BORROW}
                            onChange={() => toggleTick(o.key)}
                          />{" "}
                          {o.label}
                        </label>
                      ))}
                    </fieldset>
                  );
                })}
              </div>
            </>
          )}
          {options !== null && options.length > 0 && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={legendary && !hasLegendary}
                  disabled={hasLegendary}
                  onChange={(e) => setLegendary(e.target.checked)}
                />{" "}
                Give it legendary actions{hasLegendary ? " (it already has them)" : ""}
              </label>
              {legendary && !hasLegendary && !levelUp && (
                <p className="detail-note">Legendary actions make a creature a bigger threat. You may want to tick Level up as well.</p>
              )}
            </>
          )}
          {optionsMessage && <p className="detail-note">{optionsMessage}</p>}
          {!optionsMessage && donorName.trim() !== "" && donor === null && <p className="detail-note">No creature by that name. Pick one from the list.</p>}
          {!optionsMessage && donor !== null && options === null && <p className="detail-note">Looking up what it could lend…</p>}
        </>
      )}

      <label>
        <input type="checkbox" checked={levelUp} onChange={(e) => setLevelUp(e.target.checked)} /> Level up (about +1 CR)
      </label>
      <button type="button" className="action-button" aria-disabled={blocked} aria-describedby="reskin-status" onClick={make}>
        {kind === "remix" ? "Make remix" : "Make polymorph"}
      </button>
      <p id="reskin-status" role="status" className="detail-note">
        {busy
          ? "Reskinning…"
          : offline
            ? OFFLINE_MESSAGE
            : resting
              ? RESTING_MESSAGE
              : message || (blocked ? hint : surprising ? "Surprise choices are made fresh each time, so they are not reused." : forgeChooses ? "The forge's choice is made fresh each time, so it is not reused." : "")}
      </p>
    </DropMenu>
  );
}
