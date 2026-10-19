import { CR_LADDER, toggle, type FilterState } from "../lib/filters";
import {
  CREATURE_TYPES,
  DAMAGE_THEMES,
  ENVIRONMENTS,
  FEATURES,
  FEATURE_LABELS,
  FLAVOR_THEMES,
  ROLES,
  SIZES,
  label,
} from "../lib/options";

// The panel never stores filter values itself. It shows whatever `filters` says
// and reports changes through `onChange`; App owns the state ("lifting state up").
// Inputs driven this way are called controlled inputs.

interface FilterPanelProps {
  filters: FilterState;
  activeCount: number;
  onChange: (next: FilterState) => void;
  onClear: () => void;
}

interface CheckboxGroupProps<T extends string> {
  title: string;
  options: readonly T[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  getLabel?: (value: T) => string;
  defaultOpen?: boolean;
}

/** A collapsible group of checkboxes. Generic over the option type, so a Role group only accepts Roles. */
function CheckboxGroup<T extends string>({
  title,
  options,
  selected,
  onToggle,
  getLabel = label,
  defaultOpen = false,
}: CheckboxGroupProps<T>) {
  return (
    // `open` only sets the starting state; after that the browser tracks it, so ticking
    // a box never snaps the group shut. The count badge shows picks inside a closed group.
    <details className="filter-group" open={defaultOpen}>
      <summary>
        {title}
        {selected.length > 0 && <span className="filter-count">{selected.length}</span>}
      </summary>
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
    </details>
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

export default function FilterPanel({ filters, activeCount, onChange, onClear }: FilterPanelProps) {
  const update = (changes: Partial<FilterState>) => onChange({ ...filters, ...changes });

  // Keep the range sensible: raising the minimum above the maximum drags the maximum up, and vice versa.
  const setCrMin = (crMin: number | null) =>
    update({ crMin, crMax: crMin !== null && filters.crMax !== null && crMin > filters.crMax ? crMin : filters.crMax });
  const setCrMax = (crMax: number | null) =>
    update({ crMax, crMin: crMax !== null && filters.crMin !== null && crMax < filters.crMin ? crMax : filters.crMin });

  return (
    <aside className="filter-panel" aria-label="Filters">
      <div className="filter-header">
        <h2>Filters</h2>
        <button type="button" className="link-button" onClick={onClear} disabled={activeCount === 0}>
          Clear all{activeCount > 0 ? ` (${activeCount})` : ""}
        </button>
      </div>

      <input
        type="search"
        className="search-box"
        placeholder="Search by name"
        aria-label="Search by name"
        value={filters.search}
        onChange={(e) => update({ search: e.target.value })}
      />

      <CheckboxGroup
        title="Creature type"
        options={CREATURE_TYPES}
        selected={filters.types}
        onToggle={(v) => update({ types: toggle(filters.types, v) })}
        defaultOpen
      />

      <details className="filter-group" open>
        <summary>
          Challenge rating
          {(filters.crMin !== null || filters.crMax !== null) && <span className="filter-count">1</span>}
        </summary>
        <div className="cr-range">
          <CrSelect id="cr-min" text="Min" value={filters.crMin} onChange={setCrMin} />
          <CrSelect id="cr-max" text="Max" value={filters.crMax} onChange={setCrMax} />
        </div>
      </details>

      <CheckboxGroup
        title="Size"
        options={SIZES}
        selected={filters.sizes}
        onToggle={(v) => update({ sizes: toggle(filters.sizes, v) })}
      />
      <CheckboxGroup
        title="Environment"
        options={ENVIRONMENTS}
        selected={filters.environments}
        onToggle={(v) => update({ environments: toggle(filters.environments, v) })}
      />
      <CheckboxGroup
        title="Role"
        options={ROLES}
        selected={filters.roles}
        onToggle={(v) => update({ roles: toggle(filters.roles, v) })}
      />
      <CheckboxGroup
        title="Damage theme"
        options={DAMAGE_THEMES}
        selected={filters.damageThemes}
        onToggle={(v) => update({ damageThemes: toggle(filters.damageThemes, v) })}
      />
      <CheckboxGroup
        title="Features (must have all)"
        options={FEATURES}
        selected={filters.features}
        onToggle={(v) => update({ features: toggle(filters.features, v) })}
        getLabel={(feature) => FEATURE_LABELS[feature]}
      />
      <CheckboxGroup
        title="Flavor theme"
        options={FLAVOR_THEMES}
        selected={filters.flavorThemes}
        onToggle={(v) => update({ flavorThemes: toggle(filters.flavorThemes, v) })}
      />
    </aside>
  );
}
