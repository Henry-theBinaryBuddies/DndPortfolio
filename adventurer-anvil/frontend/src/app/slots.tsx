// Controls for the slot choices: assign (place given values), allocate (spend a budget) and roll (dice, logged).
// Generic: the system supplies the slots, values, budget and dice; a slot may name a derived value it feeds,
// shown beside it with the rest of that value's breakdown (e.g. a race's bonus) and the final result.
import { useId } from "react";
import type { ChoiceValue, Derived, RollRecord, Slot } from "../core";
import { choiceDomId, Issues, type ChoiceProps } from "./choices";
import { formatValue } from "./format";

type Values = Record<string, number>;

function asValues(value: ChoiceValue | undefined): Values {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((e): e is [string, number] => typeof e[1] === "number"));
}

/** "+2 Elf, +1 High Elf": the lines of the slot's derived value after its first (the slot's own value). */
function Extras({ slot, derived }: { slot: Slot; derived: Record<string, Derived> }) {
  const d = slot.derived ? derived[slot.derived] : undefined;
  const extras = d?.breakdown.slice(1) ?? [];
  if (!extras.length) return <span className="dim">–</span>;
  return <span className="attention">{extras.map((l) => `${typeof l.amount === "number" && l.amount >= 0 ? "+" : ""}${l.amount} ${l.label}`).join(", ")}</span>;
}

function Final({ slot, derived, set }: { slot: Slot; derived: Record<string, Derived>; set: boolean }) {
  if (!set || !slot.derived) return <span className="dim">–</span>;
  const note = slot.derivedNote ? derived[slot.derivedNote]?.value : undefined;
  return (
    <span className="final">
      {formatValue(derived[slot.derived]?.value)}
      {note !== undefined && <span className="dim"> ({formatValue(note, "signed")})</span>}
    </span>
  );
}

const count = (list: number[], v: number) => list.filter((x) => x === v).length;

/** Place each of the given values in one slot. Picking a value with no free copy swaps it with its holder. */
export function Assign({ spec, value, issues, onChange, derived }: ChoiceProps) {
  const values = spec.values ?? [];
  const slots = spec.slots ?? [];
  const current = asValues(value);
  const placed = Object.values(current);
  const left = values.filter((v, i) => count(values.slice(0, i + 1), v) > count(placed, v));
  const distinct = [...new Set(values)].sort((a, b) => b - a);

  const choose = (slot: string, raw: string) => {
    const next = { ...current };
    if (raw === "") {
      delete next[slot];
    } else {
      const v = Number(raw);
      const heldElsewhere = Object.entries(next).filter(([s, x]) => s !== slot && x === v).length;
      if (heldElsewhere >= count(values, v)) {
        // No free copy: swap with a slot holding it (that slot takes this one's old value, or nothing).
        const holder = Object.keys(next).find((s) => s !== slot && next[s] === v)!;
        if (current[slot] !== undefined) next[holder] = current[slot];
        else delete next[holder];
      }
      next[slot] = v;
    }
    onChange(next);
  };

  return (
    <section className="choice" id={choiceDomId(spec.key)} tabIndex={-1} aria-labelledby={`${choiceDomId(spec.key)}-label`}>
      <h2 id={`${choiceDomId(spec.key)}-label`} className="choice-title">{spec.label}</h2>
      <p className="meta">
        Each value goes to one ability; choosing one that's taken swaps the two. Left to give:{" "}
        <span className="attention">{left.length ? left.join(", ") : "none"}</span>
      </p>
      <table className="slots">
        <thead><tr><th scope="col">Ability</th><th scope="col">Base</th><th scope="col">Bonuses</th><th scope="col">Score</th></tr></thead>
        <tbody>
          {slots.map((slot) => (
            <tr key={slot.id}>
              <th scope="row">{slot.name}</th>
              <td>
                <select aria-label={`${slot.name} base score`} value={current[slot.id] ?? ""} onChange={(e) => choose(slot.id, e.target.value)}>
                  <option value="">Choose</option>
                  {distinct.map((v) => {
                    const holders = slots.filter((s) => s.id !== slot.id && current[s.id] === v);
                    const free = count(values, v) - holders.length > 0;
                    return (
                      <option key={v} value={v}>
                        {free || current[slot.id] === v ? v : `${v} (swap with ${holders[0]?.name})`}
                      </option>
                    );
                  })}
                </select>
              </td>
              <td><Extras slot={slot} derived={derived} /></td>
              <td><Final slot={slot} derived={derived} set={current[slot.id] !== undefined} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Issues issues={issues} />
    </section>
  );
}

/** Spend a budget across slots, each between a lowest and highest value, at the given cost per value. */
export function Allocate({ spec, value, issues, onChange, derived }: ChoiceProps) {
  const slots = spec.slots ?? [];
  const min = spec.range?.min ?? 0;
  const max = spec.range?.max ?? min;
  const cost = (v: number) => spec.budget?.cost[String(v)] ?? Infinity;
  const stored = asValues(value);
  const current: Values = Object.fromEntries(slots.map((s) => [s.id, stored[s.id] ?? min]));
  const spent = slots.reduce((sum, s) => sum + cost(current[s.id]), 0);
  const total = spec.budget?.total ?? 0;
  const left = total - spent;
  const leftId = useId();

  const change = (slot: string, by: number) => onChange({ ...current, [slot]: current[slot] + by });
  const valueLabel = spec.slotValue?.label ?? "Base";
  const showCost = spec.slotValue?.cost ?? true;

  return (
    <section className="choice" id={choiceDomId(spec.key)} tabIndex={-1} aria-labelledby={`${choiceDomId(spec.key)}-label`}>
      <h2 id={`${choiceDomId(spec.key)}-label`} className="choice-title">{spec.label}</h2>
      {spec.source && <p className="meta">From {spec.source}</p>}
      <p className="meta">
        {spec.hint ?? `Scores from ${min} to ${max}, before bonuses.`}{" "}
        <span id={leftId} role="status">Points left: <span className={left < 0 ? "attention" : "final"}>{left}</span> of {total}</span>
      </p>
      <table className="slots">
        <thead><tr><th scope="col">Ability</th><th scope="col">{valueLabel}</th>{showCost && <th scope="col">Cost</th>}<th scope="col">Bonuses</th><th scope="col">Score</th></tr></thead>
        <tbody>
          {slots.map((slot) => {
            const v = current[slot.id];
            const canRaise = v < max && cost(v + 1) - cost(v) <= left;
            return (
              <tr key={slot.id}>
                <th scope="row">{slot.name}</th>
                <td className="stepper">
                  <button type="button" className="button small" aria-label={`Lower ${slot.name}`} aria-describedby={leftId} disabled={v <= min} onClick={() => change(slot.id, -1)}>−</button>
                  <span className="final" aria-label={`${slot.name} ${valueLabel.toLowerCase()} ${v}`}>{v}</span>
                  <button type="button" className="button small" aria-label={`Raise ${slot.name}`} aria-describedby={leftId} disabled={!canRaise} onClick={() => change(slot.id, 1)}>+</button>
                </td>
                {showCost && <td className="dim">{Number.isFinite(cost(v)) ? cost(v) : "–"}</td>}
                <td><Extras slot={slot} derived={derived} /></td>
                <td><Final slot={slot} derived={derived} set /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Issues issues={issues} />
    </section>
  );
}

/** The multiplier on a whole roll ("5d4x10" → 10), shown after the dice. */
const times = (expression: string) => /[x×*](\d+)$/.exec(expression)?.[1];

function RollSet({ set }: { set: RollRecord[] }) {
  return (
    <ul className="roll-set">
      {set.map((roll) => {
        // Mark the dropped dice: those not among the kept ones, matching each kept die once.
        const keep = [...roll.kept];
        return (
          <li key={roll.id}>
            {roll.dice.map((d, i) => {
              const at = keep.indexOf(d);
              const kept = at >= 0;
              if (kept) keep.splice(at, 1);
              return <span key={i} className={`die${kept ? "" : " dropped"}`}>{d}</span>;
            })}
            <span className="sr-only">{roll.dice.length - roll.kept.length ? `, lowest dropped,` : ""}</span>
            {times(roll.expression) && <> × {times(roll.expression)}</>}
            {" = "}<span className="final">{roll.total}</span>
          </li>
        );
      })}
    </ul>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * One small roll on a row (a level's hit points): its label, the latest total, and a button. Every roll stays in the
 * roll log and the latest counts, as with any roll.
 */
export function CompactRoll({ spec, issues, rollSets, onRoll }: ChoiceProps) {
  const latest = rollSets.at(-1)?.[0];
  const id = choiceDomId(spec.key);
  return (
    <div className="compact-roll" id={id} tabIndex={-1}>
      <span className="compact-roll-label">{spec.label}</span>
      <span className="final" aria-live="polite">{latest ? latest.total : <span className="dim">–</span>}<span className="sr-only">{latest ? "" : " not rolled yet"}</span></span>
      <span className="dim compact-roll-dice">{spec.dice}{rollSets.length > 1 ? ` · rolled ${rollSets.length} times` : ""}</span>
      <button type="button" className="button small" onClick={() => onRoll(spec)}>
        {latest ? "Roll again" : "Roll"}<span className="sr-only"> for {spec.label} ({spec.dice})</span>
      </button>
      {issues.length > 0 && <div className="compact-roll-issues"><Issues issues={issues} /></div>}
    </div>
  );
}

/** Roll a set of dice; every set is kept in the roll log, and the latest is the one that counts. */
export function Roll({ spec, issues, rollSets, onRoll }: ChoiceProps) {
  const latest = rollSets.at(-1);
  return (
    <section className="choice" id={choiceDomId(spec.key)} tabIndex={-1} aria-labelledby={`${choiceDomId(spec.key)}-label`}>
      <h2 id={`${choiceDomId(spec.key)}-label`} className="choice-title">{spec.label}</h2>
      <p className="meta">
        Every set stays in the roll log; the latest is the one that counts.
      </p>
      <button type="button" className="button primary" onClick={() => onRoll(spec)}>{latest ? "Roll again" : "Roll"}</button>
      {latest && (
        <div className="detail" aria-live="polite">
          <p className="label">Set {rollSets.length} of {rollSets.length} · rolled {when(latest[0].at)}</p>
          <RollSet set={latest} />
        </div>
      )}
      {rollSets.length > 1 && (
        <details className="more">
          <summary>See all rolls ({rollSets.length} sets)</summary>
          {rollSets.map((set, i) => (
            <div key={set[0].id} style={{ marginTop: 8 }}>
              <p className="label">Set {i + 1} · {when(set[0].at)}</p>
              <RollSet set={set} />
            </div>
          ))}
        </details>
      )}
      <Issues issues={issues} />
    </section>
  );
}
