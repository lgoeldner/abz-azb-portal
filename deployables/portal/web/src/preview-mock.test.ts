import { beforeEach, describe, expect, it } from 'vitest';
import type { Category, Me, Submission, Ticket } from './api-types';
import {
  PREVIEW_ACCOUNTS,
  previewApi,
  resetPreviewState,
  setPreviewAccount,
  setPreviewConsentRequired,
} from './preview-mock';

const mia = PREVIEW_ACCOUNTS[0].id!;
const manager = PREVIEW_ACCOUNTS[1].id!;

beforeEach(() => {
  setPreviewAccount(mia);
  resetPreviewState();
});

describe('preview mock API', () => {
  it('switches between student, editor, consent gate, and logged-out states', async () => {
    const meStudent = await previewApi<Me>('/me');
    expect(meStudent.user.role).toBe('student');
    expect(meStudent.consent_required).toBe(false);

    const studentCats = await previewApi<Category[]>('/categories');
    expect(studentCats.some((c) => c.status === 'draft')).toBe(false);

    setPreviewAccount(manager);
    const editorCats = await previewApi<Category[]>('/categories');
    expect(editorCats.some((c) => c.status === 'draft')).toBe(true);

    setPreviewConsentRequired(true);
    expect((await previewApi<Me>('/me')).consent_required).toBe(true);
    await previewApi('/me/consent', { method: 'POST', body: JSON.stringify({ version: 'entwurf-2026-11-16' }) });
    expect((await previewApi<Me>('/me')).consent_required).toBe(false);

    await previewApi('/auth/logout', { method: 'POST' });
    await expect(previewApi('/me')).rejects.toMatchObject({ status: 401 });
  });

  it('persists ballot casts, word submissions, and text contributions in memory', async () => {
    const cats = await previewApi<Category[]>('/categories');
    const motto = cats.find((c) => c.kind === 'proposal' && c.status === 'open')!;
    await previewApi(`/categories/${motto.id}/ballot`, {
      method: 'PUT',
      body: JSON.stringify({ option_id: motto.options[0].id }),
    });
    const afterVote = (await previewApi<Category[]>('/categories')).find((c) => c.id === motto.id)!;
    expect(afterVote.my_option_id).toBe(motto.options[0].id);

    const wordsPoll = cats.find((c) => c.kind === 'words')!;
    await previewApi(`/categories/${wordsPoll.id}/ballot`, {
      method: 'PUT',
      body: JSON.stringify({ words: ['Kreativ', 'laut'] }),
    });
    const afterWords = (await previewApi<Category[]>('/categories')).find((c) => c.id === wordsPoll.id)!;
    expect(afterWords.my_words).toEqual(['kreativ', 'laut']);

    const ideas = cats.find((c) => c.kind === 'idea')!;
    const created = await previewApi<Submission>('/submissions', {
      method: 'POST',
      body: JSON.stringify({
        category_id: ideas.id,
        title: 'Testidee',
        body: 'Beschreibung',
        context: 'Vorschau',
        idempotency_key: 'k1',
      }),
    });
    expect(created.title).toBe('Testidee');
    const subs = await previewApi<Submission[]>(`/submissions?category_id=${ideas.id}`);
    expect(subs.some((s) => s.id === created.id)).toBe(true);
  });

  it('supports Redaktion ticket board transitions', async () => {
    setPreviewAccount(manager);
    const tickets = await previewApi<Ticket[]>('/tickets');
    const todo = tickets.find((t) => t.status === 'todo')!;
    const moved = await previewApi<Ticket>(`/tickets/${todo.id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: 'in_progress', version: todo.version }),
    });
    expect(moved.status).toBe('in_progress');
  });
});
