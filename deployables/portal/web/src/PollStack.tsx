import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Category } from './api';
import { Arrow, btn, KindIcon, kindIcon, kindLabel } from './ui';
import { BallotForm } from './BallotForm';
import './PollStack.css';

type Selection = { id: string; index: number; direction: 'next' | 'previous' };

export function PollStack({ items: available, initialId }: { items: Category[]; initialId?: string }) {
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const items = available.filter((item) => !completed.includes(item.id));
  const [selection, setSelection] = useState<Selection>(() => ({
    id: initialId ?? items[0]?.id ?? '',
    index: Math.max(
      0,
      items.findIndex((item) => item.id === initialId),
    ),
    direction: 'next',
  }));
  const selectedIndex = items.findIndex((item) => item.id === selection.id);
  const index =
    selectedIndex >= 0 ? selectedIndex : items.length === 0 ? 0 : Math.min(selection.index, items.length - 1);
  const item = items[index];
  const hasMultiple = items.length > 1;

  function move(direction: Selection['direction']) {
    const nextIndex = index + (direction === 'next' ? 1 : -1);
    const next = items[nextIndex];
    if (next && !saving) setSelection({ id: next.id, index: nextIndex, direction });
  }

  return (
    <section className="poll-stack" aria-label="Sammlungen, die auf dich warten">
      <div className="poll-stack__controls">
        <span className="poll-stack__count" aria-hidden="true">
          {items.length ? `${index + 1} / ${items.length}` : '0 / 0'}
        </span>
        <nav className="poll-stack__arrows" aria-label="Sammlungen durchblättern">
          <button
            type="button"
            className="poll-stack__arrow"
            aria-label="Vorherige Sammlung"
            disabled={saving || !item || index === 0}
            onClick={() => move('previous')}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <button
            type="button"
            className="poll-stack__arrow"
            aria-label="Nächste Sammlung"
            disabled={saving || !item || index === items.length - 1}
            onClick={() => move('next')}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </nav>
      </div>
      <div className="poll-stack__deck" data-direction={selection.direction}>
        {items.length > 2 && <span className="poll-stack__rear poll-stack__rear--back" aria-hidden="true" />}
        {hasMultiple && <span className="poll-stack__rear poll-stack__rear--front" aria-hidden="true" />}
        {item ? (
          <article key={item.id} className="poll-stack__card" data-direction={selection.direction}>
            <span className="poll-stack__topline">
              <span className="poll-stack__kind">
                <KindIcon icon={kindIcon[item.kind]} className="size-5" />
                {kindLabel[item.kind]}
              </span>
            </span>
            <div>
              <h3 className="poll-stack__title">{item.name}</h3>
              {item.description && <span className="poll-stack__description">{item.description}</span>}
            </div>
            {item.repeatable ? (
              <div className="poll-stack__bottomline">
                <span className="poll-stack__meta">Noch nichts eingereicht</span>
                <Link className={btn.primary} to={`/sammlungen/${item.id}`}>
                  Beitragen <Arrow />
                </Link>
              </div>
            ) : (
              <BallotForm
                poll={item}
                onBusyChange={setSaving}
                disabled={saving}
                choices={
                  drafts[item.id] ??
                  (item.my_option_ids?.length ? item.my_option_ids : item.my_option_id ? [item.my_option_id] : [])
                }
                onChoicesChange={(choices) => setDrafts((previous) => ({ ...previous, [item.id]: choices }))}
                onSaved={() => setCompleted((previous) => [...previous, item.id])}
              />
            )}
          </article>
        ) : (
          <div className="poll-stack__empty">
            <p>Alles erledigt. Danke fürs Mitmachen!</p>
            <Link className={btn.text} to="/sammlungen">
              Alle Sammlungen ansehen <Arrow />
            </Link>
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {item ? `Sammlung ${index + 1} von ${items.length}: ${item.name}` : 'Keine Sammlungen verfügbar'}
      </p>
    </section>
  );
}
