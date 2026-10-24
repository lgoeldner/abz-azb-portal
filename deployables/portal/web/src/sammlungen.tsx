import { Plus } from 'lucide-react';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  api,
  canEdit,
  date,
  editorial,
  json,
  type BallotAudit,
  type Category,
  type PollResult,
  type Submission,
} from './api';
import {
  Arrow,
  Badge,
  Empty,
  Failure,
  KindIcon,
  Loading,
  PageHead,
  SubmissionList,
  allKinds,
  btn,
  field,
  heading,
  kindIcon,
  kindLabel,
  label,
  newestOpened,
  notice,
  panel,
  plural,
  repeatableKinds,
  singleKinds,
  useAction,
  useData,
  useSession,
  type Kind,
} from './ui';
import { DevDebug } from './DevDebug';
import { NotFound } from './pages';

const isKind = (value: string | null): value is Kind => allKinds.includes(value as Kind);

const debugData = (c: Category) => ({
  id: c.id,
  kind: c.kind,
  repeatable: c.repeatable,
  status: c.status,
  version: c.version,
  options: c.options.length,
  allowSelfVote: c.allow_self_vote,
  hasVoted: c.my_option_id !== null,
});

// ---------- list ----------
export function Sammlungen() {
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const categories = useData<Category[]>('/categories');
  const klasse = isKind(params.get('klasse')) ? (params.get('klasse') as Kind) : null;
  const creating = editorial(user) && params.has('neu');
  const setCreating = (open: boolean) => setParams(open ? { neu: '' } : {}, { replace: true });
  const shown = (categories.data ?? []).filter((c) => !klasse || c.kind === klasse);
  const fortlaufend = shown.filter((c) => c.repeatable);
  const ballots = shown.filter((c) => !c.repeatable);
  const groups: [Category['status'], string, string][] = [
    ['open', 'Offen', 'Eine Auswahl pro Person'],
    ['draft', 'Entwürfe', 'Nur für die Redaktion sichtbar'],
    ['closed', 'Beendet', 'Die Abstimmung ist abgeschlossen'],
  ];
  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold ${
      active ? 'bg-ink text-white' : 'bg-pill hover:bg-pop'
    }`;
  return (
    <>
      <PageHead
        title="Sammlungen"
        action={
          editorial(user) && (
            <button className={creating ? btn.secondary : btn.primary} onClick={() => setCreating(!creating)}>
              {creating ? (
                'Formular schließen'
              ) : (
                <>
                  Neue Sammlung <Plus aria-hidden="true" className="size-4 shrink-0" />
                </>
              )}
            </button>
          )
        }
      >
        Hier sammelt der Jahrgang Geschichten und entscheidet gemeinsam. Trage bei, so oft du willst, oder stimme mit
        ab.
      </PageHead>
      {creating && <SammlungForm onSaved={() => setCreating(false)} />}
      <nav aria-label="Nach Klasse filtern" className="mb-8 flex flex-wrap gap-2">
        <Link to="/sammlungen" className={chip(!klasse)} aria-current={!klasse ? 'true' : undefined}>
          Alle
        </Link>
        {allKinds.map((k) => (
          <Link
            key={k}
            to={`/sammlungen?klasse=${k}`}
            className={chip(klasse === k)}
            aria-current={klasse === k ? 'true' : undefined}
          >
            <KindIcon icon={kindIcon[k]} />
            {kindLabel[k]}
          </Link>
        ))}
      </nav>
      {categories.isPending ? (
        <Loading />
      ) : categories.error ? (
        <Failure error={categories.error} retry={() => categories.refetch()} />
      ) : shown.length === 0 ? (
        <Empty>
          {klasse
            ? 'In dieser Klasse gibt es noch keine Sammlungen.'
            : 'Hier geht’s bald los. Aktuell gibt es keine Sammlungen.'}
        </Empty>
      ) : (
        <div className="space-y-10">
          {fortlaufend.length > 0 && (
            <section aria-labelledby="sammlungen-fortlaufend">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="sammlungen-fortlaufend" className={heading}>
                  Fortlaufend
                </h2>
                <span className="text-sm text-muted">Beliebig oft beitragen</span>
              </div>
              <Cards items={fortlaufend} />
            </section>
          )}
          {ballots.length > 0 && (
            <div className={`${notice} space-y-1`}>
              <strong className="block">Transparent abgestimmt.</strong>
              <p>
                Deine Stimme wird deinem Namen zugeordnet. Die Administration kann Stimmen und Änderungen
                nachvollziehen. Die Redaktion sieht nur Gesamtergebnisse. Als Schüler:in siehst du keine Ergebnisse. Du
                kannst deine Stimme ändern, solange die Sammlung offen ist.
              </p>
            </div>
          )}
          {groups.map(([status, name, hint]) => {
            const items = ballots.filter((c) => c.status === status).sort(newestOpened);
            if (!items.length || (status === 'draft' && !editorial(user))) return null;
            return (
              <section key={status} aria-labelledby={`sammlungen-${status}`}>
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id={`sammlungen-${status}`} className={heading}>
                    {name}
                  </h2>
                  <span className="text-sm text-muted">{hint}</span>
                </div>
                <Cards items={items} />
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function Cards({ items }: { items: Category[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((c) => (
        <div className={import.meta.env.DEV ? 'flex h-full min-w-0 flex-col' : 'contents'} key={c.id}>
          <Link
            className="flex min-w-0 flex-1 flex-col gap-3 rounded-ui bg-white p-5 transition-colors hover:border-muted"
            to={`/sammlungen/${c.id}`}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className={`${heading} min-w-0`}>{c.name}</h3>
              {!c.repeatable && <Badge status={c.status} />}
            </div>
            <p className="text-sm text-muted">{c.description}</p>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line pt-3 text-sm text-muted">
              <span className="flex min-w-0 flex-1 items-start gap-1.5">
                <KindIcon icon={kindIcon[c.kind]} className="mt-[3px] size-4" />
                <span>
                  {kindLabel[c.kind]}
                  {!c.repeatable &&
                    `, ${c.my_option_id ? '✓ Deine Stimme ist gespeichert' : plural(c.options.length, 'Option', 'Optionen')}`}
                </span>
              </span>
              <span className="inline-flex flex-none items-center gap-1 whitespace-nowrap font-semibold text-ink">
                {c.repeatable ? 'Beitragen' : c.status === 'open' ? 'Abstimmen' : 'Ansehen'} <Arrow />
              </span>
            </div>
          </Link>
          <DevDebug label="Sammlung" data={debugData(c)} />
        </div>
      ))}
    </div>
  );
}

// ---------- create / edit ----------
// Admins pick any class, managers only single-answer classes; an existing Sammlung may change class within its group.
export function SammlungForm({
  sammlung,
  onSaved,
  extra,
  afterSave,
}: {
  sammlung?: Category | null;
  onSaved: () => void;
  extra?: ReactNode;
  afterSave?: (saved: Category) => Promise<void>;
}) {
  const { user } = useSession();
  const action = useAction();
  const current = useRef<Category | null>(sammlung ?? null);
  const classes = sammlung
    ? sammlung.repeatable
      ? repeatableKinds
      : singleKinds
    : user.role === 'admin'
      ? allKinds
      : singleKinds;
  const [kind, setKind] = useState<Kind>(sammlung?.kind ?? (user.role === 'admin' ? 'memory' : 'proposal'));
  const single = singleKinds.includes(kind);
  const roster = useData<{ id: string; name: string }[]>('/roster', kind === 'person');
  const [selected, setSelected] = useState<string[]>(
    sammlung?.options.flatMap((o) => (o.user_id ? [o.user_id] : [])) ?? [],
  );
  const [options, setOptions] = useState(sammlung?.options.map((o) => o.label).join('\n') ?? '');
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const choices = !single
      ? []
      : kind === 'person'
        ? selected.map((id) => ({
            label:
              roster.data?.find((u) => u.id === id)?.name ??
              sammlung?.options.find((o) => o.user_id === id)?.label ??
              '',
            user_id: id,
          }))
        : options
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((text) => ({ label: text }));
    action.run(async () => {
      if (single && choices.length < 2) throw new Error('Bitte mindestens zwei Optionen auswählen.');
      // A retry after a failed follow-up step must update the Sammlung saved by the first attempt, not create another.
      const target = current.current;
      const saved = await api<Category>(
        target ? `/categories/${target.id}` : '/categories',
        json(target ? 'PATCH' : 'POST', {
          ...(target ? { version: target.version } : {}),
          name: data.get('name'),
          description: data.get('description'),
          kind,
          allow_self_vote: single && data.get('allow_self_vote') === 'on',
          options: choices,
        }),
      );
      current.current = saved;
      await afterSave?.(saved);
      onSaved();
    }, 'Sammlung gespeichert.');
  }
  return (
    <form className={`${panel} mb-10 space-y-5`} onSubmit={save}>
      <h2 className={heading}>{sammlung ? 'Sammlung bearbeiten' : 'Neue Sammlung'}</h2>
      <label className={label}>
        Name
        <input className={field} name="name" defaultValue={sammlung?.name} maxLength={200} required />
      </label>
      <label className={label}>
        Beschreibung
        <textarea className={field} name="description" defaultValue={sammlung?.description} rows={3} />
      </label>
      <label className={label}>
        Klasse
        <select className={field} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {classes.map((k) => (
            <option key={k} value={k}>
              {kindLabel[k]}
            </option>
          ))}
        </select>
      </label>
      {single &&
        (kind === 'proposal' ? (
          <label className={label}>
            Antwortoptionen <small className="font-normal text-muted">eine Option pro Zeile</small>
            <textarea
              className={field}
              rows={5}
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              required
              placeholder={'Option A\nOption B'}
            />
          </label>
        ) : (
          <fieldset className="min-w-0 space-y-3">
            <legend className={label}>Kandidat:innen (mindestens zwei)</legend>
            {roster.isPending ? (
              <Loading />
            ) : roster.error ? (
              <Failure error={roster.error} />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {roster.data?.map((u) => (
                  <label className="flex items-center gap-2.5 text-[15px]" key={u.id}>
                    <input
                      className="size-4 shrink-0 accent-[var(--color-accent)]"
                      type="checkbox"
                      checked={selected.includes(u.id)}
                      onChange={(e) =>
                        setSelected(e.target.checked ? [...selected, u.id] : selected.filter((id) => id !== u.id))
                      }
                    />
                    {u.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        ))}
      {single && (
        <>
          <label className="flex items-center gap-2.5 text-[15px]">
            <input
              className="size-4 shrink-0 accent-[var(--color-accent)]"
              type="checkbox"
              name="allow_self_vote"
              defaultChecked={sammlung?.allow_self_vote}
            />
            Stimme für die eigene Person erlauben
          </label>
          <p className="text-sm text-muted">Eine Auswahl pro Person. Nach dem Öffnen ist die Definition gesperrt.</p>
        </>
      )}
      {extra}
      {action.feedback}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className={btn.secondary} onClick={onSaved}>
          Abbrechen
        </button>
        <button className={btn.primary} disabled={action.busy}>
          Sammlung speichern
        </button>
      </div>
    </form>
  );
}

// ---------- detail ----------
export function SammlungDetail() {
  const { id } = useParams();
  const categories = useData<Category[]>('/categories');
  const sammlung = categories.data?.find((c) => c.id === id);
  if (categories.isPending) return <Loading />;
  if (categories.error) return <Failure error={categories.error} retry={() => categories.refetch()} />;
  if (!sammlung) return <NotFound />;
  return sammlung.repeatable ? <Fortlaufend sammlung={sammlung} /> : <Ballot sammlung={sammlung} />;
}

const BackLink = () => (
  <Link className="mb-4 inline-flex text-sm font-semibold text-muted hover:text-ink" to="/sammlungen">
    ← Sammlungen
  </Link>
);

function ClassLine({ sammlung }: { sammlung: Category }) {
  return (
    <>
      <span className="inline-flex items-center gap-1.5 align-[-3px]">
        <KindIcon icon={kindIcon[sammlung.kind]} />
        {kindLabel[sammlung.kind]}
      </span>
      {sammlung.description && `. ${sammlung.description}`}
    </>
  );
}

function Fortlaufend({ sammlung }: { sammlung: Category }) {
  const { user } = useSession();
  const [editing, setEditing] = useState(false);
  const submissions = useData<Submission[]>('/submissions');
  const categories = useData<Category[]>('/categories');
  const mine = (submissions.data ?? []).filter((s) => s.category_id === sammlung.id);
  const own = mine.filter((s) => s.author_id === user.id);
  const pending = mine.filter((s) => s.status === 'pending').length;
  return (
    <>
      <BackLink />
      <PageHead title={sammlung.name}>
        <ClassLine sammlung={sammlung} />
      </PageHead>
      <DevDebug label="Sammlung" data={debugData(sammlung)} />
      {editing ? (
        <SammlungForm sammlung={sammlung} onSaved={() => setEditing(false)} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(240px,1fr)] lg:items-start">
          <section className={`${panel} min-w-0 space-y-5`}>
            <h2 className={heading}>Beliebig oft beitragen</h2>
            <p className="text-sm text-muted">
              Du kannst hier so viele Beiträge einreichen, wie du möchtest. Jeder Beitrag wird von der Redaktion
              geprüft.
            </p>
            <Link className={btn.primary} to={`/beitraege/neu?kategorie=${sammlung.id}`}>
              Beitrag einreichen <Arrow />
            </Link>
            <h3 className="pt-2 text-sm font-bold">Deine Beiträge hier</h3>
            {submissions.isPending ? (
              <Loading />
            ) : submissions.error ? (
              <Failure error={submissions.error} retry={() => submissions.refetch()} />
            ) : own.length ? (
              <SubmissionList items={own} categories={categories.data ?? []} />
            ) : (
              <Empty>Du hast hier noch nichts eingereicht.</Empty>
            )}
          </section>
          {editorial(user) && (
            <aside className="min-w-0 space-y-6">
              <section className={panel}>
                <h3 className={heading}>Sammlung verwalten</h3>
                <p className="mt-1 text-sm text-muted">
                  {plural(mine.length, 'Beitrag', 'Beiträge')}, {pending} in Prüfung
                </p>
                <div className="mt-4 flex flex-col gap-3">
                  <Link className={btn.secondary} to={`/redaktion?sammlung=${sammlung.id}`}>
                    Beiträge prüfen
                  </Link>
                  <a className={btn.secondary} href={`/api/v1/categories/${sammlung.id}/export?status=accepted`}>
                    ZIP herunterladen ↓
                  </a>
                  {user.role === 'admin' && (
                    <button className={btn.text} onClick={() => setEditing(true)}>
                      Sammlung bearbeiten
                    </button>
                  )}
                </div>
              </section>
            </aside>
          )}
        </div>
      )}
    </>
  );
}

function Ballot({ sammlung: poll }: { sammlung: Category }) {
  const { user } = useSession();
  const id = poll.id;
  const action = useAction();
  const savedChoice = poll.my_option_id ?? null;
  const [choice, setChoice] = useState<string | null>(savedChoice);
  const [syncedChoice, setSyncedChoice] = useState(savedChoice);
  const [editing, setEditing] = useState(false);
  const results = useData<PollResult[]>(`/categories/${id}/results`, editorial(user));
  const [auditOpen, setAuditOpen] = useState(false);
  const audit = useData<BallotAudit[]>(`/categories/${id}/audit`, auditOpen && user.role === 'admin');
  if (syncedChoice !== savedChoice) {
    setSyncedChoice(savedChoice);
    setChoice(savedChoice);
  } // reset the selection when the saved ballot changes
  const writable = canEdit(user, poll.id);
  const eligible = user.admitted && user.cohort_member;
  const total = results.data?.reduce((n, r) => n + r.count, 0) ?? 0;
  const setStatus = (status: 'open' | 'closed', message: string) =>
    action.run(() => api(`/categories/${id}/status`, json('POST', { version: poll.version, status })), message);
  return (
    <>
      <BackLink />
      <PageHead title={poll.name} action={<Badge status={poll.status} />}>
        <ClassLine sammlung={poll} />
      </PageHead>
      <DevDebug label="Sammlung" data={debugData(poll)} />
      {action.feedback}
      {editing ? (
        <SammlungForm sammlung={poll} onSaved={() => setEditing(false)} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(240px,1fr)] lg:items-start">
          <section className={`${panel} min-w-0 space-y-5`}>
            <h2 className={heading}>
              {poll.status === 'open'
                ? 'Wem gibst du deine Stimme?'
                : poll.status === 'closed'
                  ? 'Diese Sammlung ist beendet.'
                  : 'Diese Sammlung ist ein Entwurf.'}
            </h2>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                action.run(async () => {
                  await api(`/categories/${id}/ballot`, json('PUT', { option_id: choice }));
                }, 'Deine Stimme wurde gespeichert.');
              }}
            >
              <fieldset className="min-w-0 space-y-2" disabled={poll.status !== 'open' || !eligible || action.busy}>
                <legend className="sr-only">Eine Option auswählen</legend>
                {poll.options.map((o) => {
                  const self = o.user_id === user.id && !poll.allow_self_vote;
                  return (
                    <label
                      className={`flex cursor-pointer items-center gap-3 rounded-ui border-2 bg-white px-4 py-3 text-[15px] ${
                        choice === o.id ? 'border-ink' : 'border-line'
                      }`}
                      key={o.id}
                    >
                      <input
                        className="size-4 shrink-0 accent-[var(--color-accent)]"
                        type="radio"
                        name="ballot"
                        value={o.id}
                        checked={choice === o.id}
                        onChange={() => setChoice(o.id)}
                        disabled={self}
                      />
                      <span className="min-w-0 flex-1 break-words">
                        {o.label}
                        {self && (
                          <small className="block text-sm text-muted">
                            Eine Stimme für dich selbst ist hier nicht erlaubt.
                          </small>
                        )}
                      </span>
                      {choice === o.id && <span className="font-semibold text-ink">✓</span>}
                    </label>
                  );
                })}
              </fieldset>
              {poll.status === 'open' && (
                <button
                  className={btn.primary}
                  disabled={
                    action.busy ||
                    !choice ||
                    !eligible ||
                    poll.options.some((o) => o.id === choice && o.user_id === user.id && !poll.allow_self_vote)
                  }
                >
                  {poll.my_option_id ? 'Stimme ändern' : 'Stimme speichern'} <Arrow />
                </button>
              )}
              {!eligible && <p className={notice}>Nur freigegebene Mitglieder des Jahrgangs dürfen abstimmen.</p>}
              {poll.my_option_id && (
                <p className="text-sm font-semibold text-ok">
                  ✓ Gespeicherte Stimme: {poll.options.find((o) => o.id === poll.my_option_id)?.label}
                </p>
              )}
            </form>
            <p className="text-sm text-muted">
              Namentliche Abstimmung: Die Administration kann deine Stimme und Änderungen zuordnen. Während der Öffnung
              kannst du deine Auswahl ändern. Ergebnisse sind für Schüler:innen nicht sichtbar.
            </p>
          </section>
          <aside className="min-w-0 space-y-6">
            {writable && (
              <section className={panel}>
                <h3 className={heading}>Sammlung verwalten</h3>
                <div className="mt-4 flex flex-col gap-3">
                  {poll.status === 'draft' && (
                    <>
                      <button className={btn.secondary} onClick={() => setEditing(true)}>
                        Definition bearbeiten
                      </button>
                      <button
                        className={btn.primary}
                        disabled={action.busy}
                        onClick={() => setStatus('open', 'Sammlung geöffnet.')}
                      >
                        Sammlung öffnen
                      </button>
                      <p className="text-sm text-muted">
                        Die Definition kann nach dem Öffnen nicht mehr geändert werden.
                      </p>
                    </>
                  )}
                  {poll.status === 'open' && (
                    <button
                      className={btn.secondary}
                      disabled={action.busy}
                      onClick={() => setStatus('closed', 'Sammlung beendet.')}
                    >
                      Sammlung beenden
                    </button>
                  )}
                </div>
              </section>
            )}
            {editorial(user) && (
              <section className={panel}>
                <h3 className={heading}>Gesamtergebnisse</h3>
                {results.isPending ? (
                  <Loading />
                ) : results.error ? (
                  <Failure error={results.error} retry={() => results.refetch()} />
                ) : (
                  <>
                    <p className="mt-1 text-sm text-muted">Nur für die Redaktion. {total} abgegebene Stimme(n).</p>
                    <div className="mt-4 space-y-4">
                      {results.data?.map((r) => (
                        <div className="min-w-0" key={r.option_id}>
                          <div className="flex items-baseline justify-between gap-3">
                            <strong className="min-w-0 break-words">{r.label}</strong>
                            <span className="tabular-nums">{r.count}</span>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-pill">
                            <span
                              className="block h-full rounded-full bg-ink"
                              style={{
                                width: `${total ? (r.count / total) * 100 : 0}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>
            )}
          </aside>
        </div>
      )}
      {user.role === 'admin' && (
        <section className={`${panel} mt-6 space-y-4`}>
          <button className={btn.secondary} aria-expanded={auditOpen} onClick={() => setAuditOpen(!auditOpen)}>
            {auditOpen ? 'Stimmprotokoll schließen' : 'Namentliches Stimmprotokoll öffnen'}
          </button>
          {auditOpen && (
            <>
              <p className="text-sm text-muted">Vertraulich. Enthält die Zuordnung von Stimmen und deren Änderungen.</p>
              {audit.isPending ? (
                <Loading />
              ) : audit.error ? (
                <Failure error={audit.error} />
              ) : (
                <div className="relative overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-[13px] text-muted">
                        <th className="py-2 pr-4 font-normal">Name</th>
                        <th className="py-2 pr-4 font-normal">Auswahl</th>
                        <th className="py-2 text-right font-normal">Zeitpunkt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.data?.map((a, i) => (
                        <tr className="border-t border-line" key={`${a.user_id}-${i}`}>
                          <td className="py-3 pr-4 align-top">{a.user_name}</td>
                          <td className="py-3 pr-4 align-top">{a.option_label}</td>
                          <td className="py-3 text-right align-top tabular-nums">{date(a.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!audit.data?.length && <p className="mt-3 text-sm text-muted">Noch keine Stimmen.</p>}
                </div>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
