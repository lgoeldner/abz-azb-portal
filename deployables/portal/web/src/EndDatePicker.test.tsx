import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EndDatePicker } from './EndDatePicker';

function Picker({ initial = '', disabled = false }: { initial?: string; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <EndDatePicker value={value} onChange={setValue} disabled={disabled} />
      <output aria-label="Stored deadline">{value}</output>
    </form>
  );
}

afterEach(() => vi.useRealTimers());

describe('EndDatePicker', () => {
  it.each([
    [1, '1d'],
    [7, '1w'],
    [28, '4w'],
  ])('chooses %s calendar days from today while retaining local time', (days, chip) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 16, 0));
    render(<Picker initial="2099-06-01T18:45" />);
    fireEvent.click(screen.getByRole('button', { name: String(chip) }));
    const expected = new Date(2026, 9, 24 + Number(days), 18, 45);
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(screen.getByLabelText('Stored deadline')).toHaveTextContent(
      `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())}T18:45`,
    );
    // A second shortcut is still relative to today, not the previously selected date.
    fireEvent.click(screen.getByRole('button', { name: '1d' }));
    expect(screen.getByLabelText('Stored deadline')).toHaveTextContent('2026-10-25T18:45');
  });

  it('defaults to end of day and carries the date across year boundaries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2027, 11, 31, 16, 0));
    render(<Picker />);
    fireEvent.click(screen.getByRole('button', { name: '1d' }));
    expect(screen.getByLabelText('Stored deadline')).toHaveTextContent('2028-01-01T23:59');
    fireEvent.change(screen.getByLabelText('Uhrzeit'), { target: { value: '08:15' } });
    expect(screen.getByLabelText('Stored deadline')).toHaveTextContent('2028-01-01T08:15');
  });

  it('navigates months, selects leap day, and supports keyboard day movement', async () => {
    const user = userEvent.setup();
    render(<Picker initial="2028-01-29T12:30" />);
    await user.click(screen.getByRole('button', { name: 'Enddatum auswählen' }));
    await user.click(screen.getByRole('button', { name: 'Nächster Monat' }));
    const leap = screen.getByRole('button', { name: /29.*Februar 2028/ });
    await user.click(leap);
    expect(screen.getByLabelText('Stored deadline')).toHaveTextContent('2028-02-29T12:30');
    await user.keyboard('{ArrowRight}{Enter}');
    expect(screen.getByLabelText('Stored deadline')).toHaveTextContent('2028-03-01T12:30');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Enddatum auswählen' })).toHaveFocus();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('disables all date and time mutations while saving', () => {
    render(<Picker disabled initial="2028-02-29T12:30" />);
    expect(screen.getByRole('button', { name: 'Enddatum auswählen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '1d' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '1w' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '4w' })).toBeDisabled();
    expect(screen.getByLabelText('Uhrzeit')).toBeDisabled();
  });
});
