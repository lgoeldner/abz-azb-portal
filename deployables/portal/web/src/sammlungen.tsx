import { Minus, Plus } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  api,
  canEdit,
  date,
  editorial,
  json,
  patchUser,
  type User,
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
  useWorkspaceView,
  type Kind,
} from './ui';
import { PeoplePicker } from './PeoplePicker';
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
  allPeople: c.all_people,
  maxChoices: c.max_choices,
  hasVoted: Boolean(c.my_option_ids?.length || c.my_option_id),
});
const badgeLabel = (c: Category) => (c.status === 'draft' && c.opened_at ? 'Verborgen' : undefined);

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
    ['open', 'Offen', 'Stimme während der Öffnung änderbar'],
    ['draft', 'Verborgen', 'Nur für die Redaktion sichtbar'],
    ['closed', 'Beendet', 'Die Abstimmung ist abgeschlossen'],
  ];
  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
      active ? 'bg-ink text-white hover:bg-accent' : 'bg-pill hover:bg-pop'
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
  const [view] = useWorkspaceView();
  if (view === 'redaktion')
    return (
      <ul className="collection-ledger divide-y divide-line rounded-ui bg-white" aria-label="Sammlungen">
        {items.map((c) => (
          <li key={c.id}>
            <Link
              to={`/sammlungen/${c.id}`}
              className="flex min-h-20 items-center gap-4 rounded-ui px-5 py-4 transition-colors hover:bg-soft"
            >
              <KindIcon icon={kindIcon[c.kind]} className="size-4 text-muted" />
              <span className="min-w-0 flex-1">
                <strong className="block text-[15px] font-semibold">{c.name}</strong>
                <span className="block text-sm text-muted">{c.description || kindLabel[c.kind]}</span>
              </span>
              {!c.repeatable && <Badge status={c.status} label={badgeLabel(c)} />}
              <span className="hidden text-sm text-muted sm:block">
                {c.repeatable ? 'Beiträge lesen' : 'Ergebnisse ansehen'}
              </span>
              <Arrow />
            </Link>
          </li>
        ))}
      </ul>
    );
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
              {!c.repeatable && <Badge status={c.status} label={badgeLabel(c)} />}
            </div>
            <p className="text-sm text-muted">{c.description}</p>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line pt-3 text-sm text-muted">
              <span className="flex min-w-0 flex-1 items-start gap-1.5">
                <KindIcon icon={kindIcon[c.kind]} className="mt-[3px] size-4" />
                <span>
                  {kindLabel[c.kind]}
                  {!c.repeatable &&
                    `, ${c.my_option_ids?.length || c.my_option_id ? 'Deine Stimme ist gespeichert' : plural(c.options.length, 'Option', 'Optionen')}`}
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
// Editors pick any class; an existing Sammlung may change class within its group.
export function SammlungForm({ sammlung, onSaved }: { sammlung?: Category | null; onSaved: () => void }) {
  const { user } = useSession();
  const action = useAction();
  const current = useRef<Category | null>(sammlung ?? null);
  const classes = sammlung ? (sammlung.repeatable ? repeatableKinds : singleKinds) : allKinds;
  const [kind, setKind] = useState<Kind>(sammlung?.kind ?? 'memory');
  const single = singleKinds.includes(kind);
  const definitionLocked =
    !!sammlung && !sammlung.repeatable && (sammlung.status !== 'draft' || Boolean(sammlung.opened_at));
  const users = useData<User[]>('/admin/users', user.role === 'admin');
  const [grants, setGrants] = useState<Record<string, boolean>>({});
  const managers = (users.data ?? []).filter((u) => u.role === 'manager');
  const roster = useData<{ id: string; name: string }[]>('/roster', kind === 'person');
  const [allPeople, setAllPeople] = useState(sammlung?.kind === 'person' ? sammlung.all_people : true);
  const [maxChoices, setMaxChoices] = useState(sammlung?.max_choices ?? 1);
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
        ? allPeople
          ? []
          : selected.map((id) => ({
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
      if (!definitionLocked && single && kind === 'proposal' && choices.length < 2)
        throw new Error('Bitte mindestens zwei Optionen auswählen.');
      if (!definitionLocked && single && kind === 'person' && !allPeople && choices.length < 2)
        throw new Error('Bitte mindestens zwei Kandidat:innen auswählen.');
      if (!definitionLocked && single && (!Number.isInteger(maxChoices) || maxChoices < 1 || maxChoices > 500))
        throw new Error('Die Zahl der auswählbaren Optionen muss zwischen 1 und 500 liegen.');
      // A retry after a failed follow-up step must update the Sammlung saved by the first attempt, not create another.
      const target = current.current;
      const saved = definitionLocked
        ? sammlung
        : await api<Category>(
            target ? `/categories/${target.id}` : '/categories',
            json(target ? 'PATCH' : 'POST', {
              ...(target ? { version: target.version } : {}),
              name: data.get('name'),
              description: data.get('description'),
              kind,
              allow_self_vote: single && data.get('allow_self_vote') === 'on',
              all_people: kind === 'person' && allPeople,
              max_choices: single ? maxChoices : 1,
              options: choices,
            }),
          );
      current.current = saved;
      if (user.role === 'admin' && Object.keys(grants).length) {
        // Apply only changed checkboxes to fresh records so unrelated grants survive.
        const currentUsers = await api<User[]>('/admin/users');
        for (const manager of currentUsers.filter((u) => u.role === 'manager')) {
          const now = manager.category_ids.includes(saved.id);
          const want = grants[manager.id] ?? now;
          if (want !== now)
            await patchUser(manager, {
              category_ids: want
                ? [...manager.category_ids, saved.id]
                : manager.category_ids.filter((id) => id !== saved.id),
            });
        }
      }
      onSaved();
    }, 'Sammlung gespeichert.');
  }
  return (
    <form className={`${panel} mb-10 space-y-5`} onSubmit={save}>
      <h2 className={heading}>
        {definitionLocked ? 'Berechtigungen bearbeiten' : sammlung ? 'Sammlung bearbeiten' : 'Neue Sammlung'}
      </h2>
      {definitionLocked ? (
        <p className="text-sm text-muted">
          Die Definition ist seit dem Öffnen gesperrt. Berechtigungen bleiben änderbar.
        </p>
      ) : (
        <>
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
              <div className="space-y-4">
                <label className="flex cursor-pointer items-center justify-between gap-4 text-[15px]">
                  <span>Alle freigegebenen Personen zur Abstimmung zulassen</span>
                  <input
                    className="peer sr-only"
                    type="checkbox"
                    role="switch"
                    checked={allPeople}
                    onChange={(event) => setAllPeople(event.target.checked)}
                  />
                  <span className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full bg-pill transition-colors after:absolute after:left-1 after:size-5 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-ink peer-checked:after:translate-x-5 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink"></span>
                </label>
                {allPeople ? (
                  <p className="text-sm text-muted">
                    Bei der Öffnung werden alle freigegebenen Mitglieder aufgenommen. Danach bleibt die Personenliste
                    unverändert.
                  </p>
                ) : roster.isPending ? (
                  <Loading />
                ) : roster.error ? (
                  <Failure error={roster.error} />
                ) : (
                  <PeoplePicker
                    legend="Kandidat:innen (mindestens zwei)"
                    options={roster.data?.map((person) => ({ ...person, user_id: person.id })) ?? []}
                    selectedIds={selected}
                    onChange={setSelected}
                    disabled={action.busy}
                  />
                )}
              </div>
            ))}
          {single && (
            <>
              <div className="space-y-2">
                <label className={label} htmlFor="max_choices">
                  Maximale Zahl der Stimmen pro Person
                </label>
                <div className="flex items-center gap-4">
                  <button
                    className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white text-ink transition hover:bg-pill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-40"
                    type="button"
                    aria-label={kind === 'person' ? 'Weniger Personen' : 'Weniger Optionen'}
                    disabled={maxChoices <= 1 || action.busy}
                    onClick={() => setMaxChoices((value) => Math.min(500, Math.max(1, value - 1)))}
                  >
                    <Minus aria-hidden="true" size={24} />
                  </button>
                  <input
                    className="h-16 w-24 appearance-none [-moz-appearance:textfield] rounded-xl border border-transparent bg-transparent text-center text-4xl font-bold tabular-nums text-ink outline-none transition focus:border-ink focus:bg-white [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    type="number"
                    name="max_choices"
                    id="max_choices"
                    min={1}
                    max={500}
                    step={1}
                    required
                    value={maxChoices}
                    disabled={action.busy}
                    onChange={(event) => setMaxChoices(Number(event.target.value))}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <button
                    className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white text-ink transition hover:bg-pill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-40"
                    type="button"
                    aria-label={kind === 'person' ? 'Mehr Personen' : 'Mehr Optionen'}
                    disabled={maxChoices >= 500 || action.busy}
                    onClick={() => setMaxChoices((value) => Math.max(1, Math.min(500, value + 1)))}
                  >
                    <Plus aria-hidden="true" size={24} />
                  </button>
                </div>
              </div>
              <label className="flex items-center gap-2.5 text-[15px]">
                <input
                  className="size-4 shrink-0 accent-[var(--color-accent)]"
                  type="checkbox"
                  name="allow_self_vote"
                  defaultChecked={sammlung?.allow_self_vote}
                />
                Stimme für die eigene Person erlauben
              </label>
              <p className="text-sm text-muted">
                {`Pro Person bis zu ${maxChoices} Stimme(n).`} Nach dem Öffnen ist die Definition gesperrt.
              </p>
            </>
          )}
        </>
      )}
      {user.role === 'admin' && (
        <fieldset className="min-w-0 space-y-3" disabled={action.busy}>
          <legend className={label}>Wer darf bearbeiten</legend>
          <p className="text-sm text-muted">
            Die Administration darf alle Sammlungen bearbeiten. Redaktionsmitglieder bearbeiten eigene und zugewiesene
            Sammlungen und lesen alle Beiträge.
          </p>
          {users.isPending ? (
            <Loading />
          ) : users.error ? (
            <Failure error={users.error} retry={() => users.refetch()} />
          ) : managers.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {managers.map((manager) => (
                <label key={manager.id} className="flex items-center gap-2.5 text-[15px]">
                  <input
                    className="size-4 shrink-0 accent-[var(--color-accent)]"
                    type="checkbox"
                    checked={grants[manager.id] ?? (!!sammlung && manager.category_ids.includes(sammlung.id))}
                    onChange={(e) => setGrants({ ...grants, [manager.id]: e.target.checked })}
                  />
                  {manager.name}
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Noch niemand in der Redaktion.</p>
          )}
        </fieldset>
      )}
      {action.feedback}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className={btn.secondary} onClick={onSaved}>
          Abbrechen
        </button>
        <button className={btn.primary} disabled={action.busy}>
          {definitionLocked ? 'Berechtigungen speichern' : 'Sammlung speichern'}
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
  return sammlung.repeatable ? (
    <Fortlaufend key={sammlung.id} sammlung={sammlung} />
  ) : (
    <Ballot key={sammlung.id} sammlung={sammlung} />
  );
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
  const [view] = useWorkspaceView();
  return view === 'redaktion' ? <CollectionReader sammlung={sammlung} /> : <StudentCollection sammlung={sammlung} />;
}

function CollectionReader({ sammlung }: { sammlung: Category }) {
  const { user } = useSession();
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const submissions = useData<Submission[]>(`/submissions?category_id=${sammlung.id}`);
  const items = (submissions.data ?? []).filter((s) =>
    `${s.title} ${s.body} ${s.author_name}`.toLocaleLowerCase('de').includes(search.toLocaleLowerCase('de')),
  );
  return (
    <>
      <BackLink />
      <PageHead
        title={sammlung.name}
        action={
          <div className="flex flex-wrap gap-3">
            {canEdit(user, sammlung.id) && (
              <button className={btn.secondary} onClick={() => setEditing(!editing)}>
                {editing ? 'Formular schließen' : 'Sammlung bearbeiten'}
              </button>
            )}
            <a className={btn.secondary} href={`/api/v1/categories/${sammlung.id}/export?status=all`}>
              Alle Beiträge als ZIP <Arrow />
            </a>
          </div>
        }
      >
        <ClassLine sammlung={sammlung} />
      </PageHead>
      <DevDebug label="Sammlung" data={debugData(sammlung)} />
      {editing && canEdit(user, sammlung.id) && (
        <SammlungForm key={sammlung.id} sammlung={sammlung} onSaved={() => setEditing(false)} />
      )}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className={heading}>Gesammelte Beiträge</h2>
          <p className="mt-1 text-sm text-muted">
            Originale lesen und Anmerkungen für die spätere Moderation festhalten.
          </p>
        </div>
        <label className={`${label} w-full sm:w-72`}>
          Suchen
          <input
            type="search"
            maxLength={200}
            className={field}
            placeholder="Titel, Text, Name …"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {submissions.isPending ? (
        <Loading />
      ) : submissions.error ? (
        <Failure error={submissions.error} retry={() => submissions.refetch()} />
      ) : (
        <>
          <p className="mb-3 text-sm tabular-nums text-muted">
            {search ? (
              `${items.length} von ${submissions.data.length} Beiträgen`
            ) : (
              <>
                <strong style={{ color: 'var(--editorial-data)' }}>{items.length}</strong>{' '}
                {items.length === 1 ? 'Beitrag' : 'Beiträge'}
              </>
            )}
          </p>
          {items.length ? (
            <SubmissionList items={items} categories={[sammlung]} showAuthor editorialView />
          ) : (
            <Empty>{search ? 'Keine Beiträge zu dieser Suche.' : 'Hier sind noch keine Beiträge eingegangen.'}</Empty>
          )}
        </>
      )}
    </>
  );
}

function StudentCollection({ sammlung }: { sammlung: Category }) {
  const { user } = useSession();
  const submissions = useData<Submission[]>('/submissions');
  const categories = useData<Category[]>('/categories');
  const mine = (submissions.data ?? []).filter((s) => s.category_id === sammlung.id);
  const own = mine.filter((s) => s.author_id === user.id);
  return (
    <>
      <BackLink />
      <PageHead title={sammlung.name}>
        <ClassLine sammlung={sammlung} />
      </PageHead>
      <DevDebug label="Sammlung" data={debugData(sammlung)} />
      <div>
        <section className={`${panel} min-w-0 space-y-5`}>
          <h2 className={heading}>Beliebig oft beitragen</h2>
          <p className="text-sm text-muted">
            Du kannst hier so viele Beiträge einreichen, wie du möchtest. Nach der Sammlung kümmert sich die Redaktion
            um die Auswahl für die Zeitung.
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
      </div>
    </>
  );
}

function Ballot({ sammlung: poll }: { sammlung: Category }) {
  const [view] = useWorkspaceView();
  const redaktion = view === 'redaktion';
  const { user } = useSession();
  const navigate = useNavigate();
  const id = poll.id;
  const action = useAction();
  const savedChoices = poll.my_option_ids?.length ? poll.my_option_ids : poll.my_option_id ? [poll.my_option_id] : [];
  const savedChoicesKey = savedChoices.join('\u0000');
  const [choices, setChoices] = useState<string[]>(savedChoices);
  const [syncedChoicesKey, setSyncedChoicesKey] = useState(savedChoicesKey);
  const [editing, setEditing] = useState(false);
  const results = useData<PollResult[]>(`/categories/${id}/results`, editorial(user));
  const [auditOpen, setAuditOpen] = useState(false);
  const audit = useData<BallotAudit[]>(`/categories/${id}/audit`, auditOpen && user.role === 'admin');
  if (syncedChoicesKey !== savedChoicesKey) {
    setSyncedChoicesKey(savedChoicesKey);
    setChoices(savedChoices);
  } // reset the selection when the saved ballot changes
  const writable = canEdit(user, poll.id);
  const eligible = user.admitted && user.cohort_member;
  const total = results.data?.reduce((n, r) => n + r.count, 0) ?? 0;
  const auditGroups = (() => {
    const groups = new Map<string, BallotAudit[]>();
    (audit.data ?? []).forEach((row, index) => {
      const key = row.ballot_id ? `${row.user_id}:${row.ballot_id}` : `legacy:${index}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    });
    return [...groups.entries()].map(([key, rows]) => ({ key, rows }));
  })();
  const setStatus = (status: Category['status'], message: string) =>
    action.run(() => api(`/categories/${id}/status`, json('POST', { version: poll.version, status })), message);
  const deletePoll = () => {
    if (
      !window.confirm(
        'Diese Sammlung sowie alle Stimmen und das Stimmprotokoll werden gelöscht. Möchtest du fortfahren?',
      )
    )
      return;
    action.run(async () => {
      await api<void>(`/categories/${id}`, json('DELETE', { version: poll.version }));
      navigate('/sammlungen');
    }, 'Sammlung gelöscht.');
  };
  return (
    <>
      <BackLink />
      <PageHead title={poll.name} action={<Badge status={poll.status} label={badgeLabel(poll)} />}>
        <ClassLine sammlung={poll} />
      </PageHead>
      <DevDebug label="Sammlung" data={debugData(poll)} />
      {action.feedback}
      {editing && writable ? (
        <SammlungForm sammlung={poll} onSaved={() => setEditing(false)} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(240px,1fr)] lg:items-start">
          <section className={`${panel} min-w-0 space-y-5`}>
            <h2 className={heading}>
              {redaktion
                ? 'Auswahlmöglichkeiten'
                : poll.status === 'open'
                  ? poll.kind === 'person'
                    ? 'Wen wählst du?'
                    : 'Welche Option wählst du?'
                  : poll.status === 'closed'
                    ? 'Diese Sammlung ist beendet.'
                    : poll.opened_at
                      ? 'Diese Sammlung ist verborgen.'
                      : 'Diese Sammlung ist ein Entwurf.'}
            </h2>
            {redaktion ? (
              <ul className="divide-y divide-line" aria-label="Auswahlmöglichkeiten">
                {poll.options.map((o) => (
                  <li key={o.id} className="min-w-0 break-words py-3 text-[15px]">
                    {o.label}
                  </li>
                ))}
              </ul>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  action.run(async () => {
                    await api(`/categories/${id}/ballot`, json('PUT', { option_ids: choices }));
                  }, 'Deine Stimme wurde gespeichert.');
                }}
              >
                <PeoplePicker
                  legend={`${poll.kind === 'person' ? 'Personen' : 'Optionen'} auswählen (bis zu ${poll.max_choices})`}
                  searchLabel={poll.kind === 'person' ? 'Person suchen' : 'Option suchen'}
                  options={poll.options.map((option) => ({
                    id: option.id,
                    name: option.label,
                    user_id: option.user_id,
                  }))}
                  selectedIds={choices}
                  onChange={setChoices}
                  maxSelected={poll.max_choices}
                  disabledUserIds={poll.allow_self_vote ? [] : [user.id]}
                  disabled={poll.status !== 'open' || !eligible || action.busy}
                />
                {poll.kind === 'person' && poll.all_people && (
                  <p className="text-sm text-muted">
                    Die Personenliste wurde beim Öffnen festgelegt und bleibt gleich.
                  </p>
                )}
                {poll.status === 'open' && (
                  <button
                    className={btn.primary}
                    disabled={
                      action.busy ||
                      choices.length === 0 ||
                      choices.length > poll.max_choices ||
                      !eligible ||
                      (poll.kind === 'person' &&
                        choices.some((choice) =>
                          poll.options.some(
                            (option) => option.id === choice && option.user_id === user.id && !poll.allow_self_vote,
                          ),
                        ))
                    }
                  >
                    {savedChoices.length ? 'Stimme ändern' : 'Stimme speichern'} <Arrow />
                  </button>
                )}
                {!eligible && <p className={notice}>Nur freigegebene Mitglieder des Jahrgangs dürfen abstimmen.</p>}
                {savedChoices.length > 0 && (
                  <p className="text-sm font-semibold text-ok">
                    Gespeicherte {savedChoices.length === 1 ? 'Stimme' : 'Stimmen'}:{' '}
                    {savedChoices
                      .map((choice) => poll.options.find((option) => option.id === choice)?.label)
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                )}
              </form>
            )}
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
                      {!poll.opened_at && (
                        <button className={btn.secondary} onClick={() => setEditing(true)}>
                          Definition bearbeiten
                        </button>
                      )}
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
                  {user.role === 'admin' && (poll.status !== 'draft' || poll.opened_at) && (
                    <button className={btn.secondary} onClick={() => setEditing(true)}>
                      Berechtigungen bearbeiten
                    </button>
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
                  {poll.status !== 'draft' && (
                    <button
                      className={btn.secondary}
                      disabled={action.busy}
                      onClick={() => setStatus('draft', 'Sammlung verborgen.')}
                    >
                      Sammlung verbergen
                    </button>
                  )}
                  {user.role === 'admin' && (
                    <button className={btn.danger} disabled={action.busy} onClick={deletePoll}>
                      Sammlung endgültig löschen
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
                              data-ballot-result
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
                      {auditGroups.map(({ key, rows }) => (
                        <tr className="border-t border-line" key={key}>
                          <td className="py-3 pr-4 align-top">{rows[0].user_name}</td>
                          <td className="py-3 pr-4 align-top">
                            <ul className="flex flex-wrap gap-1.5" aria-label="Ausgewählte Optionen">
                              {rows.map((row) => (
                                <li className="rounded-full bg-pop px-2.5 py-1 text-sm" key={row.option_id}>
                                  {row.option_label}
                                </li>
                              ))}
                            </ul>
                          </td>
                          <td className="py-3 text-right align-top tabular-nums">{date(rows[0].created_at)}</td>
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
