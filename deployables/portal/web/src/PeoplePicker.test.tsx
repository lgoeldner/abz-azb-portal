import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PeoplePicker, type PeoplePickerOption } from './PeoplePicker';

const people: PeoplePickerOption[] = [
  { id: 'alice', name: 'Alice Beispiel', user_id: 'user-alice' },
  { id: 'bob', name: 'Bob Beispiel', user_id: 'user-bob' },
  { id: 'mia', name: 'Mia Beispiel', user_id: 'user-mia' },
  ...['Anna Berg', 'Elias Koch', 'Lina Schulz', 'Noah Braun', 'Emma Wolf', 'Paul Lang', 'Clara Maier'].map((name) => ({
    id: name,
    name,
  })),
];

describe('PeoplePicker', () => {
  it('uses toggle chips with selection limits and single-choice replacement', () => {
    const onChange = vi.fn();
    const options = people.slice(0, 3);
    const { rerender } = render(
      <PeoplePicker
        legend="Optionen"
        options={options}
        selectedIds={['alice']}
        onChange={onChange}
        maxSelected={2}
        chips
      />,
    );
    expect(screen.queryByRole('list', { name: 'Ausgewählt' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alice Beispiel' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Alice Beispiel' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    fireEvent.click(screen.getByRole('button', { name: 'Bob Beispiel' }));
    expect(onChange).toHaveBeenLastCalledWith(['alice', 'bob']);
    rerender(
      <PeoplePicker
        legend="Optionen"
        options={options}
        selectedIds={['alice', 'bob']}
        onChange={onChange}
        maxSelected={2}
        chips
      />,
    );
    expect(screen.getByRole('button', { name: 'Mia Beispiel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Alice Beispiel' })).toBeEnabled();
    rerender(
      <PeoplePicker
        legend="Optionen"
        options={options}
        selectedIds={['alice']}
        onChange={onChange}
        maxSelected={1}
        chips
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bob Beispiel' }));
    expect(onChange).toHaveBeenLastCalledWith(['bob']);
  });

  it('only shows search for at least ten choices and clears its filtering when the list shrinks', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PeoplePicker
        legend="Optionen"
        searchLabel="Option suchen"
        options={people.slice(0, 9)}
        selectedIds={[]}
        onChange={onChange}
      />,
    );
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    rerender(
      <PeoplePicker
        legend="Optionen"
        searchLabel="Option suchen"
        options={people}
        selectedIds={[]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole('searchbox', { name: 'Option suchen' }), { target: { value: 'niemand' } });
    expect(screen.getByRole('status')).toHaveTextContent('Keine Auswahlmöglichkeiten gefunden.');
    rerender(
      <PeoplePicker
        legend="Optionen"
        searchLabel="Option suchen"
        options={people.slice(0, 9)}
        selectedIds={[]}
        onChange={onChange}
      />,
    );
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bob Beispiel' })).toBeInTheDocument();
  });

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
    expect(screen.getByRole('status')).toHaveTextContent('Keine Auswahlmöglichkeiten gefunden.');
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
