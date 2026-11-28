import { ChevronLeft, LogOut, Plus, Settings } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  api,
  ApiError,
  editorial,
  json,
  setCsrf,
  type Category,
  type Me,
  type MyBallot,
  type Submission,
  day,
} from './api';
import {
  Arrow,
  Empty,
  Failure,
  KindIcon,
  Loading,
  PageHead,
  Session,
  SubmissionList,
  btn,
  Avatar,
  isBallot,
  isSubmissionCollection,
  heading,
  kindIcon,
  kindLabel,
  Mark,
  newestOpened,
  notice,
  projectsEnabled,
  roundButton,
  useAction,
  useData,
  useSession,
  useView,
  WorkspaceView,
  useWorkspaceView,
  type View,
} from './ui';
import { ActivityLog, People } from './admin';
import { AreasAdmin } from './AreasAdmin';
import { Board, NewTicket, TicketPage } from './tickets';
import { BentoMenu } from './BentoMenu';
import { DocumentPage, DocumentsPage, NewDocument } from './Documents';
import { EmailAdmin } from './EmailAdmin';
import { ContributionDetail, Contributions, Editorial, NewContribution, NotFound } from './pages';
import { SammlungDetail, Sammlungen } from './sammlungen';
import { offerKey, PasskeyOffer } from './Passkeys';
import { Settings as AccountSettings } from './Settings';
import { ConsentStep, LegalLinks } from './Consent';
import { DevDebug } from './DevDebug';
import { PollStack } from './PollStack';

export function App() {
  const me = useData<Me>('/me');
  useEffect(() => {
    if (me.data) setCsrf(me.data.csrf_token);
  }, [me.data]);
  if (me.isPending)
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <Loading />
      </main>
    );
  if (me.error)
    return me.error instanceof ApiError && me.error.status === 401 ? (
      <Login />
    ) : (
      <main className="grid min-h-screen place-items-center p-6">
        <Failure error={me.error} retry={() => me.refetch()} />
      </main>
    );
  if (!me.data.user.admitted)
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <section className="flex w-full max-w-md flex-col items-start gap-5 rounded-ui bg-white p-6 sm:p-8">
          <Brand />
          <h1 className="text-3xl font-extrabold tracking-tight">Dein Platz ist reserviert.</h1>
          <p className="text-[15px] text-muted">
            Die Administration muss deinen Zugang noch freigeben. Melde dich beim Abizeitungsteam.
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <button type="button" className={btn.secondary} onClick={() => me.refetch()}>
              Freigabe prüfen
            </button>
            <Logout />
          </div>
        </section>
      </main>
    );
  if (me.data.consent_required)
    return <ConsentStep brand={<Brand />} logout={<Logout />} onAccepted={() => me.refetch()} />;
  return (
    <Session.Provider value={me.data}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<StudentHome />} />
          <Route path="einstellungen" element={<AccountSettings />} />
          <Route path="beitraege" element={<Contributions />} />
          <Route path="beitraege/neu" element={<NewContribution />} />
          <Route path="beitraege/:id" element={<ContributionDetail />} />
          <Route path="sammlungen" element={<Sammlungen />} />
          <Route path="sammlungen/:id" element={<SammlungDetail />} />
          <Route path="abstimmungen" element={<RedirectKeepSearch to="/sammlungen" />} />
          <Route path="abstimmungen/:id" element={<RedirectToSammlung />} />
          <Route
            path="redaktion"
            element={
              // The menu replaced the Redaktion dashboard; the path stays as the editors' entry.
              <RoleGuard>
                <Navigate to={projectsEnabled(me.data) ? '/tickets' : '/redaktion/beitraege'} replace />
              </RoleGuard>
            }
          />
          <Route
            path="redaktion/beitraege"
            element={
              <RoleGuard>
                <Editorial />
              </RoleGuard>
            }
          />
          <Route
            path="redaktion/beitraege/:id"
            element={
              <RoleGuard>
                <ContributionDetail />
              </RoleGuard>
            }
          />
          <Route path="admin" element={<Navigate to="/verwaltung/personen" replace />} />
          <Route
            path="verwaltung/personen"
            element={
              <RoleGuard admin>
                <People />
              </RoleGuard>
            }
          />
          <Route
            path="verwaltung/sammlungen"
            element={
              <RoleGuard admin>
                <RedirectKeepSearch to="/sammlungen" />
              </RoleGuard>
            }
          />
          <Route path="verwaltung/rubriken" element={<Navigate to="/verwaltung/sammlungen" replace />} />
          <Route
            path="verwaltung/protokoll"
            element={
              <RoleGuard admin>
                <ActivityLog />
              </RoleGuard>
            }
          />
          <Route
            path="verwaltung/email"
            element={
              <RoleGuard admin>
                <EmailAdmin />
              </RoleGuard>
            }
          />
          <Route
            path="dokumente"
            element={
              <RoleGuard projects>
                <DocumentsPage />
              </RoleGuard>
            }
          />
          <Route
            path="dokumente/neu"
            element={
              <RoleGuard projects>
                <NewDocument />
              </RoleGuard>
            }
          />
          <Route
            path="dokumente/:id"
            element={
              <RoleGuard projects>
                <DocumentPage />
              </RoleGuard>
            }
          />
          <Route
            path="tickets"
            element={
              <RoleGuard projects>
                <Board />
              </RoleGuard>
            }
          />
          <Route
            path="tickets/neu"
            element={
              <RoleGuard projects>
                <NewTicket />
              </RoleGuard>
            }
          />
          <Route
            path="tickets/:id"
            element={
              <RoleGuard projects>
                <TicketPage />
              </RoleGuard>
            }
          />
          <Route
            path="verwaltung/bereiche"
            element={
              <RoleGuard admin projects>
                <AreasAdmin />
              </RoleGuard>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Session.Provider>
  );
}

// ---------- small helpers ----------
// Old bookmarks: /abstimmungen[/:id] now live under /sammlungen.
function RedirectKeepSearch({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}
function RedirectToSammlung() {
  const { id } = useParams();
  return <Navigate to={`/sammlungen/${id}`} replace />;
}
function Brand({ large = false }: { large?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Mark className={large ? 'size-12' : 'size-8'} />
      <span className={`font-extrabold tracking-tighter ${large ? 'text-3xl' : 'text-xl'}`}>
        AbiZeit<span className="text-accent">Betrug</span>.
      </span>
    </span>
  );
}
function Logout({ compact = false }: { compact?: boolean }) {
  const action = useAction();
  return (
    <>
      {action.feedback}
      <button
        type="button"
        className={
          compact
            ? `${roundButton} bg-red-100 text-red-700 hover:border-red-700 hover:bg-red-600 hover:text-white hover:shadow-[0_4px_0_var(--color-red-700)] disabled:opacity-50`
            : btn.text
        }
        aria-label={compact ? 'Abmelden' : undefined}
        disabled={action.busy}
        onClick={() =>
          action.run(async () => {
            await api('/auth/logout', json('POST'));
            window.location.assign('/');
          })
        }
      >
        {compact ? (
          <LogOut aria-hidden="true" className="size-6" />
        ) : (
          <>
            Abmelden <Arrow />
          </>
        )}
      </button>
    </>
  );
}

function Login() {
  return (
    <main className="grid min-h-screen bg-paper md:grid-cols-[1.15fr_1fr]">
      <section className="flex flex-col justify-between gap-12 p-6 sm:p-10 lg:p-14">
        <Brand large />
        <div>
          <span
            aria-hidden="true"
            className="block select-none -rotate-6 text-[min(40vw,15rem)] font-extrabold leading-[.8] tracking-tighter text-pop"
          >
            27
          </span>
          <h1 className="mt-8 text-5xl font-extrabold leading-[1.02] tracking-tighter sm:text-7xl">
            Die beste Zeit.
            <br />
            <span className="text-muted">Zum Festhalten.</span>
          </h1>
          <p className="mt-4 max-w-md text-[17px] text-muted">
            13 Jahre Schule. Unzählige Geschichten.
            <br />
            Hier entsteht unsere Abizeitung.
          </p>
        </div>
        <p className="text-sm text-muted">LMGU 2027. Unser Jahrgang, unsere Geschichten.</p>
      </section>
      <section className="flex items-center bg-chrome p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-md rounded-ui bg-white p-6 sm:p-8">
          <h2 className="text-3xl font-extrabold tracking-tight">Schön, dass du da bist.</h2>
          <p className="mt-3 text-[15px] text-muted">
            Melde dich an, um Erinnerungen einzureichen und bei unseren Abstimmungen mitzumachen.
          </p>
          <a className={`${btn.primary} mt-6 w-full`} href="/auth/login">
            Anmelden <Arrow />
          </a>
          <p className="mt-5 text-sm text-muted">
            Privater Bereich für unseren Jahrgang. Beiträge und Bilder sind nur für berechtigte Personen zugänglich.
          </p>
          <LegalLinks className="mt-4" />
        </div>
      </section>
    </main>
  );
}

// ---------- layout + floating controls ----------
const floatBottom = 'bottom-[max(1rem,env(safe-area-inset-bottom))]';

function Layout() {
  const { user } = useSession();
  // History entry key → the view it was shown in, so back/forward also restores the mode on shared pages.
  // ponytail: in memory only; after a reload, older entries fall back to the stored preference.
  const [viewByEntry] = useState(() => new Map<string, View>());
  const [preferredView, setView] = useView();
  const location = useLocation();
  const editorialRoute =
    (editorial(user) && ['/redaktion', '/tickets', '/dokumente'].some((p) => location.pathname.startsWith(p))) ||
    (user.role === 'admin' && location.pathname.startsWith('/verwaltung/'));
  // Each home owns its view; other pages keep the view of the history entry, else the preference.
  // Read during render: child redirects (e.g. Sammlungen for students) run their effects before ours.
  const view: View =
    location.pathname === '/'
      ? 'schueler'
      : editorialRoute
        ? 'redaktion'
        : (viewByEntry.get(location.key) ?? preferredView);
  // Editors opening the site fresh land in Redaktion: decided once at mount and only for the initial entry,
  // so back never bounces and switching to Schüler on / does not redirect.
  const [freshEditor] = useState(() => editorial(user) && preferredView === 'redaktion');
  const landing = freshEditor && location.key === 'default' && location.pathname === '/';
  useEffect(() => {
    if (landing) return;
    if (!viewByEntry.has(location.key)) viewByEntry.set(location.key, view);
    // Only editors have a view to remember; a student must not reset it for an editor on the same browser.
    if (editorial(user)) setView(view);
  }, [landing, location.key, view, setView, viewByEntry, user]);
  const [root, setRoot] = useState<HTMLElement | null>(null); // portal target keeps the workspace theme variables
  if (landing) return <Navigate to="/redaktion" replace />;
  return (
    <WorkspaceView.Provider value={[view, setView]}>
      <div data-workspace={view} ref={setRoot}>
        <a
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-full focus:bg-white focus:px-3 focus:py-2 focus:text-sm"
          href="#inhalt"
        >
          Zum Inhalt
        </a>
        {/* Phones: account left, menu right. From 651px the menu button sits above the account card's left edge. */}
        <div
          className={`pointer-events-none fixed ${floatBottom} inset-x-4 z-40 flex items-end justify-between gap-1.5 *:pointer-events-auto min-[651px]:bottom-6 min-[651px]:left-6 min-[651px]:right-auto min-[651px]:w-[320px] min-[651px]:flex-col-reverse min-[651px]:items-start min-[651px]:gap-3`}
        >
          <Dock />
          {editorial(user) && (
            <div className="relative">
              <BentoMenu container={root} />
              {view === 'redaktion' && <RedaktionHint />}
            </div>
          )}
        </div>
        <div className="flex min-h-screen flex-col bg-paper pb-24 min-[651px]:pb-36">
          <main
            id="inhalt"
            className={`mx-auto w-full flex-1 px-4 py-6 sm:px-8 sm:py-8 ${location.pathname === '/tickets' ? 'max-w-[96rem]' : 'max-w-5xl'}`}
          >
            {/* iOS-style back button: top left of the page column, stays while scrolling; the brand moves over. */}
            {view === 'redaktion' && (
              <div className="sticky top-[calc(env(safe-area-inset-top,0px)+0.75rem)] z-30 h-0">
                <Link
                  to="/"
                  aria-label="Zurück zur Schüleransicht"
                  className="block w-fit rounded-[30px] bg-white p-1.5 text-ink shadow-lg ring-1 ring-black/5"
                >
                  <span
                    className={`${roundButton} bg-[#e4e6e9] hover:border-ink hover:bg-gray-600 hover:text-white hover:shadow-[0_4px_0_var(--color-ink)]`}
                  >
                    <ChevronLeft aria-hidden="true" className="size-6" />
                  </span>
                </Link>
              </div>
            )}
            <Link
              to={view === 'redaktion' ? '/redaktion' : '/'}
              aria-label="AbiZeitBetrug Startseite"
              className={`mb-8 inline-flex rounded-full ${view === 'redaktion' ? 'ml-[72px] h-[60px] items-center' : ''}`}
            >
              <Brand />
            </Link>
            {localStorage.getItem(offerKey) && <PasskeyOffer />}
            <Outlet />
            {import.meta.env.DEV && (
              <div className="mt-8">
                <DevDebug
                  label="Sitzung"
                  data={{
                    role: user.role,
                    view,
                    admitted: user.admitted,
                    cohort: user.cohort_member,
                    grants: user.category_ids.length,
                    route: location.pathname,
                  }}
                />
              </div>
            )}
          </main>
          <footer className="px-4 pb-6 text-[13px] text-muted sm:px-8">
            AbiZeitBetrug. Privater Jahrgangsbereich LMGU 2027
            <LegalLinks className="mt-2 text-xs" />
          </footer>
        </div>
      </div>
    </WorkspaceView.Provider>
  );
}

const hintKey = 'redaktion-hint-seen';

// Points editors in the Redaktion at the menu button, until dismissed once per browser.
function RedaktionHint() {
  const [open, setOpen] = useState(() => {
    // ponytail: previews show it on every visit for now; drop this line once the hint is approved.
    if (document.documentElement.dataset.env === 'preview') return true;
    try {
      return !localStorage.getItem(hintKey);
    } catch {
      return true;
    }
  });
  if (!open) return null;
  return (
    // Click-through except for its button, so it never blocks the page under it.
    <div
      role="note"
      className="pointer-events-none absolute bottom-full right-0 mb-3 w-60 rounded-[20px] bg-ink px-4 py-3 text-sm text-white shadow-lg min-[651px]:bottom-0 min-[651px]:left-full min-[651px]:right-auto min-[651px]:mb-0 min-[651px]:ml-3"
    >
      <span
        aria-hidden="true"
        className="absolute -bottom-1 right-6 size-3 rotate-45 bg-ink min-[651px]:-left-1 min-[651px]:bottom-6 min-[651px]:right-auto"
      />
      <p>
        <strong className="block">Du bist in der Redaktion.</strong>
        Über diesen Menüknopf erreichst du alle Redaktionswerkzeuge.
      </p>
      <button
        type="button"
        className="pointer-events-auto mt-2 rounded-full bg-white px-4 py-1.5 font-bold text-ink"
        onClick={() => {
          setOpen(false);
          try {
            localStorage.setItem(hintKey, '1');
          } catch {
            /* private mode */
          }
        }}
      >
        Verstanden
      </button>
    </div>
  );
}

// Account controls: avatar, name (wider screens), settings and logout in one pill; a 320px card from 651px.
function Dock() {
  const { user } = useSession();
  const location = useLocation();
  return (
    // Pinned to the neutral Redaktion grey, so the olive Schüler pill never tints the floating controls.
    <section
      aria-label="Konto"
      className="flex items-center gap-1.5 rounded-[30px] bg-white p-1.5 shadow-lg ring-1 ring-black/5 [--color-pill:#e4e6e9] min-[651px]:w-[320px]"
    >
      {/* Decorative */}
      <Avatar user={user} className="size-12 border-[3px] border-white text-lg ring-1 ring-black/10" />
      <strong className="line-clamp-2 min-w-0 break-words px-1 text-[15px] font-semibold leading-tight max-[651px]:sr-only min-[651px]:flex-1">
        {user.name}
      </strong>
      <Link
        to="/einstellungen"
        aria-label="Einstellungen"
        aria-current={location.pathname === '/einstellungen' ? 'page' : undefined}
        className={`${roundButton} bg-pill hover:border-ink hover:bg-gray-600 hover:text-white hover:shadow-[0_4px_0_var(--color-ink)]`}
      >
        <Settings aria-hidden="true" className="size-6" />
      </Link>
      <Logout compact />
    </section>
  );
}

const hasVoted = (c: Category) => Boolean(c.my_words?.length || c.my_option_ids?.length || c.my_option_id);

// projects: the route belongs to the PROJECT_MANAGEMENT tools and disappears with the flag.
function RoleGuard({
  children,
  admin = false,
  projects = false,
}: {
  children: ReactNode;
  admin?: boolean;
  projects?: boolean;
}) {
  const session = useSession();
  const { user } = session;
  const allowed = (admin ? user.role === 'admin' : editorial(user)) && (!projects || projectsEnabled(session));
  return allowed ? children : <Navigate to={editorial(user) ? '/redaktion' : '/'} replace />;
}

// ---------- home ----------

function StudentHome() {
  const { user } = useSession();
  const [, setView] = useWorkspaceView();
  const navigate = useNavigate();
  // /sammlungen redirects students home, so switch the view first.
  const toRedaktion = (to: string) => {
    setView('redaktion');
    navigate(to);
  };
  const categories = useData<Category[]>('/categories');
  const submissions = useData<Submission[]>('/submissions');
  const myBallots = useData<MyBallot[]>('/me/ballots');
  const first = user.name.split(' ')[0];
  const ballots = (categories.data ?? []).filter((c) => isBallot(c.kind));
  const todoBallots = ballots.filter((c) => c.status === 'open' && (!hasVoted(c) || c.repeatable)).sort(newestOpened);
  const own = (submissions.data ?? []).filter((s) => s.author_id === user.id);
  const ownBallots = myBallots.data ?? [];
  const availableContributions = (categories.data ?? []).filter(
    (c) => c.status === 'open' && isSubmissionCollection(c.kind),
  );
  const repeatableContributions = availableContributions.filter((c) => c.repeatable);
  const oneOffContributions = (submissions.data && !submissions.error ? availableContributions : [])
    .filter((c) => !c.repeatable && !own.some((s) => s.category_id === c.id))
    .sort(newestOpened);
  const todo = [...todoBallots, ...oneOffContributions];
  const waiting = [...todo, ...repeatableContributions];
  const title =
    categories.data && submissions.data
      ? waiting.length === 0
        ? `Hey ${first}. Gerade ist alles erledigt.`
        : `Hey ${first}. ${waiting.length === 1 ? '1 Abstimmung wartet' : `${waiting.length} Abstimmungen warten`}.`
      : `Hey ${first}.`;
  return (
    <>
      <PageHead title={title}>
        {waiting.length > 0
          ? 'Deine Stimme und deine Geschichten machen unsere Abizeitung.'
          : 'Vielleicht fällt dir noch eine Geschichte ein, die in die Abizeitung gehört.'}
      </PageHead>

      <section aria-labelledby="home-dran">
        <h2 id="home-dran" className={heading}>
          Jetzt dran
        </h2>
        <div className="mt-4">
          {categories.isPending ? (
            <Loading />
          ) : categories.error ? (
            <Failure error={categories.error} retry={() => categories.refetch()} />
          ) : todo.length === 0 ? (
            <Empty>Gerade gibt es keine neuen Aufgaben. Gespeicherte Stimmen änderst du unter „Meine Beiträge“.</Empty>
          ) : (
            <PollStack items={todo} />
          )}
        </div>
      </section>

      <section aria-labelledby="home-wiederholbar" className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="home-wiederholbar" className={heading}>
            Wiederholbar
          </h2>
          {editorial(user) && (
            <button type="button" className={`${btn.redaktion} ml-auto`} onClick={() => toRedaktion('/sammlungen?neu')}>
              <Plus aria-hidden="true" className="size-4 shrink-0" /> Neue Abstimmung
            </button>
          )}
        </div>
        <div className="mt-4">
          {categories.isPending ? (
            <Loading />
          ) : categories.error ? (
            <Failure error={categories.error} retry={() => categories.refetch()} />
          ) : repeatableContributions.length === 0 ? (
            <Empty>Gerade gibt es keine offenen wiederholbaren Abstimmungen.</Empty>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {repeatableContributions.map((collection) => {
                const ownCount = own.filter((submission) => submission.category_id === collection.id).length;
                return (
                  <li key={collection.id} className="min-w-0">
                    <Link
                      to={`/sammlungen/${collection.id}`}
                      className="flex h-full flex-col gap-3 rounded-ui bg-white p-5 transition-colors hover:bg-soft"
                    >
                      <span className="flex items-center gap-2 text-sm text-muted">
                        <KindIcon icon={kindIcon[collection.kind]} />
                        {kindLabel[collection.kind]}
                      </span>
                      <h3 className={`${heading} line-clamp-2 break-words`}>{collection.name}</h3>
                      {collection.description && (
                        <p className="line-clamp-3 break-words text-[15px] text-muted">{collection.description}</p>
                      )}
                      {collection.closes_at && (
                        <span className="text-sm text-muted">Bis {day(collection.closes_at)}</span>
                      )}
                      <span className="mt-auto flex items-center justify-between gap-3 pt-2 text-sm">
                        <span className="text-muted">
                          {submissions.isPending || submissions.error
                            ? 'Beiträge ansehen'
                            : ownCount === 0
                              ? 'Noch nichts eingereicht'
                              : `${ownCount} eigene ${ownCount === 1 ? 'Einreichung' : 'Einreichungen'}`}
                        </span>
                        <span className="inline-flex items-center gap-1 font-bold">
                          Abstimmung öffnen <Arrow />
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="home-beitraege" className="mt-10">
        <h2 id="home-beitraege" className={heading}>
          Deine Beiträge
        </h2>
        <div className="mt-4">
          {submissions.isPending || categories.isPending || myBallots.isPending ? (
            <Loading />
          ) : submissions.error || categories.error || myBallots.error ? (
            <Failure
              error={(submissions.error ?? categories.error ?? myBallots.error)!}
              retry={() => {
                submissions.refetch();
                categories.refetch();
                myBallots.refetch();
              }}
            />
          ) : own.length || ownBallots.length ? (
            <>
              <SubmissionList items={own} categories={categories.data ?? []} ballots={ownBallots} limit={3} />
              <Link to="/beitraege" className={`${btn.text} mt-4 min-h-11`}>
                Meine Beiträge <Arrow />
              </Link>
            </>
          ) : (
            <Empty>Die erste Geschichte wartet auf dich. Such dir oben eine Abstimmung aus.</Empty>
          )}
        </div>
      </section>

      <p className={`${notice} mt-10 text-muted`}>
        <strong className="font-semibold text-ink">Unsere Erinnerungen bleiben im Jahrgang.</strong> Nur du und
        berechtigte Mitglieder der Redaktion können deine Beiträge sehen.
      </p>
    </>
  );
}
