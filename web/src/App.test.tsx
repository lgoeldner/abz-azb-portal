import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

const user = { id: 'student-1', name: 'Mia Beispiel', role: 'student', admitted: true, cohort_member: true, category_ids: [] };
const category = { id: 'memory', name: 'Erinnerungen', description: 'Was bleibt', kind: 'memory' };

it('starts provider login without fetching identities from the portal', async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) => Response.json({ error: { code: 'unauthorized', message: 'Bitte anmelden.' } }, { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><App/></MemoryRouter></QueryClientProvider>);

  expect(await screen.findByRole('link', { name: /Mit Schulkonto anmelden/ })).toHaveAttribute('href', '/auth/login');
  expect(fetchMock.mock.calls.every(call => String(call[0]) === '/api/v1/me')).toBe(true);
});

describe('contribution submission', () => {
  it('keeps entered fields visible when the server rejects a stale submission', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/me')) return Response.json({ user, csrf_token: 'csrf' });
      if (url.endsWith('/api/v1/categories')) return Response.json([category]);
      if (url === '/api/v1/submissions') return Response.json({ error: { code: 'stale_version', message: 'Bitte erneut prüfen.' } }, { status: 409 });
      return Response.json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/beitraege/neu']}><App/></MemoryRouter></QueryClientProvider>);

    const title = await screen.findByPlaceholderText('Gib deiner Erinnerung einen Namen');
    fireEvent.change(title, { target: { value: 'Die letzte Freistunde' } });
    fireEvent.change(screen.getByPlaceholderText('Was ist passiert? Welcher Spruch darf nicht fehlen?'), { target: { value: 'Wir waren alle dabei.' } });
    fireEvent.click(screen.getByRole('button', { name: /Beitrag einreichen/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Eine neuere Version liegt vor.'));
    expect(title).toHaveValue('Die letzte Freistunde');
    expect(screen.getByDisplayValue('Wir waren alle dabei.')).toBeInTheDocument();
  });

  it('rejects an unsupported file before creating a contribution and preserves the form', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/me')) return Response.json({ user, csrf_token: 'csrf' });
      if (url.endsWith('/api/v1/categories')) return Response.json([category]);
      return Response.json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/beitraege/neu']}><App/></MemoryRouter></QueryClientProvider>);

    const title = await screen.findByPlaceholderText('Gib deiner Erinnerung einen Namen');
    fireEvent.change(title, { target: { value: 'Die letzte Freistunde' } });
    fireEvent.change(screen.getByLabelText(/höchstens 10 Bilder/), {
      target: { files: [new File(['PDF test'], 'notizen.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Beitrag einreichen/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Bitte wähle nur JPEG-, PNG- oder WebP-Bilder aus.'));
    expect(fetchMock).not.toHaveBeenCalledWith('/api/v1/submissions', expect.anything());
    expect(title).toHaveValue('Die letzte Freistunde');
  });

  it('lets a student replace a rejected photo and retry without creating another contribution', async () => {
    const submission = {
      id: 'new-submission', category_id: 'memory', author_id: user.id, author_name: user.name,
      title: 'Das letzte Schulfest', body: 'Wir waren alle dabei.', context: '', status: 'pending', version: 1,
      created_at: '2026-10-23T12:00:00Z', updated_at: '2026-10-23T12:00:00Z', attachments: [],
    };
    let uploadCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/me')) return Response.json({ user, csrf_token: 'csrf' });
      if (url.endsWith('/api/v1/categories')) return Response.json([category]);
      if (url === '/api/v1/submissions' && init?.method === 'POST') return Response.json(submission, { status: 201 });
      if (url === '/api/v1/submissions/new-submission/attachments' && init?.method === 'POST') {
        uploadCount += 1;
        if (uploadCount === 1) return Response.json({ error: { code: 'invalid_image', message: 'Das Foto ist ungültig.' } }, { status: 400 });
        return Response.json({ ...submission, version: 2 });
      }
      if (url === '/api/v1/submissions/new-submission') return Response.json({ ...submission, version: 2 });
      if (url.endsWith('/revisions') || url.endsWith('/corrections')) return Response.json([]);
      return Response.json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/beitraege/neu']}><App/></MemoryRouter></QueryClientProvider>);

    const title = await screen.findByPlaceholderText('Gib deiner Erinnerung einen Namen');
    fireEvent.change(title, { target: { value: submission.title } });
    fireEvent.change(screen.getByPlaceholderText('Was ist passiert? Welcher Spruch darf nicht fehlen?'), { target: { value: submission.body } });
    const photoPicker = screen.getByLabelText(/höchstens 10 Bilder/);
    fireEvent.change(photoPicker, { target: { files: [new File(['bad'], 'bad.jpg', { type: 'image/jpeg' })] } });
    fireEvent.click(screen.getByRole('button', { name: /Beitrag einreichen/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Das Foto ist ungültig.'));
    expect(screen.getByRole('button', { name: 'Ohne weitere Fotos fortfahren' })).toBeInTheDocument();
    expect(photoPicker).toBeEnabled();
    fireEvent.change(photoPicker, { target: { files: [new File(['replacement'], 'replacement.jpg', { type: 'image/jpeg' })] } });
    fireEvent.click(screen.getByRole('button', { name: /Fotos erneut hochladen/ }));

    await screen.findByRole('heading', { name: submission.title });
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url) === '/api/v1/submissions' && init?.method === 'POST')).toHaveLength(1);
    expect(uploadCount).toBe(2);
  });
});

describe('admin access editing', () => {
  it('loads role and category grants for the newly selected person before saving', async () => {
    const admin = { id: 'admin-1', name: 'Test Admin', role: 'admin', admitted: true, cohort_member: false, category_ids: ['memory'] };
    const student = { id: 'student-2', name: 'Test Student', role: 'student', admitted: true, cohort_member: true, category_ids: [] };
    const categories = [category, { id: 'quotes', name: 'Zitate', description: '', kind: 'quote' }];
    let saved: { role: string; category_ids: string[] } | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/me')) return Response.json({ user: admin, csrf_token: 'csrf' });
      if (url.endsWith('/api/v1/admin/users') && !init?.method) return Response.json([admin, student]);
      if (url.endsWith('/api/v1/categories')) return Response.json(categories);
      if (url.endsWith('/api/v1/admin/status')) return Response.json({ backup_last_success: null, backup_stale: false, upload_bytes: 0 });
      if (url.endsWith('/api/v1/admin/users/student-2') && init?.method === 'PATCH') {
        saved = JSON.parse(String(init.body));
        return Response.json(student);
      }
      return Response.json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/admin']}><App/></MemoryRouter></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Unser Jahrgang & Team' });
    fireEvent.click(await screen.findByRole('button', { name: 'Test Admin bearbeiten' }));
    expect(screen.getByLabelText('Rolle')).toHaveValue('admin');
    fireEvent.click(screen.getByRole('button', { name: 'Test Student bearbeiten' }));

    expect(screen.getByLabelText('Rolle')).toHaveValue('student');
    expect(screen.getByLabelText('Erinnerungen')).not.toBeChecked();
    expect(screen.getByLabelText('Zitate')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Zugang speichern' }));

    await waitFor(() => expect(saved).toEqual(expect.objectContaining({ role: 'student', category_ids: [] })));
  });
});
