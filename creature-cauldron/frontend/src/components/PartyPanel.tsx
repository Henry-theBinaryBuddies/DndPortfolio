import { useState } from "react";
import type { XpRange } from "../lib/filters";
import { label } from "../lib/options";
import {
  DIFFICULTIES,
  MAX_LEVEL,
  MAX_PARTY_SIZE,
  MIN_LEVEL,
  describeBand,
  describeParty,
  partyThresholds,
  type Difficulty,
  type Party,
} from "../lib/party";

interface PartyPanelProps {
  party: Party;
  difficulty: Difficulty | null;
  /** The solo XP band for the chosen difficulty, or null when no difficulty is picked. */
  band: XpRange | null;
  onPartyChange: (party: Party) => void;
  onDifficultyChange: (difficulty: Difficulty | null) => void;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const LEVELS = range(MIN_LEVEL, MAX_LEVEL);
const SIZES = range(1, MAX_PARTY_SIZE);

function LevelSelect({
  id,
  text,
  value,
  onChange,
}: {
  id: string;
  text: string;
  /** The level, or null when the party is mixed. */
  value: number | null;
  onChange: (level: number) => void;
}) {
  return (
    <label className="party-field" htmlFor={id}>
      {text}
      <select id={id} value={value === null ? "mixed" : String(value)} onChange={(e) => onChange(Number(e.target.value))}>
        {value === null && (
          <option value="mixed" disabled>
            Mixed
          </option>
        )}
        {LEVELS.map((level) => (
          <option key={level} value={level}>
            {level}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function PartyPanel({ party, difficulty, band, onPartyChange, onDifficultyChange }: PartyPanelProps) {
  // Whether the per-character level list is showing is a purely visual choice, so it lives here.
  const [individual, setIndividual] = useState(false);
  const { levels } = party;
  const commonLevel = levels.every((level) => level === levels[0]) ? levels[0] : null;
  const thresholds = partyThresholds(party);

  const setSize = (size: number) => {
    if (size > levels.length) {
      // New characters start at the same level as the last one.
      const extra = Array(size - levels.length).fill(levels[levels.length - 1]);
      onPartyChange({ levels: [...levels, ...extra] });
    } else {
      onPartyChange({ levels: levels.slice(0, size) });
    }
  };

  const setLevelFor = (index: number, level: number) =>
    onPartyChange({ levels: levels.map((current, i) => (i === index ? level : current)) });

  return (
    <section className="party-panel" aria-label="Party and difficulty">
      <h2>Party</h2>

      <div className="party-row">
        <label className="party-field" htmlFor="party-size">
          Characters
          <select id="party-size" value={levels.length} onChange={(e) => setSize(Number(e.target.value))}>
            {SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        {!individual && (
          <LevelSelect
            id="party-level"
            text="Level"
            value={commonLevel}
            onChange={(level) => onPartyChange({ levels: levels.map(() => level) })}
          />
        )}
      </div>

      {individual && (
        <div className="party-levels">
          {levels.map((level, index) => (
            <LevelSelect
              key={index}
              id={`party-level-${index}`}
              text={`Character ${index + 1}`}
              value={level}
              onChange={(next) => setLevelFor(index, next)}
            />
          ))}
        </div>
      )}

      <button type="button" className="link-button" onClick={() => setIndividual(!individual)}>
        {individual ? "Same level for everyone" : "Set levels individually"}
      </button>

      <fieldset className="difficulty">
        <legend>Difficulty</legend>
        <div className="difficulty-options">
          {[null, ...DIFFICULTIES].map((option) => (
            <label key={option ?? "any"} className={difficulty === option ? "pill selected" : "pill"}>
              <input
                type="radio"
                name="difficulty"
                checked={difficulty === option}
                onChange={() => onDifficultyChange(option)}
              />
              {option === null ? "Any" : label(option)}
            </label>
          ))}
        </div>
      </fieldset>

      {difficulty !== null && band !== null && (
        <p className="band-note">
          <strong>{label(difficulty)}</strong> for {describeParty(party)}: {describeBand(band)}. Rated as a lone
          monster.
        </p>
      )}

      <details className="budgets">
        <summary>XP budgets</summary>
        <ul>
          {DIFFICULTIES.map((d) => (
            <li key={d}>
              {label(d)}: {thresholds[d].toLocaleString("en-US")} XP
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
