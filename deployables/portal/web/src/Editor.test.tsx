import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import MarkdownEditor from './Editor';

// jsdom has no layout; ProseMirror asks for client rects when the selection moves.
const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
Range.prototype.getClientRects = rects;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.getClientRects = rects;

describe('MarkdownEditor', () => {
  it('shows a persistent formatting bar that formats the current block', async () => {
    const onChange = vi.fn();
    const { container } = render(<MarkdownEditor value="Hallo" onChange={onChange} />);
    const bar = screen.getByRole('toolbar', { name: 'Formatierung' });
    const h2 = within(screen.getByRole('toolbar', { name: 'Formatierung' })).getByRole('button', {
      name: 'Überschrift 2',
    });
    await waitFor(() => expect(h2).toBeEnabled(), { timeout: 5000 });
    expect(within(bar).getByRole('button', { name: 'Fett' })).toBeInTheDocument();

    const editor = container.querySelector('.ProseMirror') as HTMLElement;
    editor.focus();
    await userEvent.click(h2);
    await waitFor(() => expect(container.querySelector('.ProseMirror h2')).not.toBeNull());
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.stringContaining('## Hallo')));
  });

  it('has no formatting bar when read-only', () => {
    render(<MarkdownEditor value="Hallo" readonly />);
    expect(screen.queryByRole('toolbar')).toBeNull();
  });
});
