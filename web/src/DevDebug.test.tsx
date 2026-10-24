import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DevDebug } from './DevDebug';
import { Session, SubmissionList } from './ui';
import { MemoryRouter } from 'react-router-dom';

afterEach(() => vi.unstubAllEnvs());

it('starts collapsed and reveals scalar metadata when opened', () => {
  render(<DevDebug label="Poll" data={{ id: 'poll-1', status: 'open', options: 3, voted: false }}/>);

  const disclosure = screen.getByText('Debug: Poll').closest('details');
  expect(disclosure).not.toHaveAttribute('open');
  fireEvent.click(screen.getByText('Debug: Poll'));
  expect(disclosure).toHaveAttribute('open');
  expect(disclosure).toHaveTextContent('poll-1');
  expect(disclosure).toHaveTextContent('options');
});

it('renders no debug DOM when DEV is false, even when data is supplied', () => {
  vi.stubEnv('DEV', false);
  const { container } = render(<DevDebug label="Private" data={{ body: 'private sentinel' }}/>);

  expect(container).toBeEmptyDOMElement();
});

it('keeps contribution debug metadata outside its navigation link and omits private text', () => {
  const submission = {
    id: 'submission-1', category_id: 'memory', author_id: 'student-1', author_name: 'Name sentinel',
    title: 'Title sentinel', body: 'Body sentinel', context: 'Context sentinel', status: 'pending' as const, version: 2,
    created_at: '2026-10-23T12:00:00Z', updated_at: '2026-10-23T12:00:00Z', attachments: [],
  };
  render(<MemoryRouter><Session.Provider value={{ user: { id: 'student-1', name: 'Name sentinel', role: 'student', admitted: true, cohort_member: true, category_ids: [] }, csrf_token: 'secret' }}><SubmissionList items={[submission]} categories={[{ id: 'memory', name: 'Erinnerungen', description: '', kind: 'memory' }]}/></Session.Provider></MemoryRouter>);

  const disclosure = screen.getByText('Debug: Beitrag').closest('details')!;
  const link = screen.getByRole('link', { name: /Title sentinel/ });
  expect(link).not.toContainElement(disclosure);
  expect(disclosure).not.toHaveTextContent(/Title sentinel|Body sentinel|Context sentinel|Name sentinel|secret/);
  expect(disclosure).toHaveTextContent('submission-1');
});
