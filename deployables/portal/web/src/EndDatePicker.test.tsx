import { fireEvent, render, screen } from '@testing-library/react';

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
  it('defaults to end of day and carries the date across year boundaries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2027, 11, 31, 16, 0));
    render(<Picker />);
    fireEvent.click(screen.getByRole('button', { name: '1d' }));
    expect(screen.getByLabelText('Stored deadline')).toHaveTextContent('2028-01-01T23:59');
    fireEvent.change(screen.getByLabelText('Uhrzeit'), { target: { value: '08:15' } });
    expect(screen.getByLabelText('Stored deadline')).toHaveTextContent('2028-01-01T08:15');
  });
});
