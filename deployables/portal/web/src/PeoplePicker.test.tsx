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
