import { DayPicker } from '@daypicker/react';
import { de } from '@daypicker/react/locale';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import '@daypicker/react/style.css';
import './EndDatePicker.css';

function localValue(day: Date, time: string) {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T${time}`;
}

export function EndDatePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const selected = value ? new Date(value) : undefined;
  const [month, setMonth] = useState(selected ?? new Date());
  const time = value.slice(11, 16) || '23:59';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  function choose(day: Date) {
    onChange(localValue(day, time));
    setMonth(day);
  }
  return (
    <fieldset
      className="end-date"
      disabled={disabled}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && expanded) {
          event.preventDefault();
          setExpanded(false);
          trigger.current?.focus();
        }
      }}
    >
      <legend className="end-date__label">Enddatum</legend>
      <div className="end-date__shortcuts">
        <span>Ab heute</span>
        {[
          [1, '1d', 'In einem Tag'],
          [7, '1w', 'In einer Woche'],
          [28, '4w', 'In vier Wochen'],
        ].map(([days, text, title]) => (
          <button
            key={text}
            type="button"
            title={String(title)}
            aria-pressed={
              value ===
              localValue(new Date(today.getFullYear(), today.getMonth(), today.getDate() + Number(days)), time)
            }
            onClick={() => {
              const day = new Date();
              day.setDate(day.getDate() + Number(days));
              choose(day);
            }}
          >
            {text}
          </button>
        ))}
      </div>
      <button
        ref={trigger}
        type="button"
        className="end-date__trigger"
        aria-label="Enddatum auswählen"
        aria-expanded={expanded}
        aria-controls={`${id}-calendar`}
        onClick={() => setExpanded(!expanded)}
      >
        <CalendarDays size={22} aria-hidden="true" />
        <span aria-live="polite">
          {selected
            ? new Intl.DateTimeFormat('de-DE', {
                weekday: 'short',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              }).format(selected)
            : 'Datum auswählen'}
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {expanded && (
        <div id={`${id}-calendar`} className="end-date__calendar">
          <DayPicker
            mode="single"
            required
            locale={de}
            weekStartsOn={1}
            selected={selected}
            month={month}
            onMonthChange={setMonth}
            onSelect={(day) => day && choose(day)}
            disabled={disabled ? true : { before: today }}
            captionLayout="dropdown"
            navLayout="around"
            startMonth={new Date(Math.min(today.getTime(), selected?.getTime() ?? today.getTime()))}
            endMonth={new Date(Math.max(today.getFullYear() + 10, selected?.getFullYear() ?? 0), 11)}
            labels={{
              labelNext: () => 'Nächster Monat',
              labelPrevious: () => 'Vorheriger Monat',
              labelMonthDropdown: () => 'Monat',
              labelYearDropdown: () => 'Jahr',
            }}
          />
        </div>
      )}
      <label className="end-date__time" htmlFor={`${id}-time`}>
        <span>Uhrzeit</span>
        <input
          id={`${id}-time`}
          type="time"
          value={time}
          required
          onChange={(event) => {
            if (event.target.value) onChange(localValue(selected ?? new Date(), event.target.value));
          }}
        />
      </label>
      <p className="end-date__hint">Schließt zur gewählten Ortszeit. Die Schnellwahl behält die Uhrzeit bei.</p>
    </fieldset>
  );
}
