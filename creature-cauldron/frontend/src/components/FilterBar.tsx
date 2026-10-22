import type { ReactNode } from "react";
import { CR_LADDER, toggle, type FilterState } from "../lib/filters";
import { SOURCES, SOURCE_NAMES } from "../lib/sourceLabel";
import DropMenu from "./DropMenu";
import {
  CREATURE_TYPES,
  DAMAGE_THEMES,
  ENVIRONMENTS,
  FEATURES,
  FEATURE_LABELS,
  ROLES,
  SIZES,
  label,
} from "../lib/options";

// A horizontal bar: a search box plus one dropdown menu per filter group. Like the old
// side panel it never stores filter values itself. It shows whatever `filters` says and
// reports changes through `onChange`; App owns the state ("lifting state up").

interface FilterBarProps {
  filters: FilterState;
  activeCount: number;
  onChange: (next: FilterState) => void;
  onClear: () => void;
}

interface CheckboxListProps<T extends string> {
  options: readonly T[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  getLabel?: (value: T) => string;
}

/** A list of checkboxes. Generic over the option type, so a Role list only accepts Roles. */
function CheckboxList<T extends string>({ options, selected, onToggle, getLabel = label }: CheckboxListProps<T>) {
  return (
    <ul className="filter-options">
      {options.map((option) => (
        <li key={option}>
          <label>
            <input type="checkbox" checked={selected.includes(option)} onChange={() => onToggle(option)} />
            {getLabel(option)}
          </label>
        </li>
      ))}
    </ul>
  );
}

function CrSelect({
  id,
  text,
  value,
  onChange,
}: {
  id: string;
  text: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="cr-select" htmlFor={id}>
      {text}
      <select
        id={id}
        value={value === null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      >
        <option value="">Any</option>
        {CR_LADDER.map((cr) => (
          <option key={cr.label} value={String(cr.value)}>
            {cr.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** One filter group: a button with a badge for how many picks are active, opening its controls under it. */
function FilterMenu({ title, count, align = "left", children }: { title: string; count: number; align?: "left" | "right"; children: ReactNode }) {
  return (
    <DropMenu
      label={
        <>
          {title}
          {count > 0 && <span className="filter-count">{count}</span>}
          <span aria-hidden="true"> ▾</span>
        </>
      }
      ariaLabel={count > 0 ? `${title}, ${count} selected` : title}
      buttonClassName="menu-button"
      panelClassName="menu-panel"
      align={align}
    >
      {children}
    </DropMenu>
  );
}

export default function FilterBar({ filters, activeCount, onChange, onClear }: FilterBarProps) {
  const update = (changes: Partial<FilterState>) => onChange({ ...filters, ...changes });

  // Keep the range sensible: raising the minimum above the maximum drags the maximum up, and vice versa.
  const setCrMin = (crMin: number | null) =>
    update({ crMin, crMax: crMin !== null && filters.crMax !== null && crMin > filters.crMax ? crMin : filters.crMax });
  const setCrMax = (crMax: number | null) =>
    update({ crMax, crMin: crMax !== null && filters.crMin !== null && crMax < filters.crMin ? crMax : filters.crMin });

  return (
    <section className="filter-bar" aria-label="Filters">
      <input
        type="search"
        className="search-box"
        placeholder="Search by name"
        aria-label="Search by name"
        value={filters.search}
        onChange={(e) => update({ search: e.target.value })}
      />

      <div className="filter-menus">
        <FilterMenu title="Type" count={filters.types.length}>
          <CheckboxList
            options={CREATURE_TYPES}
            selected={filters.types}
            onToggle={(v) => update({ types: toggle(filters.types, v) })}
          />
        </FilterMenu>

        <FilterMenu title="CR" count={filters.crMin !== null || filters.crMax !== null ? 1 : 0}>
          <div className="cr-range">
            <CrSelect id="cr-min" text="Min" value={filters.crMin} onChange={setCrMin} />
            <CrSelect id="cr-max" text="Max" value={filters.crMax} onChange={setCrMax} />
          </div>
        </FilterMenu>

        <FilterMenu title="Size" count={filters.sizes.length}>
          <CheckboxList
            options={SIZES}
            selected={filters.sizes}
            onToggle={(v) => update({ sizes: toggle(filters.sizes, v) })}
          />
        </FilterMenu>

        <FilterMenu title="Environment" count={filters.environments.length}>
          <CheckboxList
            options={ENVIRONMENTS}
            selected={filters.environments}
            onToggle={(v) => update({ environments: toggle(filters.environments, v) })}
          />
        </FilterMenu>

        <FilterMenu title="Role" count={filters.roles.length} align="right">
          <CheckboxList
            options={ROLES}
            selected={filters.roles}
            onToggle={(v) => update({ roles: toggle(filters.roles, v) })}
          />
        </FilterMenu>

        <FilterMenu title="Damage" count={filters.damageThemes.length} align="right">
          <CheckboxList
            options={DAMAGE_THEMES}
            selected={filters.damageThemes}
            onToggle={(v) => update({ damageThemes: toggle(filters.damageThemes, v) })}
          />
        </FilterMenu>

        <FilterMenu title="Source" count={filters.sources.length} align="right">
          <CheckboxList
            options={SOURCES}
            selected={filters.sources}
            onToggle={(v) => update({ sources: toggle(filters.sources, v) })}
            getLabel={(source) => SOURCE_NAMES[source]}
          />
        </FilterMenu>

        <FilterMenu title="Features (all)" count={filters.features.length} align="right">
          <CheckboxList
            options={FEATURES}
            selected={filters.features}
            onToggle={(v) => update({ features: toggle(filters.features, v) })}
            getLabel={(feature) => FEATURE_LABELS[feature]}
          />
        </FilterMenu>
      </div>

      {/* aria-disabled, not disabled: pressing this clears the filters and would otherwise disable the
          button while it has keyboard focus. With nothing to clear, pressing it does nothing. */}
      <button
        type="button"
        className="link-button"
        aria-disabled={activeCount === 0}
        onClick={() => {
          if (activeCount > 0) onClear();
        }}
      >
        Clear all{activeCount > 0 ? ` (${activeCount})` : ""}
      </button>
    </section>
  );
}
