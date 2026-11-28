import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, Plus, StickyNote, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, json } from './api';
import type { Document } from './api';
import { ago, btn, Failure, field, KindIcon, label, Loading, PageHead, useData, useSession } from './ui';

// The editor (Milkdown) is large: it is only fetched when a document is opened for reading or writing.
const MarkdownEditor = lazy(() => import('./Editor'));
const EditorFallback = () => (
  <div className="min-h-24 rounded-ui bg-soft px-4 py-3 text-sm text-muted" role="status">
    Editor wird geladen …
  </div>
);
function Markdown({ value, name }: { value: string; name: string }) {
  return (
    <Suspense fallback={<div className="whitespace-pre-wrap text-[15px]">{value}</div>}>
      <MarkdownEditor value={value} readonly label={name} />
    </Suspense>
  );
}

type Kind = Document['kind'];
const KINDS: Kind[] = ['meeting', 'note'];
const kindName: Record<Kind, string> = { meeting: 'Protokoll', note: 'Notiz' };
const kindIcon: Record<Kind, LucideIcon> = { meeting: CalendarDays, note: StickyNote };

/** Plain text for the tile preview: markdown syntax removed, whitespace collapsed. */
const excerpt = (markdown: string) =>
  markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .trim()
    .replace(/\s*\n\s*/g, ' · ')
    .replace(/[*_~`#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const tile = 'flex min-h-40 min-w-0 flex-col rounded-ui p-4 transition-colors';

function KindTag({ kind }: { kind: Kind }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-pill px-2 py-0.5 text-[13px] font-semibold text-ink">
      <KindIcon icon={kindIcon[kind]} className="size-3.5" />
      {kindName[kind]}
    </span>
  );
}

function DocTile({ doc }: { doc: Document }) {
  return (
    <Link to={`/dokumente/${doc.id}`} className={`${tile} bg-soft hover:bg-pop/30 active:bg-pop/30`}>
      <span className="flex items-center gap-2 text-muted">
        <KindIcon icon={kindIcon[doc.kind]} className="size-5" />
        <span className="sr-only">{kindName[doc.kind]}</span>
        {doc.unread && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[13px] font-bold text-accent-dark">
            <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
            Geändert
          </span>
        )}
      </span>
      <span className="mt-3 break-words text-base font-extrabold leading-snug">{doc.title}</span>
      <span className="mt-1.5 line-clamp-3 break-words text-sm text-muted">{excerpt(doc.body)}</span>
      <span className="mt-auto pt-3 text-[13px] text-muted">
        {doc.updated_by.name} · {ago(doc.updated_at)}
      </span>
    </Link>
  );
}

/** Unread documents first; the server already sorts newest change first and sort is stable. */
function Tiles({ docs }: { docs: Document[] }) {
  const sorted = docs.toSorted((a, b) => Number(b.unread) - Number(a.unread));
  const unread = sorted.filter((doc) => doc.unread).length;
  return (
    <div>
      {unread > 0 && (
        <p className="mb-3 text-sm font-semibold text-accent-dark">{unread} seit deinem letzten Besuch geändert</p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          to="/dokumente/neu"
          className={`${tile} items-center justify-center gap-2 bg-pill text-[15px] font-bold text-muted hover:bg-pop hover:text-ink`}
        >
          <Plus aria-hidden="true" className="size-6" />
          Neues Dokument
        </Link>
        {sorted.map((doc) => (
          <DocTile key={doc.id} doc={doc} />
        ))}
      </div>
    </div>
  );
}

export function DocumentsPage() {
  const docs = useData<Document[]>('/documents');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind | ''>('');
  const needle = query.trim().toLowerCase();
  const filtered = (docs.data ?? []).filter(
    (doc) => (!kind || doc.kind === kind) && (!needle || (doc.title + ' ' + doc.body).toLowerCase().includes(needle)),
  );
  const chips: { value: Kind | ''; name: string }[] = [
    { value: '', name: 'Alle' },
    { value: 'meeting', name: 'Protokolle' },
    { value: 'note', name: 'Notizen' },
  ];
  return (
    <>
      <PageHead title="Dokumente">
        Protokolle und Notizen der Redaktion. Alle mit Zugang können sie lesen und bearbeiten.
      </PageHead>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <label htmlFor="doc-search" className="sr-only">
            Dokumente durchsuchen
          </label>
          <input
            id="doc-search"
            type="search"
            className={`${field} mt-0`}
            placeholder="Suchen …"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              aria-pressed={kind === chip.value}
              onClick={() => setKind(chip.value)}
              className={`min-h-11 rounded-full px-4 text-sm font-bold ${kind === chip.value ? 'bg-ink text-white' : 'bg-pill text-ink'}`}
            >
              {chip.name}
            </button>
          ))}
        </div>
      </div>
      {docs.error ? (
        <Failure error={docs.error} retry={() => docs.refetch()} />
      ) : !docs.data ? (
        <Loading />
      ) : (
        <>
          <Tiles docs={filtered} />
          {filtered.length === 0 && docs.data.length > 0 && (
            <p className="mt-4 text-sm text-muted">Kein Dokument passt zu deiner Suche.</p>
          )}
        </>
      )}
    </>
  );
}

function KindPicker({ value, onChange }: { value: Kind; onChange: (kind: Kind) => void }) {
  return (
    <div role="group" aria-label="Art" className="mt-1.5 inline-flex rounded-full bg-pill p-1">
      {KINDS.map((k) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          onClick={() => onChange(k)}
          className={`inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-bold ${value === k ? 'bg-white shadow-sm' : 'text-muted'}`}
        >
          <KindIcon icon={kindIcon[k]} />
          {kindName[k]}
        </button>
      ))}
    </div>
  );
}

const meetingTitle = () => {
  const now = new Date();
  return `Treffen ${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.`;
};
const errorText = (e: unknown) =>
  e instanceof ApiError && e.status === 403 ? 'Dafür fehlt dir die Berechtigung.' : (e as Error).message;

export function NewDocument() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [kind, setKind] = useState<Kind>('meeting');
  const [typed, setTyped] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Until the user types a title, a Protokoll gets the date prefill and a Notiz stays empty.
  const title = typed ?? (kind === 'meeting' ? meetingTitle() : '');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const doc = await api<Document>('/documents', json('POST', { title: title.trim(), kind, body }));
      await client.invalidateQueries({ queryKey: ['/documents'] });
      toast.success('Dokument gespeichert.');
      navigate(`/dokumente/${doc.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }
  return (
    <>
      <div className="mb-4">
        <Link to="/dokumente" className={`${btn.text} min-h-11`}>
          <ArrowLeft aria-hidden="true" className="size-4" /> Dokumente
        </Link>
      </div>
      <PageHead title="Neues Dokument" />
      <form className="flex max-w-3xl flex-col gap-5" onSubmit={(e) => void submit(e)}>
        <div>
          <p className={label}>Art</p>
          <KindPicker value={kind} onChange={setKind} />
        </div>
        <div>
          <label htmlFor="doc-title" className={label}>
            Titel
          </label>
          <input id="doc-title" className={field} value={title} onChange={(e) => setTyped(e.target.value)} required />
        </div>
        <div>
          <p className={label}>Inhalt</p>
          <div className="mt-1.5">
            <Suspense fallback={<EditorFallback />}>
              <MarkdownEditor value="" onChange={setBody} label="Inhalt" />
            </Suspense>
          </div>
        </div>
        {error && (
          <p role="alert" className="rounded-ui bg-bad-tint px-4 py-3 text-sm text-bad">
            {error}
          </p>
        )}
        <div>
          <button type="submit" className={btn.primary} disabled={busy || !title.trim()}>
            Speichern
          </button>
        </div>
      </form>
    </>
  );
}

export function DocumentPage() {
  const { id = '' } = useParams();
  const me = useSession();
  const navigate = useNavigate();
  const client = useQueryClient();
  const doc = useData<Document>(`/documents/${id}`);
  // Opening a document records the view on the server, so the tiles must forget their unread marker.
  useEffect(() => {
    if (doc.dataUpdatedAt) void client.invalidateQueries({ queryKey: ['/documents'] });
  }, [client, doc.dataUpdatedAt]);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<Kind>('meeting');
  const [body, setBody] = useState('');
  const [baseVersion, setBaseVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (doc.error) return <Failure error={doc.error} retry={() => doc.refetch()} />;
  if (!doc.data) return <Loading />;
  const d = doc.data;
  const mayDelete = d.created_by.id === me.user.id || me.user.role === 'admin';

  function edit() {
    setTitle(d.title);
    setKind(d.kind);
    setBody(d.body);
    setBaseVersion(d.version);
    setError('');
    setStale(false);
    setEditing(true);
  }
  async function write(fn: () => Promise<unknown>, done: () => void) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await client.invalidateQueries({ queryKey: ['/documents'] });
      done();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setStale(true);
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  const save = (e: FormEvent) => {
    e.preventDefault();
    void write(
      () => api(`/documents/${d.id}`, json('PATCH', { title: title.trim(), kind, body, version: baseVersion })),
      () => {
        setEditing(false);
        void doc.refetch();
        toast.success('Dokument gespeichert.');
      },
    );
  };
  const remove = () =>
    void write(
      () => api(`/documents/${d.id}`, json('DELETE', { version: d.version })),
      () => {
        toast.success('Dokument gelöscht.');
        navigate('/dokumente');
      },
    );

  const conflict = stale && (
    <div role="alert" className="rounded-ui bg-bad-tint px-4 py-3 text-sm text-bad">
      <p>Jemand hat das Dokument inzwischen geändert. Neu laden, um die aktuelle Fassung zu sehen.</p>
      <button
        type="button"
        className={`${btn.text} mt-2 min-h-11 text-bad`}
        onClick={() => {
          setStale(false);
          setEditing(false);
          setConfirming(false);
          void doc.refetch();
        }}
      >
        Neu laden
      </button>
    </div>
  );
  const problem = error && (
    <p role="alert" className="rounded-ui bg-bad-tint px-4 py-3 text-sm text-bad">
      {error}
    </p>
  );

  return (
    <article className="max-w-3xl">
      <div className="mb-4">
        <Link to="/dokumente" className={`${btn.text} min-h-11`}>
          <ArrowLeft aria-hidden="true" className="size-4" /> Dokumente
        </Link>
      </div>
      {editing ? (
        <form className="flex flex-col gap-5" onSubmit={save}>
          <div>
            <p className={label}>Art</p>
            <KindPicker value={kind} onChange={setKind} />
          </div>
          <div>
            <label htmlFor="doc-title" className={label}>
              Titel
            </label>
            <input id="doc-title" className={field} value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div>
            <p className={label}>Inhalt</p>
            <div className="mt-1.5">
              <Suspense fallback={<EditorFallback />}>
                <MarkdownEditor value={d.body} onChange={setBody} label="Inhalt" />
              </Suspense>
            </div>
          </div>
          {conflict}
          {problem}
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={btn.primary} disabled={busy || stale || !title.trim()}>
              Speichern
            </button>
            <button type="button" className={btn.secondary} disabled={busy} onClick={() => setEditing(false)}>
              Abbrechen
            </button>
          </div>
        </form>
      ) : (
        <>
          <KindTag kind={d.kind} />
          <h1 className="mt-3 break-words text-3xl leading-tight sm:text-4xl">{d.title}</h1>
          <p className="mt-2 text-sm text-muted">
            Zuletzt geändert von {d.updated_by.name} · {ago(d.updated_at)}
          </p>
          <div className="mt-6">
            <Markdown key={d.version} value={d.body} name={d.title} />
          </div>
          {conflict}
          {problem}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button type="button" className={btn.secondary} onClick={edit}>
              Bearbeiten
            </button>
            {mayDelete &&
              (confirming ? (
                <span className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-semibold">Dokument wirklich löschen?</span>
                  <button type="button" className={`${btn.danger} min-h-11`} disabled={busy} onClick={remove}>
                    Ja, löschen
                  </button>
                  <button type="button" className={`${btn.text} min-h-11`} onClick={() => setConfirming(false)}>
                    Abbrechen
                  </button>
                </span>
              ) : (
                <button type="button" className={`${btn.danger} min-h-11`} onClick={() => setConfirming(true)}>
                  Löschen
                </button>
              ))}
          </div>
        </>
      )}
    </article>
  );
}
