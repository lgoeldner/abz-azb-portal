import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  api,
  ApiError,
  canEdit,
  date,
  editorial,
  json,
  statusLabels,
  type Attachment,
  type Category,
  type Correction,
  type Revision,
  type Submission,
} from './api';
import {
  Arrow,
  Badge,
  Empty,
  Failure,
  Loading,
  PageHead,
  SubmissionList,
  btn,
  field,
  heading,
  label,
  notice,
  panel,
  useAction,
  useData,
  useSession,
} from './ui';
import { DevDebug } from './DevDebug';
function photoValidationError(files: File[]) {
  if (files.length > 10) return 'Bitte wähle höchstens 10 Bilder aus.';
  if (files.some((file) => file.size > 20 * 1024 * 1024)) return 'Jedes Bild darf höchstens 20 MiB groß sein.';
  const extensions: Record<string, string[]> = {
    'image/jpeg': ['jpg', 'jpeg'],
    'image/png': ['png'],
    'image/webp': ['webp'],
  };
  if (
    files.some((file) => {
      const extension = file.name.split('.').pop()?.toLowerCase();
      const supported = extensions[file.type];
      return !supported || !extension || !supported.includes(extension);
    })
  )
    return 'Bitte wähle nur JPEG-, PNG- oder WebP-Bilder aus.';
  return '';
}
// Submissions live only in repeatable Sammlungen.
const submittable = (c: Category) => c.repeatable;
export function Contributions() {
  const { user } = useSession();
  const categories = useData<Category[]>('/categories');
  const submissions = useData<Submission[]>('/submissions');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const own =
    submissions.data?.filter(
      (s) =>
        s.author_id === user.id &&
        (!status || s.status === status) &&
        `${s.title} ${s.body}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  return (
    <>
      <PageHead title="Meine Beiträge">
        Alles, was du beigesteuert hast. Von der ersten Idee bis zur fertigen Seite.
      </PageHead>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <label className={`${label} min-w-0 w-full sm:flex-1`}>
          Suchen
          <input
            type="search"
            className={field}
            placeholder="Geschichte finden …"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className={`${label} min-w-0 w-full sm:w-56`}>
          Status
          <select className={field} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Alle Status</option>
            {(['pending', 'accepted', 'rejected', 'withdrawn'] as const).map((s) => (
              <option key={s} value={s}>
                {statusLabels[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {submissions.isPending ? (
        <Loading />
      ) : submissions.error ? (
        <Failure error={submissions.error} retry={() => submissions.refetch()} />
      ) : own.length ? (
        <SubmissionList items={own} categories={categories.data ?? []} />
      ) : (
        <Empty>
          Noch keine Beiträge. <Link to="/">Wähle auf der Startseite eine Sammlung aus.</Link>
        </Empty>
      )}
    </>
  );
}
export function NewContribution() {
  const categories = useData<Category[]>('/categories');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const action = useAction();
  const key = useRef(crypto.randomUUID());
  const [saved, setSaved] = useState<Submission | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const category = categories.data?.find((c) => c.id === params.get('kategorie') && submittable(c));

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    await action.run(async () => {
      const invalidFiles = photoValidationError(files);
      if (invalidFiles) throw new Error(invalidFiles);

      let current =
        saved ??
        (await api<Submission>(
          '/submissions',
          json('POST', {
            idempotency_key: key.current,
            category_id: data.get('category_id'),
            title: data.get('title'),
            body: data.get('body'),
            context: data.get('context'),
          }),
        ));
      setSaved(current);
      let remaining = [...files];
      for (const file of files) {
        const upload = new FormData();
        upload.set('file', file);
        upload.set('version', String(current.version));
        current = await api<Submission>(`/submissions/${current.id}/attachments`, { method: 'POST', body: upload });
        setSaved(current);
        remaining = remaining.slice(1);
        setFiles(remaining);
      }
      navigate(`/beitraege/${current.id}`);
    });
  }

  return (
    <>
      <Link className="mb-4 inline-flex text-sm font-semibold text-muted hover:text-ink" to="/beitraege">
        ← Meine Beiträge
      </Link>
      <PageHead title={category ? `Beitrag für „${category.name}“` : 'Was sollen wir festhalten?'}>
        Dein Beitrag wird erst nach der Prüfung durch die Redaktion für die Zeitung übernommen.
      </PageHead>
      {categories.isPending ? (
        <Loading />
      ) : categories.error ? (
        <Failure error={categories.error} retry={() => categories.refetch()} />
      ) : !categories.data?.length ? (
        <Empty>Das Team richtet die Sammlungen gerade ein.</Empty>
      ) : !category ? (
        <Navigate to="/" replace />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(240px,1fr)] lg:items-start">
          <form className={`${panel} min-w-0 space-y-5`} onSubmit={submit}>
            <input type="hidden" name="category_id" value={category.id} />
            <fieldset className="min-w-0 space-y-5" disabled={action.busy || !!saved}>
              <label className={label}>
                Titel
                <input
                  className={field}
                  name="title"
                  placeholder="Gib deiner Erinnerung einen Namen"
                  maxLength={200}
                  required
                />
              </label>
              <label className={label}>
                Dein Beitrag
                <textarea
                  className={field}
                  name="body"
                  rows={7}
                  placeholder="Was ist passiert? Welcher Spruch darf nicht fehlen?"
                  maxLength={20000}
                />
              </label>
              <label className={label}>
                Kontext & Hinweise <small className="font-normal text-muted">optional</small>
                <textarea
                  className={field}
                  name="context"
                  rows={3}
                  placeholder="Wer, wann, wo? Was soll die Redaktion dazu wissen?"
                  maxLength={5000}
                />
              </label>
            </fieldset>
            <label className={label}>
              Fotos{' '}
              <small className="block font-normal text-muted">
                JPEG, PNG oder WebP, höchstens 10 Bilder, je 20 MiB und höchstens 24 Megapixel.
              </small>
              <input
                className="mt-2 block w-full text-sm text-muted file:mr-3 file:rounded-ui file:border file:border-line file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink hover:file:bg-soft"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                disabled={action.busy}
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
            </label>
            {files.length > 0 && (
              <p className="text-sm text-muted">
                {files.length} Datei(en) zum Hochladen: {files.map((f) => f.name).join(', ')}
              </p>
            )}
            {saved && (
              <p className={notice}>
                Der Text ist bereits gespeichert. Noch ausstehende Fotos kannst du erneut hochladen.{' '}
                <Link className="font-semibold underline" to={`/beitraege/${saved.id}`}>
                  Zum gespeicherten Beitrag
                </Link>
              </p>
            )}
            {action.feedback}
            {saved && action.error && files.length > 0 && (
              <button type="button" className={btn.secondary} onClick={() => navigate(`/beitraege/${saved.id}`)}>
                Ohne weitere Fotos fortfahren
              </button>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link to="/beitraege" className={btn.text}>
                Abbrechen
              </Link>
              <button className={btn.primary} disabled={action.busy}>
                {action.busy ? 'Wird gespeichert …' : saved ? 'Fotos erneut hochladen' : 'Beitrag einreichen'} <Arrow />
              </button>
            </div>
          </form>
          <aside className="rounded-ui bg-chrome p-5 text-sm text-muted sm:p-6">
            <h3 className={heading}>
              Kleine Momente.
              <br />
              Große Geschichten.
            </h3>
            <p className="mt-2">
              Ein Insider aus dem Unterricht, das beste Foto der Klassenfahrt oder eine Idee für unsere Zeitung.
            </p>
            <hr className="my-4 border-line" />
            <strong className="block text-ink">Dein Beitrag bleibt bearbeitbar.</strong>
            <p className="mt-1">Solange er in Prüfung ist, kannst du Text und Bilder jederzeit ändern.</p>
            <small className="mt-4 block">
              Bitte lade nur Bilder hoch, die du für unsere Abizeitung verwenden darfst.
            </small>
          </aside>
        </div>
      )}
    </>
  );
}
export function ContributionDetail() {
  const { id } = useParams();
  const { user } = useSession();
  const item = useData<Submission>(`/submissions/${id}`);
  const categories = useData<Category[]>('/categories');
  const revisions = useData<Revision[]>(`/submissions/${id}/revisions`);
  const corrections = useData<Correction[]>(`/submissions/${id}/corrections`);
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [baseVersion, setBaseVersion] = useState(0);
  const [draft, setDraft] = useState({
    title: '',
    body: '',
    context: '',
    category_id: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [correction, setCorrection] = useState('');
  if (item.isPending) return <Loading />;
  if (item.error) return <Failure error={item.error} retry={() => item.refetch()} />;
  const s = item.data;
  const own = s.author_id === user.id;
  const writable = (s.status === 'pending' && own) || canEdit(user, s.category_id);
  const editable = writable && (s.status === 'pending' || editorial(user));
  const categoryName = categories.data?.find((c) => c.id === s.category_id)?.name;
  const beginEdit = () => {
    setDraft({
      title: s.title,
      body: s.body,
      context: s.context,
      category_id: s.category_id,
    });
    setBaseVersion(s.version);
    setEditing(true);
  };
  const setStatus = (status: Submission['status']) =>
    action.run(async () => {
      await api(`/submissions/${id}/status`, json('POST', { version: s.version, status }));
    }, 'Status aktualisiert.');
  async function save(e: FormEvent) {
    e.preventDefault();
    await action.run(async () => {
      await api(`/submissions/${id}`, json('PATCH', { version: baseVersion, ...draft }));
      setEditing(false);
    }, 'Änderungen gespeichert.');
  }
  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    await action.run(async () => {
      const data = new FormData();
      data.set('file', file!);
      data.set('version', String(s.version));
      await api(`/submissions/${id}/attachments`, {
        method: 'POST',
        body: data,
      });
      setFile(null);
    }, 'Datei hochgeladen.');
  }
  return (
    <>
      <Link
        className="mb-4 inline-flex text-sm font-semibold text-muted hover:text-ink"
        to={own ? '/beitraege' : '/redaktion'}
      >
        ← {own ? 'Meine Beiträge' : 'Redaktion'}
      </Link>
      <PageHead title={s.title} action={<Badge status={s.status} />}>
        <span className="flex flex-wrap gap-x-2">
          {categoryName && <span>{categoryName}</span>}
          <span>Von {s.author_name}</span>
          <span>Aktualisiert am {date(s.updated_at)}</span>
          <span>Version {s.version}</span>
        </span>
      </PageHead>
      <DevDebug
        label="Beitrag"
        data={{
          id: s.id,
          category: s.category_id,
          status: s.status,
          version: s.version,
          attachments: s.attachments?.length ?? 0,
          editable,
          own,
        }}
      />
      {action.feedback}
      {action.error instanceof ApiError && action.error.status === 409 && editing && (
        <div className={`${notice} space-y-3`}>
          <button
            className={btn.secondary}
            onClick={async () => {
              const latest = await item.refetch();
              if (latest.data) setBaseVersion(latest.data.version);
            }}
          >
            Aktuelle Version laden (Eingaben behalten)
          </button>
          <p>Vergleiche den aktuellen Beitrag unter dem Formular mit deinem Entwurf, bevor du erneut speicherst.</p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(240px,1fr)] lg:items-start">
        <div className="min-w-0 space-y-6">
          {editing ? (
            <form className={`${panel} space-y-5`} onSubmit={save}>
              <label className={label}>
                Titel
                <input
                  className={field}
                  value={draft.title}
                  maxLength={200}
                  required
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </label>
              <label className={label}>
                Sammlung
                <select
                  className={field}
                  value={draft.category_id}
                  onChange={(e) => setDraft({ ...draft, category_id: e.target.value })}
                >
                  {categories.data
                    ?.filter((c) => submittable(c) && (own || canEdit(user, c.id)))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className={label}>
                Dein Beitrag
                <textarea
                  className={field}
                  rows={8}
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                />
              </label>
              <label className={label}>
                Kontext
                <textarea
                  className={field}
                  rows={3}
                  value={draft.context}
                  onChange={(e) => setDraft({ ...draft, context: e.target.value })}
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" className={btn.secondary} onClick={() => setEditing(false)}>
                  Abbrechen
                </button>
                <button className={btn.primary} disabled={action.busy}>
                  Änderungen speichern
                </button>
              </div>
            </form>
          ) : null}
          <article className={panel}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className={heading}>{editing ? 'Aktueller Stand' : 'Deine Geschichte'}</h2>
              {editable && !editing && (
                <button className={btn.secondary} onClick={beginEdit}>
                  Bearbeiten <Arrow />
                </button>
              )}
            </div>
            <p className="mt-4 whitespace-pre-wrap break-words text-[15px]">{s.body || 'Kein Text hinzugefügt.'}</p>
            {s.context && (
              <div className="mt-5 border-t border-line pt-4">
                <h3 className="text-sm font-semibold text-muted">Kontext & Hinweise</h3>
                <p className="mt-1 whitespace-pre-wrap break-words text-[15px]">{s.context}</p>
              </div>
            )}
          </article>
          <section className={panel}>
            <h2 className={heading}>
              Fotos <small className="font-normal text-muted">({s.attachments?.length ?? 0})</small>
            </h2>
            {!!s.attachments?.length && (
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {s.attachments.map((a) => (
                  <AttachmentCard
                    key={a.id}
                    attachment={a}
                    removable={editable}
                    busy={action.busy}
                    onRemove={() =>
                      action.run(
                        () => api(`/submissions/${id}/attachments/${a.id}`, json('DELETE', { version: s.version })),
                        'Datei entfernt.',
                      )
                    }
                  />
                ))}
              </div>
            )}
            {editable && (
              <form className="mt-5 flex flex-wrap items-end gap-3 border-t border-line pt-5" onSubmit={upload}>
                <label className={`${label} min-w-0 flex-1 basis-64`}>
                  Foto hinzufügen{' '}
                  <small className="block font-normal text-muted">
                    JPEG, PNG oder WebP, höchstens 10 Bilder, je 20 MiB und höchstens 24 Megapixel.
                  </small>
                  <input
                    className="mt-2 block w-full text-sm text-muted file:mr-3 file:rounded-ui file:border file:border-line file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink hover:file:bg-soft"
                    type="file"
                    required
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <button className={btn.secondary} disabled={action.busy || !file}>
                  Hochladen ↑
                </button>
              </form>
            )}
            {!s.attachments?.length && !editable && <p className="mt-3 text-sm text-muted">Keine Fotos vorhanden.</p>}
          </section>
          <section className={`${panel} space-y-4`}>
            <h2 className={heading}>Korrekturwünsche</h2>
            {corrections.isPending ? (
              <Loading />
            ) : corrections.error ? (
              <Failure error={corrections.error} />
            ) : corrections.data?.length ? (
              corrections.data.map((c) => (
                <article className="border-t border-line pt-4" key={c.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <strong>{c.author_name}</strong>
                    <small className="text-muted">
                      <span className="flex flex-wrap gap-x-2">
                        <span>{date(c.created_at)}</span>
                        <span>{c.resolved ? 'Erledigt' : 'Offen'}</span>
                      </span>
                    </small>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words">{c.body}</p>
                  {!c.resolved && canEdit(user, s.category_id) && (
                    <button
                      className={`${btn.secondary} mt-3`}
                      disabled={action.busy}
                      onClick={() =>
                        action.run(
                          () => api(`/submissions/${id}/corrections/${c.id}/resolve`, json('POST')),
                          'Korrektur als erledigt markiert.',
                        )
                      }
                    >
                      Als erledigt markieren
                    </button>
                  )}
                </article>
              ))
            ) : (
              <p className="text-sm text-muted">Noch keine Korrekturwünsche.</p>
            )}
            {own && s.status !== 'pending' && (
              <form
                className="space-y-3 border-t border-line pt-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  action.run(async () => {
                    await api(`/submissions/${id}/corrections`, json('POST', { body: correction }));
                    setCorrection('');
                  }, 'Korrekturwunsch gesendet.');
                }}
              >
                <label className={label}>
                  Änderung an die Redaktion
                  <textarea
                    className={field}
                    rows={3}
                    value={correction}
                    required
                    onChange={(e) => setCorrection(e.target.value)}
                    placeholder="Was soll korrigiert werden?"
                  />
                </label>
                <button className={btn.secondary} disabled={action.busy}>
                  Korrekturwunsch senden
                </button>
              </form>
            )}
          </section>
        </div>
        <aside className="min-w-0 space-y-6">
          <section className={`${panel} space-y-4`}>
            <h3 className={heading}>
              {s.status === 'pending' ? 'Die Redaktion liest mit.' : 'Dein Beitrag ist geprüft.'}
            </h3>
            <p className="text-sm text-muted">
              {s.status === 'pending'
                ? 'Bis zur Entscheidung kannst du deinen Beitrag noch anpassen.'
                : 'Du hast noch eine Änderung? Schicke einen Korrekturwunsch an das Team.'}
            </p>
            {own && s.status === 'pending' && (
              <button className={btn.danger} disabled={action.busy} onClick={() => setStatus('withdrawn')}>
                Beitrag zurückziehen
              </button>
            )}
            {canEdit(user, s.category_id) &&
              (s.status === 'pending' ? (
                <div className="flex flex-col gap-3">
                  <button
                    className={editing ? btn.secondary : btn.primary}
                    disabled={action.busy}
                    onClick={() => setStatus('accepted')}
                  >
                    Für die Zeitung annehmen ✓
                  </button>
                  <button className={btn.danger} disabled={action.busy} onClick={() => setStatus('rejected')}>
                    Ablehnen
                  </button>
                </div>
              ) : (
                <button className={btn.secondary} disabled={action.busy} onClick={() => setStatus('pending')}>
                  Erneut zur Prüfung öffnen
                </button>
              ))}
            {editorial(user) && !canEdit(user, s.category_id) && (
              <p className="text-sm text-muted">
                Du hast Leserechte. Zum Bearbeiten brauchst du eine Zuweisung zu dieser Sammlung.
              </p>
            )}
          </section>
          <section className={panel}>
            <h3 className={heading}>Versionsverlauf</h3>
            {revisions.isPending ? (
              <Loading />
            ) : revisions.error ? (
              <Failure error={revisions.error} />
            ) : (
              revisions.data?.map((r) => (
                <details className="mt-3 border-t border-line pt-3 text-sm" key={r.id}>
                  <summary className="cursor-pointer">
                    <strong>Version {r.version}</strong>{' '}
                    <small className="text-muted">
                      <span className="flex flex-wrap gap-x-2">
                        <span>{r.actor_name}</span>
                        <span>{date(r.created_at)}</span>
                      </span>
                    </small>
                  </summary>
                  <div className="mt-3 space-y-2">
                    <Badge status={r.status} />
                    <h4 className="font-semibold">{r.title}</h4>
                    <p className="whitespace-pre-wrap break-words">{r.body}</p>
                    {r.context && <p className="whitespace-pre-wrap break-words text-muted">{r.context}</p>}
                  </div>
                </details>
              ))
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
function AttachmentCard({
  attachment: a,
  removable,
  busy,
  onRemove,
}: {
  attachment: Attachment;
  removable: boolean;
  busy: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm">
      {a.mime_type.startsWith('image/') && (
        <a href={a.url} target="_blank" rel="noreferrer">
          <img
            className="aspect-[4/3] w-full rounded-ui bg-pill object-cover"
            src={a.preview_url}
            alt={a.filename}
            loading="lazy"
          />
        </a>
      )}
      <a className="min-w-0 break-words font-semibold underline" href={a.url} target="_blank" rel="noreferrer">
        {a.filename} ↗
      </a>
      <small className="text-muted">{(a.size_bytes / 1024).toFixed(0)} KB</small>
      {removable && (
        <button type="button" className={btn.danger} disabled={busy} onClick={onRemove}>
          Datei entfernen
        </button>
      )}
    </div>
  );
}
export function Editorial() {
  const categories = useData<Category[]>('/categories');
  const [params, setParams] = useSearchParams();
  const category = params.get('sammlung') ?? '';
  const setCategory = (id: string) => setParams(id ? { sammlung: id } : {}, { replace: true });
  const sammlungen = categories.data?.filter(submittable) ?? [];
  const [status, setStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const { user } = useSession();
  const path = `/submissions?${new URLSearchParams({
    category_id: category,
    status,
    q: search,
  })}`;
  const items = useData<Submission[]>(path);
  const [exportStatus, setExportStatus] = useState('accepted');
  return (
    <>
      <PageHead title="Aus Geschichten wird Zeitung.">
        Alle Beiträge im Blick. Du bearbeitest die Sammlungen, die dir zugewiesen sind.
      </PageHead>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <label className={`${label} min-w-0 w-full sm:w-56`}>
          Sammlung
          <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Alle Sammlungen</option>
            {sammlungen.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {canEdit(user, c.id) ? ' (zugewiesen)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className={`${label} min-w-0 w-full sm:w-48`}>
          Status
          <select className={field} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Alle Status</option>
            {(['pending', 'accepted', 'rejected', 'withdrawn'] as const).map((s) => (
              <option key={s} value={s}>
                {statusLabels[s]}
              </option>
            ))}
          </select>
        </label>
        <label className={`${label} min-w-0 w-full sm:flex-1`}>
          Suchen
          <input
            type="search"
            className={field}
            value={search}
            placeholder="Titel, Text, Name …"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {items.isPending ? (
        <Loading />
      ) : items.error ? (
        <Failure error={items.error} retry={() => items.refetch()} />
      ) : items.data?.length ? (
        <SubmissionList items={items.data} categories={categories.data ?? []} showAuthor />
      ) : (
        <Empty>In dieser Auswahl sind noch keine Beiträge.</Empty>
      )}
      <section className={`${panel} mt-10 flex flex-wrap items-end justify-between gap-6`}>
        <div className="min-w-0 max-w-md">
          <h2 className={heading}>Eine Sammlung exportieren</h2>
          <p className="mt-1 text-sm text-muted">
            ZIP mit CSV, Originaldateien und Manifest. Stimmdaten sind nicht enthalten.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className={`${label} min-w-0 w-full sm:w-56`}>
            Sammlung
            <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Sammlung auswählen</option>
              {sammlungen.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className={`${label} min-w-0 w-full sm:w-56`}>
            Umfang
            <select className={field} value={exportStatus} onChange={(e) => setExportStatus(e.target.value)}>
              <option value="accepted">Nur angenommene Beiträge</option>
              <option value="all">Alle Beiträge inklusive abgelehnter</option>
            </select>
          </label>
          {category ? (
            <a className={btn.primary} href={`/api/v1/categories/${category}/export?status=${exportStatus}`}>
              ZIP herunterladen ↓
            </a>
          ) : (
            <button className={btn.primary} disabled>
              Sammlung auswählen
            </button>
          )}
        </div>
      </section>
    </>
  );
}
export function NotFound() {
  return (
    <>
      <PageHead title="Diese Seite ist nicht verfügbar.">
        Vielleicht wurde der Link geändert oder du hast keinen Zugriff.
      </PageHead>
      <Link className={btn.primary} to="/">
        Zur Übersicht <Arrow />
      </Link>
    </>
  );
}
