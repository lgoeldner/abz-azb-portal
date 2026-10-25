import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PeoplePicker, type PeoplePickerOption } from './PeoplePicker';

const people: PeoplePickerOption[] = [
  { id: 'alice', name: 'Alice Beispiel', user_id: 'user-alice' },
  { id: 'bob', name: 'Bob Beispiel', user_id: 'user-bob' },
  { id: 'mia', name: 'Mia Beispiel', user_id: 'user-mia' },
];

describe('PeoplePicker', () => {
  it('filters by search, shows removable selection chips, and reports no matches', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PeoplePicker legend="Kandidat:innen" options={people} selectedIds={[]} onChange={onChange} />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'Person suchen' }), {
      target: { value: 'alice' },
    });
    expect(screen.getByRole('button', { name: 'Alice Beispiel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bob Beispiel' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Alice Beispiel' }));
    expect(onChange).toHaveBeenLastCalledWith(['alice']);

    rerender(<PeoplePicker legend="Kandidat:innen" options={people} selectedIds={['alice']} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Alice Beispiel entfernen' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Alice Beispiel entfernen' }));
    expect(onChange).toHaveBeenLastCalledWith([]);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Person suchen' }), {
      target: { value: 'niemand' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Keine Personen gefunden.');
  });

  it('replaces a single selection, enforces a larger limit, and disables a person who cannot self-vote', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PeoplePicker
        legend="Personen auswählen"
        options={people}
        selectedIds={['alice']}
        onChange={onChange}
        maxSelected={1}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bob Beispiel' }));
    expect(onChange).toHaveBeenLastCalledWith(['bob']);

    rerender(
      <PeoplePicker
        legend="Personen auswählen"
        options={people}
        selectedIds={['alice', 'bob']}
        onChange={onChange}
        maxSelected={2}
        disabledUserIds={['user-mia']}
      />,
    );
    expect(screen.getByText('2 von 2 ausgewählt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mia Beispiel/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Alice Beispiel entfernen/ })).toBeInTheDocument();

    rerender(
      <PeoplePicker
        legend="Personen auswählen"
        options={people}
        selectedIds={[]}
        onChange={onChange}
        maxSelected={2}
        disabled
      />,
    );
    expect(screen.getByRole('searchbox', { name: 'Person suchen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Alice Beispiel' })).toBeDisabled();
  });
});
