import { useId, useState } from 'react';
import { Check } from 'lucide-react';
import { field, label } from './ui';

export type PeoplePickerOption = {
  id: string;
  name: string;
  user_id?: string | null;
};

/** Searchable, keyboard-operable people selection shared by candidate setup and voting. */
export function PeoplePicker({
  legend,
  options,
  selectedIds,
  onChange,
  maxSelected,
  disabledUserIds = [],
  disabled = false,
  searchLabel = 'Person suchen',
  chips = false,
}: {
  legend: string;
  options: PeoplePickerOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  maxSelected?: number;
  disabledUserIds?: string[];
  disabled?: boolean;
  searchLabel?: string;
  chips?: boolean;
}) {
  const [search, setSearch] = useState('');
  const inputId = useId();
  const selected = new Set(selectedIds);
  const searchable = options.length >= 10;
  const matching = options.filter(
    (option) => !searchable || option.name.toLocaleLowerCase('de').includes(search.trim().toLocaleLowerCase('de')),
  );
  const atLimit = maxSelected !== undefined && selectedIds.length >= maxSelected;

  function toggle(option: PeoplePickerOption) {
    if (selected.has(option.id)) {
      onChange(selectedIds.filter((id) => id !== option.id));
    } else if (maxSelected === 1) {
      onChange([option.id]);
    } else if (maxSelected === undefined || selectedIds.length < maxSelected) {
      onChange([...selectedIds, option.id]);
    }
  }

  return (
    <fieldset className="min-w-0 space-y-3" disabled={disabled}>
      <legend className={label}>{legend}</legend>
      <p className="text-sm text-muted" aria-live="polite">
        {maxSelected === undefined
          ? `${selectedIds.length} ausgewählt`
          : `${selectedIds.length} von ${maxSelected} ausgewählt`}
      </p>
      {!chips && selectedIds.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Ausgewählt">
          {selectedIds.map((id) => {
            const option = options.find((item) => item.id === id);
            if (!option) return null;
            return (
              <li key={id}>
                <button
                  type="button"
                  className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-full bg-pop px-3 text-sm font-semibold text-ink hover:bg-pill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                  aria-label={`${option.name} entfernen`}
                  onClick={() => toggle(option)}
                >
                  <span className="min-w-0 break-words">{option.name}</span>{' '}
                  <span className="shrink-0" aria-hidden="true">
                    ×
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {searchable && (
        <label className={label} htmlFor={inputId}>
          {searchLabel}
          <input
            id={inputId}
            className={field}
            type="search"
            maxLength={200}
            placeholder={searchLabel === 'Person suchen' ? 'Name eingeben' : 'Option eingeben'}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      )}
      <ul
        className={
          chips
            ? 'flex max-h-80 flex-wrap gap-2 overflow-y-auto p-1'
            : 'max-h-64 space-y-1 overflow-y-auto rounded-ui bg-white p-2'
        }
        aria-label={`${legend}: Suchergebnisse`}
      >
        {matching.map((option) => {
          const isSelected = selected.has(option.id);
          const isSelf = option.user_id ? disabledUserIds.includes(option.user_id) : false;
          const isAtLimit = atLimit && !isSelected && maxSelected !== 1;
          const unavailable = isSelf || isAtLimit;
          return (
            <li key={option.id} className={chips ? 'min-w-0 max-w-full' : undefined}>
              <button
                type="button"
                className={
                  chips
                    ? `inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border-2 px-4 py-2 text-left text-[15px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${isSelected ? 'border-ink bg-ink text-white' : unavailable ? 'cursor-not-allowed border-transparent bg-pill text-muted' : 'border-transparent bg-white text-ink hover:border-ink'}`
                    : `flex min-h-11 w-full items-center justify-between gap-3 rounded-ui px-3 text-left text-[15px] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink ${unavailable ? 'cursor-not-allowed text-muted' : 'hover:bg-soft'}`
                }
                aria-pressed={isSelected}
                aria-label={chips ? option.name : undefined}
                disabled={unavailable}
                onClick={() => toggle(option)}
              >
                <span className="min-w-0 break-words">{option.name}</span>
                {isSelf ? (
                  <small className="max-w-28 shrink-0 whitespace-normal text-right text-xs leading-tight sm:max-w-none">
                    Eigene Stimme nicht erlaubt
                  </small>
                ) : isAtLimit ? (
                  !chips && <small className="shrink-0 text-xs">Limit erreicht</small>
                ) : isSelected ? (
                  <span className="shrink-0" aria-hidden="true">
                    {chips ? <Check className="size-4" /> : 'Ausgewählt'}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
        {matching.length === 0 && (
          <li className="px-3 py-2 text-sm text-muted" role="status">
            Keine Auswahlmöglichkeiten gefunden.
          </li>
        )}
      </ul>
    </fieldset>
  );
}
