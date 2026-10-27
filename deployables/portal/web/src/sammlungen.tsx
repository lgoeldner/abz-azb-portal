import { useQueryClient } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
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
  type WordEntry,
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
import { EndDatePicker } from './EndDatePicker';
import { BallotForm, BallotPrivacyNotice } from './BallotForm';
import { PollStack } from './PollStack';
import { PhotoGallery, photosFromSubmissions } from './PhotoGallery';
import { DevDebug } from './DevDebug';
import { NotFound } from './pages';

const isKind = (value: string | null): value is Kind => allKinds.includes(value as Kind);

const debugData = (c: Category) => ({
  id: c.id,
  kind: c.kind,
  repeatable: c.repeatable,
  ongoing: c.ongoing,
  closesAt: c.closes_at,
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
  const fortlaufend = shown.filter((c) => c.ongoing);
  const ballots = shown.filter((c) => !c.ongoing);
  const groups: [Category['status'], string, string][] = [
    ['open', 'Offen', 'Jetzt mitmachen'],
    ['draft', 'Verborgen', 'Nur für die Redaktion sichtbar'],
    ['closed', 'Beendet', 'Die Sammlung ist abgeschlossen'],
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
                <span className="text-sm text-muted">Ohne festes Enddatum</span>
              </div>
              <Cards items={fortlaufend} />
            </section>
          )}
          {ballots.some((c) => singleKinds.includes(c.kind)) && (
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
              <Badge status={c.status} label={badgeLabel(c)} />
              <span className="hidden text-sm text-muted sm:block">
                {repeatableKinds.includes(c.kind) ? 'Beiträge lesen' : 'Ergebnisse ansehen'}
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
              <Badge status={c.status} label={badgeLabel(c)} />
            </div>
            <p className="text-sm text-muted">{c.description}</p>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line pt-3 text-sm text-muted">
              <span className="flex min-w-0 flex-1 items-start gap-1.5">
                <KindIcon icon={kindIcon[c.kind]} className="mt-[3px] size-4" />
                <span>
                  {kindLabel[c.kind]}
                  {singleKinds.includes(c.kind) &&
                    `, ${c.kind === 'words' ? (c.my_words?.length ? 'Deine Wörter sind gespeichert' : 'Wörter einreichen') : c.my_option_ids?.length || c.my_option_id ? 'Deine Stimme ist gespeichert' : plural(c.options.length, 'Option', 'Optionen')}`}
                </span>
              </span>
              <span className="inline-flex flex-none items-center gap-1 whitespace-nowrap font-semibold text-ink">
                {repeatableKinds.includes(c.kind) ? 'Beitragen' : c.status === 'open' ? 'Abstimmen' : 'Ansehen'}{' '}
                <Arrow />
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
function localDeadline(value?: string | null) {
  if (!value) return '';
  const end = new Date(value);
  return new Date(end.getTime() - end.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function SammlungForm({ sammlung, onSaved }: { sammlung?: Category | null; onSaved: () => void }) {
  const { user } = useSession();
  const action = useAction();
  const current = useRef<Category | null>(sammlung ?? null);
  const [kind, setKind] = useState<Kind>(sammlung?.kind ?? 'memory');
  const [repeatable, setRepeatable] = useState(sammlung?.repeatable ?? true);
  const repeatabilityChosen = useRef(false);
  const [ongoing, setOngoing] = useState(sammlung?.ongoing ?? true);
  const [closesAt, setClosesAt] = useState(() => localDeadline(sammlung?.closes_at));
  const single = singleKinds.includes(kind);
  const definitionLocked =
    !!sammlung && singleKinds.includes(sammlung.kind) && (sammlung.status !== 'draft' || Boolean(sammlung.opened_at));
  const users = useData<User[]>('/admin/users', user.role === 'admin');
  const [grants, setGrants] = useState<Record<string, boolean>>({});
  const managers = (users.data ?? []).filter((u) => u.role === 'manager');
  const roster = useData<{ id: string; name: string }[]>('/roster', kind === 'person');
  const [allPeople, setAllPeople] = useState(sammlung?.kind === 'person' ? sammlung.all_people : true);
  const [allowSelfVote, setAllowSelfVote] = useState(sammlung?.allow_self_vote ?? false);
  const [maxChoices, setMaxChoices] = useState(sammlung?.max_choices ?? 1);
  const [selected, setSelected] = useState<string[]>(
    sammlung?.options.flatMap((o) => (o.user_id ? [o.user_id] : [])) ?? [],
  );
  const [options, setOptions] = useState(sammlung?.options.map((o) => o.label) ?? []);
  const [optionDraft, setOptionDraft] = useState('');
  const classes = sammlung ? (single ? singleKinds : repeatableKinds) : allKinds;
  function addOption() {
    const next = optionDraft.trim();
    if (
      !next ||
      next.length > 300 ||
      options.length >= 500 ||
      options.some((option) => option.toLowerCase() === next.toLowerCase())
    )
      return;
    setOptions([...options, next]);
    setOptionDraft('');
  }
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    action.run(async () => {
      const proposalOptions = options.map((option) => option.trim()).filter(Boolean);
      const pendingOption = optionDraft.trim();
      if (!definitionLocked && single && kind === 'proposal' && pendingOption) {
        if (pendingOption.length > 300) throw new Error('Antwortoptionen dürfen höchstens 300 Zeichen lang sein.');
        if (proposalOptions.some((option) => option.toLowerCase() === pendingOption.toLowerCase()))
          throw new Error('Diese Antwortoption ist bereits vorhanden.');
        proposalOptions.push(pendingOption);
      }
      if (!definitionLocked && single && kind === 'proposal' && proposalOptions.length > 500)
        throw new Error('Es sind höchstens 500 Antwortoptionen erlaubt.');
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
          : kind === 'words'
            ? []
            : proposalOptions.map((text) => ({ label: text }));
      if (!definitionLocked && single && kind === 'proposal' && choices.length < 2)
        throw new Error('Bitte mindestens zwei Optionen auswählen.');
      if (!definitionLocked && single && kind === 'person' && !allPeople && choices.length < 2)
        throw new Error('Bitte mindestens zwei Kandidat:innen auswählen.');
      if (!definitionLocked && single && (!Number.isInteger(maxChoices) || maxChoices < 1 || maxChoices > 500))
        throw new Error('Die Zahl der auswählbaren Optionen muss zwischen 1 und 500 liegen.');
      // A retry after a failed follow-up step must update the Sammlung saved by the first attempt, not create another.
      const target = current.current;
      const deadlineChanged = !ongoing && closesAt !== localDeadline(target?.closes_at);
      if (!ongoing && (!target || deadlineChanged) && (!closesAt || new Date(closesAt).getTime() <= Date.now()))
        throw new Error('Bitte ein Enddatum in der Zukunft auswählen.');
      const deadline = ongoing
        ? null
        : deadlineChanged || !target
          ? new Date(closesAt).toISOString()
          : target.closes_at;
      const saved = definitionLocked
        ? deadlineChanged && target
          ? await api<Category>(
              `/categories/${target.id}`,
              json('PATCH', { version: target.version, closes_at: deadline }),
            )
          : target!
        : await api<Category>(
            target ? `/categories/${target.id}` : '/categories',
            json(target ? 'PATCH' : 'POST', {
              ...(target ? { version: target.version } : {}),
              name: data.get('name'),
              description: data.get('description'),
              kind,
              repeatable,
              ongoing,
              closes_at: deadline,
              allow_self_vote: single && kind !== 'words' && allowSelfVote,
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
        {definitionLocked && ongoing ? 'Berechtigungen bearbeiten' : sammlung ? 'Sammlung bearbeiten' : 'Neue Sammlung'}
      </h2>
      {definitionLocked ? (
        <p className="text-sm text-muted">
          Die Definition ist seit dem Öffnen gesperrt.
          {!ongoing && ' Das Enddatum bleibt änderbar.'}
          {user.role === 'admin' && ' Berechtigungen bleiben änderbar.'}
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
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center justify-between gap-4 text-[15px]">
              <span>Wiederholbar</span>
              <input
                className="peer sr-only"
                type="checkbox"
                role="switch"
                checked={repeatable}
                disabled={!!sammlung || action.busy}
                onChange={(event) => {
                  repeatabilityChosen.current = true;
                  setRepeatable(event.target.checked);
                }}
              />
              <span className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full bg-pill transition-colors after:absolute after:left-1 after:size-5 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-ink peer-checked:after:translate-x-5 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:cursor-not-allowed peer-disabled:opacity-60"></span>
            </label>
            <p className="text-sm text-muted">
              {repeatable
                ? 'Mehrere Beiträge oder Abstimmungen pro Person erlauben.'
                : 'Ein Beitrag oder eine änderbare Stimme pro Person.'}
            </p>
          </div>
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center justify-between gap-4 text-[15px]">
              <span>Fortlaufend</span>
              <input
                className="peer sr-only"
                type="checkbox"
                role="switch"
                checked={ongoing}
                disabled={!!sammlung || action.busy}
                onChange={(event) => setOngoing(event.target.checked)}
              />
              <span className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full bg-pill transition-colors after:absolute after:left-1 after:size-5 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-ink peer-checked:after:translate-x-5 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:opacity-60"></span>
            </label>
            <p className="text-sm text-muted">
              {ongoing ? 'Bleibt bis zum manuellen Schließen offen.' : 'Schließt automatisch zum Enddatum.'}
            </p>
          </div>
          {sammlung && (
            <p className="text-sm text-muted">Wiederholbarkeit und Fortlaufend stehen nach dem Anlegen fest.</p>
          )}
          <label className={label}>
            Klasse
            <select
              className={field}
              value={kind}
              onChange={(e) => {
                const next = e.target.value as Kind;
                setKind(next);
                if (!sammlung && !repeatabilityChosen.current) setRepeatable(repeatableKinds.includes(next));
                if (!sammlung && next === 'words') setMaxChoices(3);
              }}
            >
              {classes.map((k) => (
                <option key={k} value={k}>
                  {kindLabel[k]}
                </option>
              ))}
            </select>
          </label>
          {single &&
            (kind === 'words' ? (
              <p className="text-sm text-muted">
                Die Abstimmenden geben eigene Wörter ein. Ähnliche Wörter können später zusammengeführt werden.
              </p>
            ) : kind === 'proposal' ? (
              <div className="space-y-3">
                <label className={label}>
                  Antwortoption hinzufügen
                  <input
                    className={field}
                    type="text"
                    maxLength={300}
                    placeholder="Option eingeben"
                    value={optionDraft}
                    disabled={action.busy}
                    onChange={(event) => setOptionDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addOption();
                      }
                    }}
                  />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className={btn.secondary}
                    disabled={action.busy || !optionDraft.trim() || options.length >= 500}
                    onClick={addOption}
                  >
                    Hinzufügen
                  </button>
                  <span className="text-sm text-muted">{options.length} von 500 Optionen</span>
                </div>
                {options.length > 0 && (
                  <ul className="flex flex-wrap gap-2" aria-label="Antwortoptionen">
                    {options.map((option, index) => (
                      <li key={`${index}-${option}`} className="min-w-0 max-w-full">
                        <button
                          type="button"
                          className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-full bg-pop px-3 text-sm font-semibold text-ink hover:bg-pill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-60"
                          aria-label={`${option} entfernen`}
                          disabled={action.busy}
                          onClick={() => setOptions(options.filter((_, itemIndex) => itemIndex !== index))}
                        >
                          <span className="min-w-0 break-words">{option}</span>
                          <span className="shrink-0" aria-hidden="true">
                            ×
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
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
                  {kind === 'words' ? 'Maximale Zahl der Wörter pro Person' : 'Maximale Zahl der Stimmen pro Person'}
                </label>
                <div className="flex items-center gap-4">
                  <button
                    className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white text-ink transition hover:bg-pill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-40"
                    type="button"
                    aria-label={
                      kind === 'person' ? 'Weniger Personen' : kind === 'words' ? 'Weniger Wörter' : 'Weniger Optionen'
                    }
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
                    aria-label={
                      kind === 'person' ? 'Mehr Personen' : kind === 'words' ? 'Mehr Wörter' : 'Mehr Optionen'
                    }
                    disabled={maxChoices >= 500 || action.busy}
                    onClick={() => setMaxChoices((value) => Math.max(1, Math.min(500, value + 1)))}
                  >
                    <Plus aria-hidden="true" size={24} />
                  </button>
                </div>
              </div>
              {kind !== 'words' && (
                <label className="flex cursor-pointer items-center justify-between gap-4 text-[15px]">
                  <span>Stimme für die eigene Person erlauben</span>
                  <input
                    className="peer sr-only"
                    type="checkbox"
                    role="switch"
                    checked={allowSelfVote}
                    disabled={action.busy}
                    onChange={(event) => setAllowSelfVote(event.target.checked)}
                  />
                  <span className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full bg-pill transition-colors after:absolute after:left-1 after:size-5 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-ink peer-checked:after:translate-x-5 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink"></span>
                </label>
              )}
              <p className="text-sm text-muted">
                {`Pro Person bis zu ${maxChoices} Stimme(n).`} Nach dem Öffnen ist die Definition gesperrt.
              </p>
            </>
          )}
        </>
      )}
      {!ongoing && (
        <EndDatePicker value={closesAt} onChange={setClosesAt} disabled={action.busy || (!!sammlung && !single)} />
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
          {definitionLocked && ongoing ? 'Berechtigungen speichern' : 'Sammlung speichern'}
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
  return repeatableKinds.includes(sammlung.kind) ? (
    <Fortlaufend key={sammlung.id} sammlung={sammlung} />
  ) : (
    <Ballot key={sammlung.id} sammlung={sammlung} categories={categories.data ?? []} />
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
      {sammlung.closes_at && <span className="block text-sm text-muted">Ende: {date(sammlung.closes_at)}</span>}
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
  const action = useAction();
  const setStatus = (status: Category['status']) =>
    action.run(
      () => api(`/categories/${sammlung.id}/status`, json('POST', { version: sammlung.version, status })),
      'Sammlungsstatus gespeichert.',
    );
  const submissions = useData<Submission[]>(`/submissions?category_id=${sammlung.id}`);
  const items = (submissions.data ?? []).filter((s) =>
    `${s.title} ${s.body} ${s.author_name} ${s.attachments.map((a) => a.caption).join(' ')}`
      .toLocaleLowerCase('de')
      .includes(search.toLocaleLowerCase('de')),
  );
  const photoCollection = sammlung.kind === 'photo';
  const photos = photosFromSubmissions(items, (submission) => `/redaktion/beitraege/${submission.id}`);
  const withoutPhotos = items.filter((submission) => !submission.attachments.length);
  return (
    <>
      <BackLink />
      <PageHead
        title={sammlung.name}
        action={
          <div className="flex flex-wrap gap-3">
            {canEdit(user, sammlung.id) && (
              <>
                {sammlung.status === 'draft' && (
                  <button className={btn.primary} disabled={action.busy} onClick={() => setStatus('open')}>
                    Sammlung öffnen
                  </button>
                )}
                {sammlung.status === 'open' && (
                  <button className={btn.secondary} disabled={action.busy} onClick={() => setStatus('closed')}>
                    Sammlung schließen
                  </button>
                )}
                {sammlung.status !== 'draft' && (
                  <button className={btn.secondary} disabled={action.busy} onClick={() => setStatus('draft')}>
                    Sammlung verbergen
                  </button>
                )}
              </>
            )}
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
      {action.feedback}
      {editing && canEdit(user, sammlung.id) && (
        <SammlungForm key={sammlung.id} sammlung={sammlung} onSaved={() => setEditing(false)} />
      )}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className={heading}>{photoCollection ? 'Gesammelte Fotos' : 'Gesammelte Beiträge'}</h2>
          <p className="mt-1 text-sm text-muted">
            {photoCollection
              ? 'Alle eingereichten Fotos ansehen und ihre Bildtexte lesen.'
              : 'Originale lesen und Anmerkungen für die spätere Moderation festhalten.'}
          </p>
        </div>
        <label className={`${label} w-full sm:w-72`}>
          Suchen
          <input
            type="search"
            maxLength={200}
            className={field}
            placeholder={photoCollection ? 'Bildtext, Name …' : 'Titel, Text, Name …'}
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
              photoCollection ? (
                `${photos.length} von ${submissions.data.reduce((count, item) => count + item.attachments.length, 0)} Fotos`
              ) : (
                `${items.length} von ${submissions.data.length} Beiträgen`
              )
            ) : (
              <>
                <strong style={{ color: 'var(--editorial-data)' }}>
                  {photoCollection ? photos.length : items.length}
                </strong>{' '}
                {photoCollection
                  ? photos.length === 1
                    ? 'Foto'
                    : 'Fotos'
                  : items.length === 1
                    ? 'Beitrag'
                    : 'Beiträge'}
              </>
            )}
          </p>
          {photoCollection ? (
            <>
              {photos.length > 0 && <PhotoGallery photos={photos} />}
              {withoutPhotos.length > 0 && (
                <section className={photos.length ? 'mt-8' : undefined}>
                  <h3 className="mb-3 text-sm font-bold">Einträge ohne Foto</h3>
                  <SubmissionList items={withoutPhotos} categories={[sammlung]} showAuthor editorialView />
                </section>
              )}
              {!photos.length && !withoutPhotos.length && (
                <Empty>{search ? 'Keine Fotos zu dieser Suche.' : 'Hier sind noch keine Fotos eingegangen.'}</Empty>
              )}
            </>
          ) : items.length ? (
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
  const queryClient = useQueryClient();
  const action = useAction();
  const submissions = useData<Submission[]>('/submissions');
  const categories = useData<Category[]>('/categories');
  const mine = (submissions.data ?? []).filter((s) => s.category_id === sammlung.id);
  const own = mine.filter((s) => s.author_id === user.id);
  const photoCollection = sammlung.kind === 'photo';
  const photos = photosFromSubmissions(own);
  const ownerByPhoto = new Map(own.flatMap((entry) => entry.attachments.map((photo) => [photo.id, entry] as const)));
  const withoutPhotos = own.filter((submission) => !submission.attachments.length);
  return (
    <>
      <BackLink />
      <PageHead title={sammlung.name}>
        <ClassLine sammlung={sammlung} />
      </PageHead>
      <DevDebug label="Sammlung" data={debugData(sammlung)} />
      <div>
        <section className={`${photoCollection ? '' : panel} min-w-0 space-y-5`}>
          <h2 className={heading}>
            {photoCollection
              ? sammlung.repeatable
                ? 'Fotos beisteuern'
                : 'Einmal Fotos beisteuern'
              : sammlung.repeatable
                ? 'Beliebig oft beitragen'
                : 'Einmal beitragen'}
          </h2>
          <p className="text-sm text-muted">
            {photoCollection
              ? 'Lade deine Fotos mit einem optionalen Bildtext hoch. Nur du und die Redaktion sehen deine Beiträge.'
              : sammlung.repeatable
                ? 'Du kannst hier so viele Beiträge einreichen, wie du möchtest.'
                : 'Du kannst hier einen Beitrag einreichen und deinen eigenen Beitrag anschließend bearbeiten.'}
          </p>
          {!submissions.isPending &&
            !submissions.error &&
            sammlung.status === 'open' &&
            (sammlung.repeatable ||
              !own.length ||
              (photoCollection && own.some((entry) => entry.status === 'pending'))) && (
              <Link className={btn.primary} to={`/beitraege/neu?kategorie=${sammlung.id}`}>
                {photoCollection ? 'Fotos hochladen' : 'Beitrag einreichen'} <Arrow />
              </Link>
            )}
          {sammlung.status === 'closed' && (
            <p className={notice}>Diese Sammlung ist beendet. Deine bisherigen Beiträge bleiben hier sichtbar.</p>
          )}
          <h3 className="pt-2 text-sm font-bold">{photoCollection ? 'Deine Fotos' : 'Deine Beiträge hier'}</h3>
          {submissions.isPending ? (
            <Loading />
          ) : submissions.error ? (
            <Failure error={submissions.error} retry={() => submissions.refetch()} />
          ) : photoCollection ? (
            <>
              {photos.length > 0 && (
                <PhotoGallery
                  photos={photos}
                  busy={action.busy}
                  detailsFor={(photo) => `/beitraege/${ownerByPhoto.get(photo.id)!.id}`}
                  allowCaptionEdit={(photo) => ownerByPhoto.get(photo.id)?.status === 'pending'}
                  onSaveCaption={async (attachmentId, caption) => {
                    const entry = ownerByPhoto.get(attachmentId)!;
                    try {
                      await api(
                        `/submissions/${entry.id}/attachments/${attachmentId}`,
                        json('PATCH', { version: entry.version, caption }),
                      );
                    } finally {
                      await queryClient.invalidateQueries();
                    }
                  }}
                  canRemove={(photo) => {
                    const entry = ownerByPhoto.get(photo.id)!;
                    return entry.status === 'pending' && entry.attachments.length > 1;
                  }}
                  onRemove={(photo) => {
                    const entry = ownerByPhoto.get(photo.id)!;
                    void action.run(
                      () =>
                        api(
                          `/submissions/${entry.id}/attachments/${photo.id}`,
                          json('DELETE', { version: entry.version }),
                        ),
                      'Foto entfernt.',
                    );
                  }}
                />
              )}
              {action.feedback}
              {withoutPhotos.length > 0 && (
                <ul
                  className={`overflow-hidden rounded-ui border-2 border-line bg-white${photos.length ? ' mt-8' : ''}`}
                  aria-label="Einträge ohne Foto"
                >
                  {withoutPhotos.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 last:border-b-0"
                    >
                      <Link className="min-w-0 flex-1" to={`/beitraege/${entry.id}`}>
                        <strong className="block break-words text-[15px] font-semibold">{entry.title}</strong>
                        <span className="mt-1 block text-sm text-muted">
                          {entry.status === 'pending' ? 'Noch ohne Foto' : 'Älterer Eintrag ohne Foto'}
                        </span>
                      </Link>
                      {entry.status === 'pending' && (
                        <Link className={btn.secondary} to={`/beitraege/${entry.id}`}>
                          Foto ergänzen <Arrow />
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!photos.length && !withoutPhotos.length && <Empty>Du hast hier noch keine Fotos eingereicht.</Empty>}
            </>
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

function Ballot({ sammlung: poll, categories }: { sammlung: Category; categories: Category[] }) {
  const [view] = useWorkspaceView();
  const redaktion = view === 'redaktion';
  const { user } = useSession();
  const navigate = useNavigate();
  const id = poll.id;
  const action = useAction();
  const savedChoices =
    poll.kind === 'words'
      ? (poll.my_words ?? [])
      : poll.my_option_ids?.length
        ? poll.my_option_ids
        : poll.my_option_id
          ? [poll.my_option_id]
          : [];
  const savedChoicesKey = savedChoices.join('\u0000');
  const [choices, setChoices] = useState<string[]>(savedChoices);
  const [syncedChoicesKey, setSyncedChoicesKey] = useState(savedChoicesKey);
  const [editing, setEditing] = useState(false);
  const results = useData<PollResult[]>(`/categories/${id}/results`, redaktion && editorial(user));
  const wordEntries = useData<WordEntry[]>(
    `/categories/${id}/words`,
    redaktion && editorial(user) && poll.kind === 'words',
  );
  const [auditOpen, setAuditOpen] = useState(false);
  const audit = useData<BallotAudit[]>(`/categories/${id}/audit`, redaktion && auditOpen && user.role === 'admin');
  if (syncedChoicesKey !== savedChoicesKey) {
    setSyncedChoicesKey(savedChoicesKey);
    setChoices(savedChoices);
  } // reset the selection when the saved ballot changes
  const writable = canEdit(user, poll.id);
  const stackItems = [
    poll,
    ...categories
      .filter(
        (category) =>
          category.id !== poll.id &&
          singleKinds.includes(category.kind) &&
          category.status === 'open' &&
          (category.repeatable ||
            !(category.my_words?.length || category.my_option_ids?.length || category.my_option_id)),
      )
      .sort(newestOpened),
  ];
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
      <PageHead
        title={!redaktion && poll.status === 'open' ? 'Abstimmen' : poll.name}
        action={
          redaktion || poll.status !== 'open' ? <Badge status={poll.status} label={badgeLabel(poll)} /> : undefined
        }
      >
        {!redaktion && poll.status === 'open' ? 'Deine Stimme entscheidet mit.' : <ClassLine sammlung={poll} />}
      </PageHead>
      <DevDebug label="Sammlung" data={debugData(poll)} />
      {action.feedback}
      {editing && writable ? (
        <SammlungForm sammlung={poll} onSaved={() => setEditing(false)} />
      ) : (
        <div
          className={
            redaktion
              ? poll.kind === 'words'
                ? 'grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2.5fr)_minmax(220px,0.75fr)] lg:items-start'
                : 'grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(240px,1fr)] lg:items-start'
              : undefined
          }
        >
          {redaktion && poll.kind === 'words' ? (
            <section className={`${panel} min-w-0 space-y-6`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className={heading}>Gesamtergebnisse</h2>
                  <p className="mt-1 text-sm text-muted">
                    Nur für die Redaktion. {poll.ballot_count ?? 0} Teilnehmende, {total} gültige Nennungen.
                  </p>
                </div>
                <a className={btn.text} href={`/api/v1/categories/${id}/words/export`}>
                  Wortliste als CSV herunterladen <Arrow />
                </a>
              </div>
              {results.isPending ? (
                <Loading />
              ) : results.error ? (
                <Failure error={results.error} retry={() => results.refetch()} />
              ) : (
                <div className="space-y-4">
                  <h3 className={heading}>Wortwolke</h3>
                  <WordCloud entries={results.data ?? []} total={total} />
                </div>
              )}
              <section className="space-y-4 border-t border-line pt-6">
                <h3 className={heading}>Stimmen</h3>
                <p className="text-sm text-muted">
                  Anonyme Einträge. Bei entsprechender Berechtigung kannst du Begriffe über die Wortchips ausschließen
                  oder wiederherstellen. Gleiche Bezeichnungen werden in der Wortwolke zusammengezählt.
                </p>
                {wordEntries.isPending ? (
                  <Loading />
                ) : wordEntries.error ? (
                  <Failure error={wordEntries.error} retry={() => wordEntries.refetch()} />
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-2" aria-label="Eingegebene Wörter">
                    {wordEntries.data?.map((entry) => (
                      <WordEntryRow
                        key={`${entry.option_id}:${entry.version}`}
                        categoryId={id}
                        entry={entry}
                        editable={writable}
                      />
                    ))}
                  </ul>
                )}
              </section>
              <BallotPrivacyNotice />
            </section>
          ) : !redaktion && poll.status === 'open' ? (
            <PollStack items={stackItems} initialId={poll.id} />
          ) : (
            <section className={`${redaktion ? panel : 'poll-stack__card'} min-w-0 space-y-5`}>
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
                <BallotForm poll={poll} choices={choices} onChoicesChange={setChoices} />
              )}
              {redaktion && <BallotPrivacyNotice />}
            </section>
          )}
          {redaktion && (
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
                    {(user.role === 'admin' || !poll.ongoing) && (poll.status !== 'draft' || poll.opened_at) && (
                      <button className={btn.secondary} onClick={() => setEditing(true)}>
                        {poll.ongoing ? 'Berechtigungen bearbeiten' : 'Enddatum bearbeiten'}
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
              {editorial(user) && poll.kind !== 'words' && (
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
          )}
        </div>
      )}
      {redaktion && user.role === 'admin' && (
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

function WordCloud({ entries, total }: { entries: PollResult[]; total: number }) {
  const largest = Math.max(1, ...entries.map((entry) => entry.count));
  return (
    <div className="mt-5 rounded-ui bg-white px-4 py-6 sm:px-6">
      <p className="mb-4 text-xs text-muted">
        Häufigere Wörter erscheinen größer. Die Zahl daneben zeigt die Nennungen.
      </p>
      {entries.length ? (
        <ul
          className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3 text-center"
          aria-label={`Wortwolke mit ${entries.length} ${entries.length === 1 ? 'Begriff' : 'Begriffen'} und ${total} ${total === 1 ? 'Nennung' : 'Nennungen'}`}
        >
          {entries.map((entry) => (
            <li
              key={entry.option_id}
              className="max-w-full break-words font-extrabold leading-tight text-ink"
              aria-label={`${entry.label}: ${entry.count} ${entry.count === 1 ? 'Nennung' : 'Nennungen'}`}
              style={{ fontSize: `${1 + (entry.count / largest) * 1.5}rem` }}
            >
              {entry.label} <span className="align-baseline text-sm font-semibold text-muted">{entry.count}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-center text-sm text-muted">Noch keine gültigen Wörter.</p>
      )}
    </div>
  );
}

function WordEntryRow({ categoryId, entry, editable }: { categoryId: string; entry: WordEntry; editable: boolean }) {
  const action = useAction();
  const [labelValue, setLabelValue] = useState(entry.label);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLLIElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  const normalizedLabel = labelValue.trim().toLowerCase().normalize('NFC');
  const validLabel =
    Boolean(normalizedLabel) &&
    !/\s/u.test(normalizedLabel) &&
    !/\p{Cc}/u.test(normalizedLabel) &&
    Array.from(normalizedLabel).length <= 64;
  const canSave = validLabel && normalizedLabel !== entry.label;

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLInputElement>('input')?.focus();
    const down = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  function updateWord(label: string, excluded: boolean, message: string) {
    return action.run(
      () =>
        api(
          `/categories/${categoryId}/words/${entry.option_id}`,
          json('PATCH', { version: entry.version, label, excluded }),
        ),
      message,
    );
  }

  return (
    <li ref={box} className="relative min-w-0 rounded-ui bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        {editable ? (
          <button
            ref={trigger}
            className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${entry.excluded ? 'bg-pill text-muted line-through' : 'bg-pop text-ink'}`}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={`Aktionen für Begriff ${entry.word}`}
            onClick={() => {
              setLabelValue(entry.label);
              setOpen((value) => !value);
            }}
          >
            <span className="break-all">{entry.word}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted">{entry.count}</span>
          </button>
        ) : (
          <span
            className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${entry.excluded ? 'bg-pill text-muted line-through' : 'bg-pop text-ink'}`}
          >
            <span className="break-all">{entry.word}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted">{entry.count}</span>
          </span>
        )}
        {entry.label !== entry.word && <span className="text-sm text-muted">→ {entry.label}</span>}
      </div>
      {editable && open && (
        <div
          role="dialog"
          aria-label={`Begriff ${entry.word} bearbeiten`}
          className="absolute left-0 top-12 z-20 w-full max-w-sm rounded-ui border border-line bg-white p-3 shadow-lg"
        >
          <div className="flex flex-wrap items-end gap-2">
            <label
              className="w-full min-w-0 text-xs font-semibold text-muted"
              htmlFor={`word-label-${entry.option_id}`}
            >
              Bezeichnung bearbeiten
              <input
                className="mt-1.5 block min-h-10 w-full rounded-ui border-2 border-line bg-white px-3 py-1.5 text-sm font-normal text-ink focus:border-ink"
                id={`word-label-${entry.option_id}`}
                maxLength={64}
                value={labelValue}
                disabled={action.busy}
                onChange={(event) => setLabelValue(event.target.value)}
              />
            </label>
            <button
              className="rounded-full bg-ink px-3.5 py-2 text-xs font-bold text-white hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              type="button"
              disabled={action.busy || !canSave}
              onClick={() => void updateWord(normalizedLabel, entry.excluded, 'Begriff aktualisiert.')}
            >
              Umbenennen
            </button>
            <button
              className="rounded-full border border-line px-3.5 py-2 text-xs font-bold text-ink hover:bg-pill disabled:opacity-40"
              type="button"
              disabled={action.busy}
              onClick={() =>
                void updateWord(
                  entry.label,
                  !entry.excluded,
                  entry.excluded ? 'Begriff wiederhergestellt.' : 'Begriff ausgeschlossen.',
                )
              }
            >
              {entry.excluded ? 'Wiederherstellen' : 'Ausschließen'}
            </button>
          </div>
          {labelValue && !validLabel && (
            <p className="mt-2 text-xs text-bad" role="alert">
              Ein Begriff muss ein einzelnes Wort mit höchstens 64 Zeichen sein.
            </p>
          )}
        </div>
      )}
      {action.feedback}
    </li>
  );
}
