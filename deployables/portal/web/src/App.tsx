import { ArrowRight, FileText, Hourglass, LogOut, Plus, Settings, UserCheck, Users, Vote } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  api,
  ApiError,
  canEdit,
  date,
  editorial,
  json,
  setCsrf,
  type Category,
  type Me,
  type MyBallot,
  type Submission,
  type User,
  day,
} from './api';
import {
  Arrow,
  Badge,
  Empty,
  Failure,
  KindIcon,
  Loading,
  PageHead,
  Session,
  SubmissionList,
  card,
  btn,
  allKinds,
  Avatar,
  isBallot,
  isSubmissionCollection,
  heading,
  kindIcon,
  kindLabel,
  newestOpened,
  notice,
  projectsEnabled,
  since,
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
import { MyTasks } from './TicketCards';
import { DocumentPage, DocumentsPage, DocumentTiles, NewDocument } from './Documents';
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
              <RoleGuard>
                <EditorialHome />
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
const time = (value: string | null | undefined) => (value ? new Date(value).getTime() : 0);
const statusOrder = { open: 0, draft: 1, closed: 2 } as const;

function Mark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 40" className={`flex-none ${className}`}>
      <g transform="rotate(-7 20 20)">
        <path d="M5 4h30a2 2 0 0 1 2 2v28a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" className="fill-ink" />
        <path d="M37 6v11H26a2 2 0 0 1-2-2V4h11a2 2 0 0 1 2 2z" className="fill-accent" />
        <path d="M24 4v11a2 2 0 0 0 2 2h11" fill="none" strokeWidth="1.5" className="stroke-paper" />
        <text
          x="4.5"
          y="31"
          fontSize="21"
          fontWeight="800"
          letterSpacing="-1.5"
          className="fill-pop"
          style={{ fontFamily: 'inherit' }}
        >
          27
        </text>
        <rect x="6" y="9" width="13" height="2.4" rx="1.2" className="fill-paper" />
      </g>
    </svg>
  );
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
            ? `${roundButton} bg-red-100 text-red-700 [grid-area:logout] hover:border-red-700 hover:bg-red-600 hover:text-white hover:shadow-[0_4px_0_var(--color-red-700)] disabled:opacity-50`
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
// Floating controls share one geometry so the corners stay concentric: 48px items, padding = gap = 6px,
// outer radius = 24px item radius + 6px = 30px.
const roundButton =
  'grid size-12 flex-none place-items-center rounded-full border-2 border-transparent shadow-sm transition-[translate,border-color,box-shadow] duration-100 hover:-translate-y-1 active:translate-y-0.5 active:shadow-none';
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
  if (landing) return <Navigate to="/redaktion" replace />;
  return (
    <WorkspaceView.Provider value={[view, setView]}>
      <div data-workspace={view}>
        <a
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-full focus:bg-white focus:px-3 focus:py-2 focus:text-sm"
          href="#inhalt"
        >
          Zum Inhalt
        </a>
        <Dock />
        {editorial(user) && <ModeFab />}
        <div className="flex min-h-screen flex-col bg-paper pb-24 min-[651px]:pb-36">
          <main
            id="inhalt"
            className={`mx-auto w-full flex-1 px-4 py-6 sm:px-8 sm:py-8 ${location.pathname === '/tickets' ? 'max-w-[96rem]' : 'max-w-5xl'}`}
          >
            <Link
              to={view === 'redaktion' ? '/redaktion' : '/'}
              aria-label="AbiZeitBetrug Startseite"
              className="mb-8 inline-flex rounded-full"
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

// Account controls, rendered once and restyled by breakpoint: a bottom-left pill on phones
// (avatar, settings, logout), a floating card on wider screens (mode switch and logout above, avatar, name, settings below).
function Dock() {
  const { user } = useSession();
  const location = useLocation();
  const editor = editorial(user);
  return (
    <section
      aria-label="Konto"
      className={`fixed ${floatBottom} left-4 z-40 flex items-center gap-1.5 rounded-[30px] bg-white p-1.5 shadow-lg min-[651px]:bottom-6 min-[651px]:left-6 min-[651px]:grid min-[651px]:w-[320px] ${
        editor
          ? "min-[651px]:grid-cols-[auto_minmax(0,1fr)_auto] min-[651px]:[grid-template-areas:'switch_switch_logout'_'avatar_name_settings']"
          : "min-[651px]:grid-cols-[auto_minmax(0,1fr)_auto_auto] min-[651px]:[grid-template-areas:'avatar_name_settings_logout']"
      }`}
    >
      {editor && (
        <div className="[grid-area:switch] max-[651px]:hidden">
          <ViewSwitch />
        </div>
      )}
      {/* Decorative; dropped below 360px so the account and mode pills fit side by side on 320px phones. */}
      <Avatar user={user} className="size-12 text-sm [grid-area:avatar] max-[360px]:hidden" />
      <strong className="line-clamp-2 min-w-0 break-words px-1 text-[15px] font-semibold leading-tight [grid-area:name] max-[651px]:sr-only">
        {user.name}
      </strong>
      <Link
        to="/einstellungen"
        aria-label="Einstellungen"
        aria-current={location.pathname === '/einstellungen' ? 'page' : undefined}
        className={`${roundButton} bg-pill [grid-area:settings] hover:border-ink hover:bg-gray-600 hover:text-white hover:shadow-[0_4px_0_var(--color-ink)]`}
      >
        <Settings aria-hidden="true" className="size-6" />
      </Link>
      <Logout compact />
    </section>
  );
}

function useSwitchView() {
  const [, setView] = useWorkspaceView();
  const navigate = useNavigate();
  return (next: View) => {
    setView(next);
    navigate(next === 'redaktion' ? '/redaktion' : '/');
  };
}

// Fixed colors per mode, so the selected pill previews the workspace it stands for.
const modes = {
  schueler: { label: 'Schüler', active: 'bg-[#15181f] text-[#c8f23c]' },
  redaktion: { label: 'Redaktion', active: 'bg-[#1d5fbf] text-white' },
};
const motion = 'duration-200 ease-out motion-reduce:transition-none';
// Text pill, 48px tall and as wide as the longer label, so the whole pill is the tap target.
const modePill = 'flex h-12 w-full items-center justify-center rounded-full px-5 text-lg font-bold active:scale-95';

// Phone mode switch: a pill naming the current mode that grows upward to offer the other one.
function ModeFab() {
  const [view] = useWorkspaceView();
  const switchView = useSwitchView();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const other: View = view === 'redaktion' ? 'schueler' : 'redaktion';
  // Document listeners, because iOS Safari does not focus tapped buttons, so blur alone would never close it.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!trigger.current?.parentElement?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div
      className={`fixed ${floatBottom} right-4 z-40 grid rounded-[30px] bg-white p-1.5 text-[#15181f] shadow-lg min-[651px]:hidden`}
      onBlur={(e) => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <div
        inert={!open}
        className={`grid transition-[grid-template-rows,opacity] ${motion} ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr] opacity-0'}`}
      >
        <div className="min-h-0 overflow-hidden">
          <button
            key={other}
            type="button"
            aria-label={`Zu ${modes[other].label} wechseln`}
            className={`${modePill} mb-1.5 transition-[translate,scale] ${motion} hover:bg-[#15181f]/5 focus-visible:-outline-offset-2 ${open ? '' : 'translate-y-3'}`}
            onClick={() => {
              setOpen(false);
              trigger.current?.focus();
              switchView(other);
            }}
          >
            {modes[other].label}
          </button>
        </div>
      </div>
      <button
        ref={trigger}
        type="button"
        aria-label={`Ansicht: ${modes[view].label}`}
        aria-expanded={open}
        className={`${modePill} ${modes[view].active} transition-[scale,background-color,color] ${motion}`}
        onClick={() => setOpen(!open)}
      >
        <span key={view} className={`transition-opacity ${motion} starting:opacity-0`}>
          {modes[view].label}
        </span>
      </button>
    </div>
  );
}

// Wider-screen mode switch; 48px track with 4px padding, so the 40px segments stay concentric.
function ViewSwitch() {
  const [view] = useWorkspaceView();
  const switchView = useSwitchView();
  const seg = (mode: View) =>
    `min-h-10 flex-1 rounded-full px-3 text-[17px] font-bold transition-[scale,background-color,color] ${motion} active:scale-95 ${view === mode ? modes[mode].active : 'text-ink hover:bg-white/60'}`;
  return (
    <div className="flex gap-0.5 rounded-full bg-pill p-1">
      {(['schueler', 'redaktion'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          className={seg(mode)}
          aria-pressed={view === mode}
          onClick={() => switchView(mode)}
        >
          {modes[mode].label}
        </button>
      ))}
    </div>
  );
}

const hasVoted = (c: Category) => Boolean(c.my_words?.length || c.my_option_ids?.length || c.my_option_id);
const participationColor = (percent: number) => {
  const from = [209, 213, 219];
  const to = [22, 101, 52];
  return `rgb(${from.map((value, index) => Math.round(value + ((to[index] - value) * percent) / 100)).join(', ')})`;
};

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
      <PageHead
        title={title}
        action={
          editorial(user) && (
            <button type="button" className={btn.redaktion} onClick={() => toRedaktion('/redaktion')}>
              Zum Redaktionsbereich <Arrow />
            </button>
          )
        }
      >
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

function EditorialHome() {
  const session = useSession();
  const { user } = session;
  const isAdmin = user.role === 'admin';
  const projects = projectsEnabled(session);
  const users = useData<User[]>('/admin/users', isAdmin);
  const categories = useData<Category[]>('/categories');
  const submissions = useData<Submission[]>('/submissions');
  const waiting = (users.data ?? []).filter((u) => !u.admitted).sort((a, b) => time(b.created_at) - time(a.created_at));
  const latest = isAdmin
    ? (categories.data ?? []).toSorted(newestOpened).slice(0, 4)
    : (categories.data ?? [])
        .filter((c) => isBallot(c.kind) && canEdit(user, c.id))
        .sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || newestOpened(a, b));
  const writableCategoryIds = new Set((categories.data ?? []).filter((c) => canEdit(user, c.id)).map((c) => c.id));
  const writableSubmissions = (submissions.data ?? []).filter((s) => writableCategoryIds.has(s.category_id));
  const recentSubmissions = writableSubmissions.toSorted((a, b) => time(b.created_at) - time(a.created_at)).slice(0, 3);
  const figure = 'block text-4xl font-extrabold tabular-nums leading-none tracking-tight';
  const state = (q: { isPending: boolean; error: Error | null; refetch: () => unknown }) =>
    q.isPending ? (
      <div className="mt-4">
        <Loading />
      </div>
    ) : q.error ? (
      <div className="mt-4">
        <Failure error={q.error} retry={() => q.refetch()} />
      </div>
    ) : null;
  const managerCategoriesState =
    categories.isPending || submissions.isPending ? (
      <div className="mt-4">
        <Loading />
      </div>
    ) : categories.error || submissions.error ? (
      <div className="mt-4">
        <Failure
          error={(categories.error ?? submissions.error)!}
          retry={() => {
            categories.refetch();
            submissions.refetch();
          }}
        />
      </div>
    ) : null;
  const initials = (name: string) =>
    name
      .replace(/\(.*?\)/g, '')
      .split(/\s+/)
      .filter((w) => /^\p{L}/u.test(w))
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  const collections = (
    <section aria-labelledby="home-neueste" className={card}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="home-neueste" className={`${heading} flex items-center gap-2`}>
          <Vote aria-hidden="true" className="size-[18px] shrink-0" />
          {isAdmin ? 'Neueste Abstimmungen' : 'Meine Abstimmungen'}
        </h2>
        <Link to="/sammlungen" className={btn.text}>
          Alle <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
        </Link>
      </div>
      {state(categories) ??
        (latest.length === 0 ? (
          <div className="mt-4">
            {isAdmin ? (
              <Empty>Noch keine Abstimmung.</Empty>
            ) : (
              <Empty>Dir sind noch keine Abstimmungen zugewiesen.</Empty>
            )}
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {latest.map((c) => {
              const participation = isBallot(c.kind) ? c.participation : null;
              const showParticipation = Boolean(participation);
              const voted = participation?.voted ?? 0;
              const eligible = participation?.eligible ?? 0;
              const percent = eligible === 0 ? 0 : Math.max(0, Math.min(100, (voted / eligible) * 100));
              return (
                <li key={c.id} className="min-w-0">
                  <Link
                    to={`/sammlungen/${c.id}`}
                    className={`-mx-2 flex gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-pop/30 ${showParticipation ? 'items-start' : 'items-center'}`}
                  >
                    <KindIcon
                      icon={kindIcon[c.kind]}
                      className={`size-4 shrink-0 text-muted ${showParticipation ? 'mt-1' : ''}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <strong className="line-clamp-2 min-w-0 flex-1 break-words text-[15px] font-semibold leading-snug">
                          {c.name}
                        </strong>
                        {isBallot(c.kind) && <Badge status={c.status} />}
                      </span>
                      <span className="block text-[13px] text-muted">
                        {[kindLabel[c.kind], c.status === 'open' && isBallot(c.kind) ? since(c.opened_at) : '']
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                      {showParticipation && (
                        <span className="mt-2 block">
                          <span className="flex items-center gap-1 text-[12px] leading-4 text-muted">
                            <span className="tabular-nums">
                              {voted} von {eligible}
                            </span>{' '}
                            abgestimmt
                          </span>
                          <span
                            role="progressbar"
                            aria-label={`Wahlbeteiligung: ${c.name}`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={percent}
                            aria-valuetext={`${voted} von ${eligible} Personen abgestimmt (${Math.round(percent)} %)`}
                            className="mt-1 block h-1.5 overflow-hidden rounded-full"
                            style={{ backgroundColor: '#e5e7eb' }}
                          >
                            <span
                              aria-hidden="true"
                              className="block h-full rounded-full"
                              style={{ width: `${percent}%`, backgroundColor: participationColor(percent) }}
                            />
                          </span>
                        </span>
                      )}
                    </span>
                    {showParticipation && (
                      <span className="w-24 flex-none whitespace-nowrap pt-0.5 text-right">
                        <strong className="block text-3xl font-extrabold tabular-nums leading-none tracking-tight">
                          {Math.round(percent)}%
                        </strong>
                        <span className="mt-1 block text-[12px] font-normal leading-4 text-muted">Teilgenommen</span>
                      </span>
                    )}
                  </Link>
                  <DevDebug
                    label="Abstimmung"
                    data={{
                      id: c.id,
                      status: c.status,
                      kind: c.kind,
                      version: c.version,
                      options: c.options.length,
                    }}
                  />
                </li>
              );
            })}
          </ul>
        ))}
      {!isAdmin && (
        <Link to="/sammlungen?neu" className={`${btn.redaktion} mt-5`}>
          <Plus aria-hidden="true" className="size-4 shrink-0" /> Neue Abstimmung
        </Link>
      )}
    </section>
  );
  return (
    <>
      <PageHead
        title="Redaktion"
        action={
          <Link to="/redaktion/beitraege" className={btn.text}>
            Alle Beiträge <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
          </Link>
        }
      >
        {isAdmin
          ? 'Zugänge und Abstimmungen im Überblick.'
          : projects
            ? undefined
            : 'Überblick über Rubriken und Beiträge aus den Abstimmungen, die dir zugewiesen sind.'}
      </PageHead>
      {/* DOM order puts the tasks first on phones. */}
      <div className={`mb-10 grid items-start gap-4 ${projects ? 'lg:grid-cols-2' : ''}`}>
        {projects && <MyTasks user={session} />}
        {collections}
      </div>
      {projects && (
        <div className="mb-10">
          <DocumentTiles limit={6} />
        </div>
      )}
      {(isAdmin || !projects) && (
        <section aria-labelledby="home-sammlungen" className="mb-10">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2 id="home-sammlungen" className={heading}>
              Abstimmungen
            </h2>
            <Link to="/sammlungen?neu" className={btn.redaktion}>
              <Plus aria-hidden="true" className="size-4 shrink-0" /> Neue Abstimmung
            </Link>
          </div>
          {(isAdmin ? state(categories) : managerCategoriesState) ?? (
            <ul className="mt-4 grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-3">
              {allKinds.map((kind) => {
                const mine = (categories.data ?? []).filter((c) => c.kind === kind && canEdit(user, c.id));
                const ids = new Set(mine.map((c) => c.id));
                const n = writableSubmissions.filter((s) => ids.has(s.category_id)).length;
                const submissionsKind = isSubmissionCollection(kind);
                return (
                  <li key={kind} className="min-w-0">
                    <Link
                      to={`/sammlungen?klasse=${kind}`}
                      className="flex h-full flex-col rounded-ui bg-white p-4 transition-transform hover:-translate-y-0.5 hover:bg-pop/40 active:scale-[.99] sm:p-5"
                    >
                      <span className="flex items-center gap-2">
                        <KindIcon icon={kindIcon[kind]} className="size-4 text-muted" />
                        <strong className="min-w-0 truncate text-[15px] font-bold">{kindLabel[kind]}</strong>
                      </span>
                      <span className="mt-5 flex items-baseline gap-2">
                        <strong className={figure}>{categories.isPending ? '–' : mine.length}</strong>{' '}
                        <span className="text-[13px] text-muted">
                          {mine.length === 1 ? 'Abstimmung' : 'Abstimmungen'}
                        </span>
                      </span>
                      {submissionsKind ? (
                        <span className="mt-4 text-[13px] text-muted">
                          <strong className="text-lg font-extrabold tabular-nums leading-tight text-ink">
                            {submissions.isPending ? '–' : n}
                          </strong>{' '}
                          {n === 1 ? 'Beitrag' : 'Beiträge'}
                        </span>
                      ) : (
                        <span className="mt-4 grid grid-cols-2 gap-2 text-[13px] text-muted">
                          <span>
                            <strong className="block text-lg font-extrabold tabular-nums leading-tight text-ink">
                              {mine.filter((c) => c.status === 'open').length}
                            </strong>{' '}
                            offen
                          </span>{' '}
                          <span>
                            <strong className="block text-lg font-extrabold tabular-nums leading-tight text-ink">
                              {mine.filter((c) => c.status === 'closed').length}
                            </strong>{' '}
                            beendet
                          </span>
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      {isAdmin ? (
        <section aria-labelledby="home-personen" className={card}>
          <h2 id="home-personen" className={`${heading} flex items-center gap-2`}>
            <Users aria-hidden="true" className="size-[18px] shrink-0" />
            Personen
          </h2>
          {state(users) ?? (
            <>
              <div className="mt-5 flex flex-wrap gap-x-10 gap-y-3">
                <p>
                  <strong className={figure}>{users.data?.length}</strong>
                  <span className="mt-1.5 block text-[13px] text-muted">Angemeldet</span>
                </p>
                <p>
                  <strong className={`${figure} ${waiting.length ? 'text-wait' : ''}`}>{waiting.length}</strong>
                  <span className="mt-1.5 block text-[13px] text-muted">
                    {waiting.length === 1 ? 'wartet' : 'warten'} auf Freigabe
                  </span>
                </p>
              </div>
              <h3 className="mt-7 flex items-center gap-2 text-sm font-bold">
                <Hourglass aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 text-muted" />
                Zuletzt angemeldet, noch nicht freigegeben
              </h3>
              {waiting.length === 0 ? (
                <p className="mt-2 flex items-center gap-2 text-[15px] text-muted">
                  <UserCheck aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0" />
                  Alle sind freigegeben.
                </p>
              ) : (
                <ul aria-label="Warten auf Freigabe" className="mt-2 divide-y divide-line">
                  {waiting.slice(0, 3).map((u) => (
                    <li key={u.id}>
                      <Link
                        to="/verwaltung/personen"
                        className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-pop/30"
                      >
                        <span
                          aria-hidden="true"
                          className="grid size-8 flex-none place-items-center rounded-full bg-soft text-xs font-bold text-ink"
                        >
                          {initials(u.name) || '?'}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{u.name}</span>
                        <span className="flex-none text-[13px] text-muted">{since(u.created_at)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {waiting.length > 3 && <p className="mt-1 text-[13px] text-muted">und {waiting.length - 3} weitere</p>}
              <Link to="/verwaltung/personen" className={`${btn.text} mt-5 self-start`}>
                Zugänge verwalten <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
              </Link>
              <Link to="/verwaltung/email" className={`${btn.text} mt-3 self-start`}>
                E-Mail-Versand verwalten <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
              </Link>
              <Link to="/verwaltung/protokoll" className={`${btn.text} mt-3 self-start`}>
                Aktivitätsprotokoll <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
              </Link>
              {projects && (
                <Link to="/verwaltung/bereiche" className={`${btn.text} mt-3 self-start`}>
                  Bereiche verwalten <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
                </Link>
              )}
              <DevDebug
                label="Personen"
                data={{
                  total: users.data?.length ?? 0,
                  waiting: waiting.length,
                  admins: (users.data ?? []).filter((u) => u.role === 'admin').length,
                }}
              />
            </>
          )}
        </section>
      ) : (
        <section aria-labelledby="home-beitraege" className={card}>
          <h2 id="home-beitraege" className={`${heading} flex items-center gap-2`}>
            <FileText aria-hidden="true" className="size-[18px] shrink-0" />
            Gesammelte Beiträge
          </h2>
          <p className="mt-5">
            <strong className={figure}>
              {categories.isPending || submissions.isPending || categories.error || submissions.error
                ? '–'
                : writableSubmissions.length}
            </strong>
            <span className="mt-1.5 block text-[13px] text-muted">In deinen zugewiesenen Abstimmungen</span>
          </p>
          {categories.isPending || submissions.isPending ? (
            <div className="mt-4">
              <Loading />
            </div>
          ) : categories.error || submissions.error ? (
            <div className="mt-4">
              <Failure
                error={(categories.error ?? submissions.error)!}
                retry={() => {
                  categories.refetch();
                  submissions.refetch();
                }}
              />
            </div>
          ) : recentSubmissions.length === 0 ? (
            <div className="mt-4">
              <Empty>In deinen zugewiesenen Abstimmungen gibt es noch keine Beiträge.</Empty>
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {recentSubmissions.map((submission) => (
                <li key={submission.id}>
                  <Link
                    to={`/redaktion/beitraege/${submission.id}`}
                    className="-mx-2 flex min-w-0 items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-pop/30"
                  >
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-[15px] font-semibold">{submission.title}</strong>
                      <small className="mt-0.5 block text-[13px] text-muted">
                        {categories.data?.find((c) => c.id === submission.category_id)?.name ?? 'Beitrag'} ·{' '}
                        {date(submission.created_at)}
                      </small>
                    </span>
                    <Badge status={submission.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
