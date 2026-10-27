import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  api,
  ApiError,
  canEdit,
  date,
  json,
  statusLabels,
  type Category,
  type Correction,
  type MyBallot,
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
  isSubmissionCollection,
  useAction,
  useData,
  useSession,
  useWorkspaceView,
} from './ui';
import { DevDebug } from './DevDebug';
import { PhotoGallery } from './PhotoGallery';

type SelectedImage = { file: File; caption: string };

function photoValidationError(files: File[], alreadyAttached = 0) {
  if (files.length + alreadyAttached > 10) return 'Bitte wähle höchstens 10 Bilder aus.';
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
const submittable = (c: Category) => isSubmissionCollection(c.kind);
export function Contributions() {
  const { user } = useSession();
  const categories = useData<Category[]>('/categories');
  const submissions = useData<Submission[]>('/submissions');
  const ballots = useData<MyBallot[]>('/me/ballots');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const needle = search.toLowerCase();
  const own =
    submissions.data?.filter(
      (s) =>
        s.author_id === user.id &&
        (!status || (status !== 'voted' && s.status === status)) &&
        `${s.title} ${s.body} ${categories.data?.find((c) => c.id === s.category_id)?.name ?? ''} ${s.attachments.map((a) => `${a.filename} ${a.caption}`).join(' ')}`
          .toLowerCase()
          .includes(needle),
    ) ?? [];
  const ownBallots =
    ballots.data?.filter(
      (ballot) => (status === '' || status === 'voted') && ballot.category_name.toLowerCase().includes(needle),
    ) ?? [];
  return (
    <>
      <PageHead title="Meine Beiträge">
        Deine Beiträge und abgegebenen Stimmen in den Sammlungen des Jahrgangs.
      </PageHead>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <label className={`${label} min-w-0 w-full sm:flex-1`}>
          Suchen
          <input
            type="search"
            className={field}
            placeholder="Beitrag oder Sammlung finden …"
            maxLength={200}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className={`${label} min-w-0 w-full sm:w-56`}>
          Status
          <select className={field} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Alle Status</option>
            <option value="voted">Abgestimmt</option>
            {(['pending', 'accepted', 'rejected', 'withdrawn'] as const).map((s) => (
              <option key={s} value={s}>
                {statusLabels[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {submissions.isPending || categories.isPending || ballots.isPending ? (
        <Loading />
      ) : submissions.error || categories.error || ballots.error ? (
        <Failure
          error={(submissions.error ?? categories.error ?? ballots.error)!}
          retry={() => {
            submissions.refetch();
            categories.refetch();
            ballots.refetch();
          }}
        />
      ) : own.length || ownBallots.length ? (
        <SubmissionList items={own} categories={categories.data ?? []} ballots={ownBallots} />
      ) : (
        <Empty>
          Noch keine Beiträge. <Link to="/">Wähle auf der Startseite eine Sammlung aus.</Link>
        </Empty>
      )}
    </>
  );
}
export function NewContribution() {
  const [view] = useWorkspaceView();
  const { user } = useSession();
  const categories = useData<Category[]>('/categories');
  const submissions = useData<Submission[]>('/submissions');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const action = useAction();
  const key = useRef(crypto.randomUUID());
  const [saved, setSaved] = useState<Submission | null>(null);
  const [images, setImages] = useState<SelectedImage[]>([]);
  const category = categories.data?.find((c) => c.id === params.get('kategorie') && submittable(c));
  const isPhoto = category?.kind === 'photo';
  const isQuote = category?.kind === 'quote';
  const savedDestination = saved && isPhoto ? `/sammlungen/${saved.category_id}` : `/beitraege/${saved?.id}`;
  const backDestination = isPhoto ? `/sammlungen/${category.id}` : '/beitraege';
  const own = submissions.data?.filter((s) => s.author_id === user.id) ?? [];
  const existing =
    !saved && category && !category.repeatable ? own.find((s) => s.category_id === category.id) : undefined;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!category) return;
    const data = new FormData(e.currentTarget);
    await action.run(async () => {
      // The form can survive a collection query change. Never let stale image
      // selections turn a text submission into attachment uploads.
      const selectedImages = isPhoto ? images : [];
      const files = selectedImages.map((image) => image.file);
      const invalidFiles = photoValidationError(
        files,
        saved?.attachments.length ?? (isPhoto ? existing?.attachments.length : 0) ?? 0,
      );
      if (invalidFiles) throw new Error(invalidFiles);
      if (isPhoto && !saved && !images.length) throw new Error('Bitte wähle mindestens ein Foto aus.');

      let current = saved ?? (isPhoto ? (existing ?? null) : null);
      let remaining = [...selectedImages];
      if (!current && isPhoto) {
        const first = remaining.shift();
        if (!first) throw new Error('Bitte wähle mindestens ein Foto aus.');
        const create = new FormData();
        create.set('category_id', category.id);
        create.set('idempotency_key', key.current);
        create.set('file', first.file);
        if (first.caption.trim()) create.set('caption', first.caption);
        current = await api<Submission>('/submissions', { method: 'POST', body: create });
        setSaved(current);
        setImages([...remaining]);
      } else if (!current) {
        current = await api<Submission>(
          '/submissions',
          json('POST', {
            idempotency_key: key.current,
            category_id: category.id,
            title: data.get('title'),
            body: data.get('body'),
            context: data.get('context'),
          }),
        );
        setSaved(current);
      }
      for (const image of remaining) {
        const upload = new FormData();
        upload.set('file', image.file);
        upload.set('version', String(current.version));
        if (image.caption.trim()) upload.set('caption', image.caption);
        current = await api<Submission>(`/submissions/${current.id}/attachments`, { method: 'POST', body: upload });
        setSaved(current);
        remaining = remaining.slice(1);
        setImages([...remaining]);
      }
      if (current) navigate(isPhoto ? `/sammlungen/${current.category_id}` : `/beitraege/${current.id}`);
    });
  }

  if (view === 'redaktion') return <Navigate to="/redaktion" replace />;

  return (
    <>
      <Link className="mb-4 inline-flex text-sm font-semibold text-muted hover:text-ink" to={backDestination}>
        ← {isPhoto ? 'Zur Fotosammlung' : 'Meine Beiträge'}
      </Link>
      <PageHead
        title={
          category
            ? isPhoto
              ? `Fotos für „${category.name}“`
              : `Beitrag für „${category.name}“`
            : 'Was sollen wir festhalten?'
        }
      >
        {isPhoto
          ? 'Lade mindestens ein Foto hoch. Zu jedem Bild kannst du einen optionalen Bildtext hinzufügen.'
          : 'Dein Beitrag wird in der Sammlung gespeichert. Die Redaktion sichtet die Sammlung nach dem Sammelzeitraum.'}
      </PageHead>
      {categories.isPending || submissions.isPending ? (
        <Loading />
      ) : categories.error || submissions.error ? (
        <Failure
          error={(categories.error ?? submissions.error)!}
          retry={() => {
            categories.refetch();
            submissions.refetch();
          }}
        />
      ) : !categories.data?.length ? (
        <Empty>Das Team richtet die Sammlungen gerade ein.</Empty>
      ) : existing && (!isPhoto || existing.status !== 'pending') ? (
        <Empty>
          Du hast bereits einen Beitrag in dieser Sammlung.{' '}
          <Link to={`/beitraege/${existing.id}`}>Zum gespeicherten Beitrag</Link>
        </Empty>
      ) : category && category.status !== 'open' && !saved ? (
        <Empty>Neue Beiträge können nur in offenen Sammlungen eingereicht werden.</Empty>
      ) : !category ? (
        <Navigate to="/" replace />
      ) : (
        <div
          className={`grid grid-cols-1 gap-6 ${isQuote ? '' : 'lg:grid-cols-[minmax(0,1.7fr)_minmax(240px,1fr)] lg:items-start'}`}
        >
          <form
            key={category.id}
            className={`${panel} min-w-0 space-y-5 ${isQuote ? 'quote-submission-form' : ''}`}
            onSubmit={submit}
          >
            {!isPhoto && (
              <fieldset
                className={`min-w-0 ${isQuote ? 'quote-fields' : 'space-y-5'}`}
                disabled={action.busy || !!saved}
              >
                {isQuote ? (
                  <>
                    <label className={`${label} quote-writing-label`}>
                      Dein Zitat
                      <span className="quote-paper">
                        <span className="quote-mark quote-mark-open" aria-hidden="true">
                          „
                        </span>
                        <textarea
                          className="quote-textarea"
                          name="body"
                          rows={4}
                          placeholder="Dieser eine Satz …"
                          maxLength={20000}
                        />
                        <span className="quote-mark quote-mark-close" aria-hidden="true">
                          “
                        </span>
                      </span>
                    </label>
                    <label className={`${label} quote-attribution-label`}>
                      Zitat von
                      <input
                        className="quote-attribution"
                        name="title"
                        placeholder="Name oder Quelle"
                        maxLength={200}
                        required
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label className={label}>
                      Titel
                      <input
                        className={field}
                        name="title"
                        placeholder="Gib deinem Beitrag einen Namen"
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
                        placeholder="Was soll die Redaktion dazu wissen?"
                        maxLength={20000}
                      />
                    </label>
                  </>
                )}
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
            )}
            {isPhoto && (
              <label className={label}>
                Fotos{' '}
                <small className="block font-normal text-muted">
                  Mindestens ein Foto. JPEG, PNG oder WebP, höchstens 10 Bilder, je 20 MiB und höchstens 24 Megapixel.
                  Pro Bild passt ein Bildtext.
                </small>
                <input
                  className="mt-2 block w-full text-sm text-muted file:mr-3 file:rounded-ui file:border file:border-line file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink hover:file:bg-soft"
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  disabled={action.busy}
                  required={Boolean(!saved && images.length === 0)}
                  onChange={(e) => {
                    const selected = Array.from(e.target.files ?? []).map((file) => ({ file, caption: '' }));
                    setImages((current) => [...current, ...selected]);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            )}
            {isPhoto && !!images.length && (
              <ul className="space-y-3" aria-label="Ausgewählte Fotos">
                {images.map((image, index) => (
                  <li
                    key={`${image.file.name}-${image.file.size}-${image.file.lastModified}-${index}`}
                    className="rounded-ui border border-line bg-white p-3 sm:p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="min-w-0 break-all text-sm">{image.file.name}</strong>
                      <button
                        type="button"
                        className={btn.text}
                        disabled={action.busy}
                        onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                      >
                        Entfernen
                      </button>
                    </div>
                    <label className={`${label} mt-3`}>
                      Bildtext <small className="font-normal text-muted">optional</small>
                      <textarea
                        className={field}
                        rows={2}
                        maxLength={2000}
                        value={image.caption}
                        disabled={action.busy}
                        onChange={(e) =>
                          setImages((current) =>
                            current.map((candidate, i) =>
                              i === index ? { ...candidate, caption: e.target.value } : candidate,
                            ),
                          )
                        }
                      />
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {saved && (
              <p className={notice}>
                {isPhoto
                  ? 'Das erste Foto ist gespeichert. Noch ausstehende Fotos kannst du erneut hochladen.'
                  : 'Der Text ist bereits gespeichert. Noch ausstehende Fotos kannst du erneut hochladen.'}{' '}
                <Link className="font-semibold underline" to={savedDestination}>
                  {isPhoto ? 'Zur Fotosammlung' : 'Zum gespeicherten Beitrag'}
                </Link>
              </p>
            )}
            {action.feedback}
            {saved && action.error && images.length > 0 && (
              <button type="button" className={btn.secondary} onClick={() => navigate(savedDestination)}>
                Ohne weitere Fotos fortfahren
              </button>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link to={backDestination} className={btn.text}>
                Abbrechen
              </Link>
              <button className={btn.primary} disabled={action.busy || (isPhoto && !saved && images.length === 0)}>
                {action.busy
                  ? 'Wird gespeichert …'
                  : isPhoto
                    ? saved
                      ? 'Weitere Fotos hochladen'
                      : 'Fotos einreichen'
                    : saved
                      ? 'Fotos erneut hochladen'
                      : 'Beitrag einreichen'}{' '}
                <Arrow />
              </button>
            </div>
          </form>
          <aside className={`rounded-ui bg-chrome p-5 text-sm text-muted sm:p-6 ${isQuote ? 'quote-support' : ''}`}>
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
            <p className="mt-1">Solange dein Beitrag eingereicht ist, kannst du Text und Bilder jederzeit ändern.</p>
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
  const location = useLocation();
  const { user } = useSession();
  const [view] = useWorkspaceView();
  const isRedaktion = view === 'redaktion' || location.pathname.startsWith('/redaktion');
  const item = useData<Submission>(`/submissions/${id}`);
  const categories = useData<Category[]>('/categories');
  const submissions = useData<Submission[]>('/submissions', !isRedaktion);
  const revisions = useData<Revision[]>(`/submissions/${id}/revisions`);
  const corrections = useData<Correction[]>(`/submissions/${id}/corrections`);
  const queryClient = useQueryClient();
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
  const [caption, setCaption] = useState('');
  const [correction, setCorrection] = useState('');
  if (item.isPending) return <Loading />;
  if (item.error) return <Failure error={item.error} retry={() => item.refetch()} />;
  const s = item.data;
  const own = s.author_id === user.id;
  const editable = own && s.status === 'pending' && !isRedaktion;
  const occupied = new Set(
    (submissions.data ?? [])
      .filter((other) => other.id !== s.id && other.author_id === s.author_id)
      .map((other) => other.category_id),
  );
  const categoryChoices = (categories.data ?? []).filter(
    (c) =>
      c.id === s.category_id ||
      (c.status === 'open' &&
        submittable(c) &&
        (!s.attachments.length || c.kind === 'photo') &&
        (c.kind !== 'photo' || (!s.body.trim() && s.attachments.length > 0)) &&
        (own || canEdit(user, c.id)) &&
        (c.repeatable || (!submissions.isPending && !submissions.error && !occupied.has(c.id)))),
  );
  const categoryName = categories.data?.find((c) => c.id === s.category_id)?.name;
  const categoryKind = categories.data?.find((c) => c.id === s.category_id)?.kind;
  const isPhoto = categoryKind === 'photo';
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
      if (caption.trim()) data.set('caption', caption);
      await api(`/submissions/${id}/attachments`, {
        method: 'POST',
        body: data,
      });
      setFile(null);
      setCaption('');
    }, 'Datei hochgeladen.');
  }
  const annotationPanel = (
    <section className={`${panel} space-y-4`}>
      <h2 className={heading}>Anmerkungen</h2>
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
            {!c.resolved && isRedaktion && canEdit(user, s.category_id) && (
              <button
                className={`${btn.secondary} mt-3`}
                disabled={action.busy}
                onClick={() =>
                  action.run(
                    () => api(`/submissions/${id}/corrections/${c.id}/resolve`, json('POST')),
                    'Anmerkung als erledigt markiert.',
                  )
                }
              >
                Als erledigt markieren
              </button>
            )}
          </article>
        ))
      ) : (
        <p className="text-sm text-muted">Noch keine Anmerkungen.</p>
      )}
      {isRedaktion && canEdit(user, s.category_id) && (
        <form
          className="space-y-3 border-t border-line pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            action.run(async () => {
              await api(`/submissions/${id}/corrections`, json('POST', { body: correction }));
              setCorrection('');
            }, 'Anmerkung gespeichert.');
          }}
        >
          <label className={label}>
            Anmerkung
            <textarea
              className={field}
              rows={3}
              value={correction}
              maxLength={10000}
              required
              onChange={(e) => setCorrection(e.target.value)}
              placeholder="Optionale Anmerkung zu diesem Beitrag"
            />
          </label>
          <button className={btn.secondary} disabled={action.busy}>
            Anmerkung speichern
          </button>
        </form>
      )}
      {!isRedaktion && own && s.status !== 'pending' && (
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
            Korrekturwunsch an die Redaktion
            <textarea
              className={field}
              rows={3}
              value={correction}
              maxLength={10000}
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
  );
  return (
    <>
      <Link
        className="mb-4 inline-flex text-sm font-semibold text-muted hover:text-ink"
        to={isRedaktion ? `/sammlungen/${s.category_id}` : own ? '/beitraege' : '/redaktion'}
      >
        ← {isRedaktion ? 'Zur Sammlung' : own ? 'Meine Beiträge' : 'Redaktion'}
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
          {editing && editable && !isPhoto ? (
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
                  {categoryChoices.map((c) => (
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
          {(!isPhoto || s.body || s.context) && (
            <article className={panel}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className={heading}>
                  {isPhoto
                    ? 'Älterer Textbeitrag'
                    : editing && editable
                      ? 'Aktueller Stand'
                      : isRedaktion
                        ? 'Beitrag'
                        : 'Dein Beitrag'}
                </h2>
                {editable && !isPhoto && !editing && (
                  <button className={btn.secondary} onClick={beginEdit}>
                    Bearbeiten <Arrow />
                  </button>
                )}
              </div>
              {(s.body || !isPhoto) && (
                <p className="mt-4 whitespace-pre-wrap break-words text-[15px]">{s.body || 'Kein Text hinzugefügt.'}</p>
              )}
              {s.context && (
                <div className="mt-5 border-t border-line pt-4">
                  <h3 className="text-sm font-semibold text-muted">Kontext & Hinweise</h3>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[15px]">{s.context}</p>
                </div>
              )}
            </article>
          )}
          {(isPhoto || !!s.attachments?.length) && (
            <section className={panel}>
              <h2 className={heading}>
                {isPhoto ? 'Deine Fotos' : 'Fotos'}{' '}
                <small className="font-normal text-muted">({s.attachments?.length ?? 0})</small>
              </h2>
              {!!s.attachments?.length && (
                <div className="mt-4">
                  <PhotoGallery
                    photos={s.attachments}
                    allowCaptionEdit={editable}
                    busy={action.busy}
                    onSaveCaption={async (attachmentId, value) => {
                      try {
                        await api<Submission>(
                          `/submissions/${id}/attachments/${attachmentId}`,
                          json('PATCH', { version: s.version, caption: value }),
                        );
                      } finally {
                        await queryClient.invalidateQueries();
                      }
                    }}
                    canRemove={() =>
                      editable && categoryKind !== undefined && (categoryKind !== 'photo' || s.attachments.length > 1)
                    }
                    onRemove={(photo) =>
                      action.run(
                        () => api(`/submissions/${id}/attachments/${photo.id}`, json('DELETE', { version: s.version })),
                        'Foto entfernt.',
                      )
                    }
                  />
                </div>
              )}
              {editable && isPhoto && (
                <form className="mt-5 flex flex-wrap items-end gap-3 border-t border-line pt-5" onSubmit={upload}>
                  <div className="min-w-0 flex-1 basis-64 space-y-3">
                    <label className={`${label} block`}>
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
                    <label className={`${label} block`}>
                      Bildtext <small className="font-normal text-muted">optional</small>
                      <textarea
                        className={field}
                        rows={2}
                        maxLength={2000}
                        value={caption}
                        onChange={(e) => setCaption(e.target.value)}
                      />
                    </label>
                  </div>
                  <button className={btn.secondary} disabled={action.busy || !file}>
                    Hochladen ↑
                  </button>
                </form>
              )}
              {!s.attachments?.length && isPhoto && editable && (
                <p className="mt-3 text-sm text-muted">
                  Dieser ältere Eintrag hat noch kein Foto. Du kannst es hier ergänzen.
                </p>
              )}
              {!s.attachments?.length && !editable && <p className="mt-3 text-sm text-muted">Keine Fotos vorhanden.</p>}
            </section>
          )}
          {!isRedaktion && annotationPanel}
        </div>
        <aside className="min-w-0 space-y-6">
          <section className={`${panel} space-y-4`}>
            <h3 className={heading}>{isRedaktion ? 'Beitragsdetails' : 'Dein Beitrag'}</h3>
            {isRedaktion ? (
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-muted">Eingegangen</dt>
                  <dd>{date(s.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Sammlung</dt>
                  <dd>{categoryName ?? 'Beitrag'}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted">
                {isPhoto && s.status === 'pending'
                  ? 'Du kannst deine Fotos und Bildtexte noch anpassen.'
                  : s.status === 'pending'
                    ? 'Du kannst deinen eingereichten Beitrag noch anpassen.'
                    : 'Du kannst eine Änderung als Korrekturwunsch an die Redaktion senden.'}
              </p>
            )}
            {!isRedaktion && own && s.status === 'pending' && (
              <button className={btn.danger} disabled={action.busy} onClick={() => setStatus('withdrawn')}>
                Beitrag zurückziehen
              </button>
            )}
            {isRedaktion && !canEdit(user, s.category_id) && (
              <p className="text-sm text-muted">
                Du hast Leserechte. Für Anmerkungen brauchst du eine Zuweisung zu dieser Sammlung.
              </p>
            )}
          </section>
          {isRedaktion && annotationPanel}
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
                    {!!r.attachments.length && (
                      <ul className="border-t border-line pt-2 text-muted">
                        {r.attachments.map((attachment) => (
                          <li key={attachment.id}>
                            {attachment.filename}
                            {attachment.caption && <span> · {attachment.caption}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
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
export function Editorial() {
  const categories = useData<Category[]>('/categories');
  const [params, setParams] = useSearchParams();
  const category = params.get('sammlung') ?? '';
  const setCategory = (id: string) => setParams(id ? { sammlung: id } : {}, { replace: true });
  const sammlungen = categories.data?.filter(submittable) ?? [];
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const { user } = useSession();
  const path = `/submissions?${new URLSearchParams({
    category_id: category,
    status,
    q: search,
  })}`;
  const items = useData<Submission[]>(path);
  const [exportStatus, setExportStatus] = useState('all');
  return (
    <>
      <PageHead title="Beiträge">Beiträge aus allen Sammlungen und Status.</PageHead>
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
            maxLength={200}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {items.isPending ? (
        <Loading />
      ) : items.error ? (
        <Failure error={items.error} retry={() => items.refetch()} />
      ) : items.data?.length ? (
        <SubmissionList items={items.data} categories={categories.data ?? []} showAuthor editorialView />
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
              <option value="all">Alle Beiträge</option>
              <option value="accepted">Nur angenommene Beiträge</option>
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
