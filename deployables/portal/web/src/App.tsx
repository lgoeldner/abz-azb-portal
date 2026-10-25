import {
  ArrowRight,
  ChevronDown,
  ClipboardList,
  FileText,
  Hourglass,
  House,
  Library,
  Menu,
  Plus,
  ScrollText,
  Settings,
  Tags,
  UserCheck,
  Users,
  Vote,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, editorial, json, setCsrf, type Category, type Me, type Submission, type User } from './api';
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
  btn,
  allKinds,
  heading,
  kindIcon,
  kindLabel,
  newestOpened,
  notice,
  plural,
  repeatableKinds,
  roleName,
  since,
  useAction,
  useData,
  useSession,
  useView,
  WorkspaceView,
  useWorkspaceView,
  type View,
} from './ui';
import { ActivityLog, Categories, People } from './admin';
import { ContributionDetail, Contributions, Editorial, NewContribution, NotFound } from './pages';
import { SammlungDetail, Sammlungen } from './sammlungen';
import { DevDebug } from './DevDebug';

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
  return (
    <Session.Provider value={me.data}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
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
                <Categories />
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

// The sidebar switch and the home page must agree on the view, so Layout owns the single hook instance.

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
function Logout() {
  const action = useAction();
  return (
    <>
      {action.feedback}
      <button
        type="button"
        className={btn.text}
        disabled={action.busy}
        onClick={() =>
          action.run(async () => {
            await api('/auth/logout', json('POST'));
            window.location.assign('/');
          })
        }
      >
        Abmelden <Arrow />
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
            Melde dich an, um Erinnerungen einzureichen und bei unseren Sammlungen mitzumachen.
          </p>
          <a className={`${btn.primary} mt-6 w-full`} href="/auth/login">
            Mit Schulkonto anmelden <Arrow />
          </a>
          <p className="mt-5 text-sm text-muted">
            Privater Bereich für unseren Jahrgang. Beiträge und Bilder sind nur für berechtigte Personen zugänglich.
          </p>
        </div>
      </section>
    </main>
  );
}

// ---------- layout + sidebar ----------
const navItem =
  'flex min-h-10 items-center justify-between gap-3 rounded-full px-3.5 py-1.5 text-[15px] transition-transform active:scale-[.98] max-[651px]:min-h-11';
const groupLabel = 'px-3.5 text-sm font-bold text-ink';

function Layout() {
  const { user } = useSession();
  const preference = useView();
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  const [preferredView, setView] = preference;
  const editorialRoute = editorial(user) && location.pathname.startsWith('/redaktion');
  useEffect(() => {
    if (editorialRoute && preferredView !== 'redaktion') setView('redaktion');
  }, [editorialRoute, preferredView, setView]);
  const view: [View, (view: View) => void] = [editorialRoute ? 'redaktion' : preferredView, setView];
  return (
    <WorkspaceView.Provider value={view}>
      <div data-workspace={view[0]}>
        <a
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-full focus:bg-white focus:px-3 focus:py-2 focus:text-sm"
          href="#inhalt"
        >
          Zum Inhalt
        </a>
        <header className="fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-3 bg-chrome px-2 min-[651px]:hidden">
          <button
            type="button"
            className="grid size-10 place-items-center rounded-full text-xl hover:bg-pill"
            aria-label={menu ? 'Menü schließen' : 'Menü öffnen'}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <Menu aria-hidden="true" className="size-5" />
          </button>
          <Brand />
        </header>
        {menu && (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="fixed inset-0 z-30 bg-ink/30 min-[651px]:hidden"
            onClick={() => setMenu(false)}
          />
        )}
        <aside
          aria-label="Seitenleiste"
          className={`fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col overflow-y-auto bg-chrome max-[651px]:top-12 max-[651px]:w-[min(86vw,320px)] max-[651px]:transition-transform ${menu ? '' : 'max-[651px]:invisible max-[651px]:-translate-x-full'}`}
        >
          <Link
            to="/"
            className="flex-none rounded-full px-5 pb-4 pt-5 max-[651px]:hidden"
            aria-label="AbiZeitBetrug Startseite"
            onClick={() => setMenu(false)}
          >
            <Brand />
          </Link>
          <nav
            aria-label="Hauptnavigation"
            className="flex min-h-24 flex-1 flex-col gap-6 overflow-y-auto px-3 py-2 max-[651px]:pt-4"
            onClick={(e) => {
              if ((e.target as Element).closest('a')) setMenu(false);
            }}
          >
            <NavItem to="/" icon={House}>
              Überblick
            </NavItem>
            {view[0] === 'redaktion' && editorial(user) ? <EditorNav /> : <StudentNav />}
          </nav>
          {user.role === 'admin' && <AdminNav onNavigate={() => setMenu(false)} />}
          <div className="flex flex-none flex-col gap-3 bg-pill px-3 py-4">
            {editorial(user) && <ViewSwitch onSwitch={() => setMenu(false)} />}
            <div className="flex items-center gap-3 px-1">
              <span
                className="grid size-9 flex-none place-items-center rounded-full bg-pop text-[13px] font-bold"
                aria-hidden="true"
              >
                {user.name
                  .split(' ')
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join('')}
              </span>
              <div className="min-w-0 leading-tight">
                <strong className="block truncate text-[15px] font-semibold">{user.name}</strong>
                <small className="text-[13px] text-muted">{roleName(user.role)}</small>
              </div>
            </div>
            <div className="px-3.5">
              <Logout />
            </div>
          </div>
        </aside>
        <div className="flex min-h-screen flex-col bg-paper max-[651px]:pt-12 min-[651px]:pl-[260px]">
          <main id="inhalt" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-8 sm:py-10">
            <Outlet />
            {import.meta.env.DEV && (
              <div className="mt-8">
                <DevDebug
                  label="Sitzung"
                  data={{
                    role: user.role,
                    view: view[0],
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
          </footer>
        </div>
      </div>
    </WorkspaceView.Provider>
  );
}

function ViewSwitch({ onSwitch }: { onSwitch: () => void }) {
  const [view, setView] = useWorkspaceView();
  const navigate = useNavigate();
  const choose = (next: View) => {
    setView(next);
    onSwitch();
    navigate('/');
  };
  const seg = (active: boolean) =>
    `min-h-10 flex-1 rounded-full px-3 text-sm transition-transform active:scale-95 ${active ? 'bg-ink font-bold text-pop' : 'font-semibold text-ink hover:bg-white/60'}`;
  return (
    <div className="flex gap-0.5 rounded-full bg-white/70 p-1">
      <button
        type="button"
        className={seg(view === 'schueler')}
        aria-pressed={view === 'schueler'}
        onClick={() => choose('schueler')}
      >
        Schüler
      </button>
      <button
        type="button"
        className={seg(view === 'redaktion')}
        aria-pressed={view === 'redaktion'}
        onClick={() => choose('redaktion')}
      >
        Redaktion
      </button>
    </div>
  );
}

function NavItem({ to, icon: Icon, children }: { to: string; icon?: LucideIcon; children: ReactNode }) {
  const location = useLocation();
  const active = location.pathname + location.search === to;
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`${navItem} ${active ? 'bg-ink font-bold text-pop' : 'hover:bg-pill'}`}
    >
      <span className="flex items-center gap-2.5">
        {Icon && <Icon aria-hidden="true" className="size-[18px] shrink-0" />}
        {children}
      </span>
    </Link>
  );
}
// Pinned between the scrolling nav and the account block; open state is a per-browser preference.
function AdminNav({ onNavigate }: { onNavigate: () => void }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('verwaltung') !== 'zu';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem('verwaltung', open ? 'zu' : 'offen');
    } catch {
      /* private mode */
    }
  };
  return (
    <div
      className="flex flex-none flex-col gap-1 border-t border-line px-3 py-2"
      onClick={(e) => {
        if ((e.target as Element).closest('a')) onNavigate();
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="nav-verwaltung"
        className={`${navItem} w-full font-bold hover:bg-pill`}
        onClick={toggle}
      >
        <span className="flex items-center gap-2.5">
          <Settings aria-hidden="true" className="size-[18px] shrink-0" />
          Verwaltung
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && (
        <div id="nav-verwaltung" className="flex flex-col gap-1">
          <NavItem to="/verwaltung/personen" icon={Users}>
            Personen
          </NavItem>
          <NavItem to="/verwaltung/sammlungen" icon={Tags}>
            Sammlungen
          </NavItem>
          <NavItem to="/verwaltung/protokoll" icon={ScrollText}>
            Aktivitätsprotokoll
          </NavItem>
        </div>
      )}
    </div>
  );
}
function NavRow({
  to,
  icon,
  title,
  sub,
  end,
}: {
  to: string;
  icon?: LucideIcon;
  title: string;
  sub?: string;
  end?: string;
}) {
  const location = useLocation();
  const active = location.pathname + location.search === to;
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`${navItem} ${active ? 'bg-ink text-white' : 'hover:bg-pill'}`}
    >
      <span className="flex min-w-0 items-start gap-2.5">
        {icon && <KindIcon icon={icon} className={`mt-[3px] size-4 ${active ? 'text-pop' : 'text-muted'}`} />}
        <span className="min-w-0">
          <span className={`block truncate ${active ? 'font-bold text-pop' : ''}`}>{title}</span>
          {sub && (
            <small className={`block truncate text-[13px] ${active ? 'text-white/80' : 'text-muted'}`}>{sub}</small>
          )}
        </span>
      </span>
      {end && (
        <span className={`flex-none text-[13px] tabular-nums ${active ? 'text-white/80' : 'text-muted'}`}>{end}</span>
      )}
    </Link>
  );
}
function NavGroup({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-1">
      <p id={id} className={groupLabel}>
        {label}
      </p>
      {children}
    </div>
  );
}
const quiet = 'px-3.5 text-[13px] text-muted';

function StudentNav() {
  const { user } = useSession();
  const categories = useData<Category[]>('/categories');
  const submissions = useData<Submission[]>('/submissions');
  const ballots = (categories.data ?? []).filter((c) => !c.repeatable);
  const todo = ballots.filter((c) => c.status === 'open' && c.my_option_id === null).sort(newestOpened);
  const done = ballots
    .filter((c) => c.status === 'closed' || (c.status === 'open' && c.my_option_id !== null))
    .sort(newestOpened);
  const own = (submissions.data ?? []).filter((s) => s.author_id === user.id);
  return (
    <>
      <NavGroup id="nav-offen" label="Offen">
        {categories.isPending ? (
          <p className={quiet}>Einen Moment …</p>
        ) : categories.error ? (
          <p className={quiet}>Sammlungen nicht erreichbar.</p>
        ) : todo.length === 0 ? (
          <p className={quiet}>Gerade ist nichts offen.</p>
        ) : (
          <ol aria-labelledby="nav-offen" className="ml-3 flex flex-col border-l-2 border-pill">
            {todo.map((c) => (
              <li key={c.id} className="relative pl-3">
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-[17px] size-2 -translate-x-1/2 rounded-full bg-accent"
                />
                <NavRow to={`/sammlungen/${c.id}`} title={c.name} sub={since(c.opened_at)} />
              </li>
            ))}
          </ol>
        )}
      </NavGroup>
      <NavGroup id="nav-fortlaufend" label="Fortlaufend">
        {categories.isPending ? (
          <p className={quiet}>Einen Moment …</p>
        ) : categories.error ? null : (
          categories.data
            ?.filter((c) => c.repeatable)
            .map((c) => {
              const n = own.filter((s) => s.category_id === c.id).length;
              return (
                <NavRow
                  key={c.id}
                  to={`/sammlungen/${c.id}`}
                  icon={kindIcon[c.kind]}
                  title={c.name}
                  sub={n ? `${n} eingereicht` : 'Noch nichts eingereicht'}
                />
              );
            })
        )}
      </NavGroup>
      <div className="flex flex-col gap-1">
        <details className="group">
          <summary
            className={`${navItem} cursor-pointer list-none text-muted hover:bg-pill [&::-webkit-details-marker]:hidden`}
          >
            Erledigt ({done.length})
            <span aria-hidden="true" className="text-xs group-open:rotate-90">
              ›
            </span>
          </summary>
          <div className="mt-1 flex flex-col gap-1">
            {done.length === 0 ? (
              <p className={quiet}>Noch nichts erledigt.</p>
            ) : (
              done.map((c) => (
                <NavRow
                  key={c.id}
                  to={`/sammlungen/${c.id}`}
                  title={c.name}
                  sub={c.my_option_id ? 'abgestimmt' : 'beendet'}
                />
              ))
            )}
          </div>
        </details>
        <NavItem to="/sammlungen" icon={Library}>
          Alle Sammlungen
        </NavItem>
        <NavItem to="/beitraege" icon={FileText}>
          Meine Beiträge
        </NavItem>
      </div>
    </>
  );
}

function EditorNav() {
  const categories = useData<Category[]>('/categories');
  const submissions = useData<Submission[]>('/submissions');
  const groups: [Category['status'], string, string][] = [
    ['open', 'Offen', 'nav-sammlung-offen'],
    ['draft', 'Entwürfe', 'nav-sammlung-entwuerfe'],
    ['closed', 'Beendet', 'nav-sammlung-beendet'],
  ];
  const ballots = (categories.data ?? []).filter((c) => !c.repeatable);
  return (
    <>
      <NavGroup id="nav-sammlungen" label="Sammlungen">
        {categories.isPending ? (
          <p className={quiet}>Einen Moment …</p>
        ) : categories.error ? (
          <p className={quiet}>Sammlungen nicht erreichbar.</p>
        ) : ballots.length === 0 ? (
          <p className={quiet}>Noch keine Wahl angelegt.</p>
        ) : (
          groups.map(([status, label, id]) => {
            const items = ballots.filter((c) => c.status === status).sort(newestOpened);
            return (
              items.length > 0 && (
                <div key={status} role="group" aria-labelledby={id} className="mt-1 flex flex-col gap-1">
                  <p id={id} className={`${quiet} flex items-center gap-1.5`}>
                    {status === 'open' && <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />}
                    {label}
                  </p>
                  {items.map((c) => (
                    <NavRow
                      key={c.id}
                      to={`/sammlungen/${c.id}`}
                      icon={kindIcon[c.kind]}
                      title={c.name}
                      end={plural(c.ballot_count ?? 0, 'Stimme', 'Stimmen')}
                    />
                  ))}
                </div>
              )
            );
          })
        )}
        <NavItem to="/sammlungen?neu" icon={Plus}>
          Neue Sammlung
        </NavItem>
        <NavItem to="/sammlungen" icon={Library}>
          Alle Sammlungen
        </NavItem>
      </NavGroup>
      <NavGroup id="nav-fortlaufend" label="Fortlaufend">
        {categories.isPending ? (
          <p className={quiet}>Einen Moment …</p>
        ) : categories.error ? null : (
          categories.data
            ?.filter((c) => c.repeatable)
            .map((c) => {
              const mine = (submissions.data ?? []).filter((s) => s.category_id === c.id);
              return (
                <NavRow
                  key={c.id}
                  to={`/sammlungen/${c.id}`}
                  icon={kindIcon[c.kind]}
                  title={c.name}
                  sub={plural(mine.length, 'Beitrag', 'Beiträge')}
                />
              );
            })
        )}
        <NavItem to="/redaktion" icon={ClipboardList}>
          Alle Beiträge
        </NavItem>
      </NavGroup>
    </>
  );
}

function RoleGuard({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { user } = useSession();
  return (admin ? user.role === 'admin' : editorial(user)) ? children : <Navigate to="/" replace />;
}

// ---------- home ----------
function Overview() {
  const { user } = useSession();
  const [view] = useWorkspaceView();
  return view === 'redaktion' && editorial(user) ? (
    user.role === 'admin' ? (
      <AdminHome />
    ) : (
      <EditorHome />
    )
  ) : (
    <StudentHome />
  );
}

function StudentHome() {
  const { user } = useSession();
  const categories = useData<Category[]>('/categories');
  const submissions = useData<Submission[]>('/submissions');
  const first = user.name.split(' ')[0];
  const ballots = (categories.data ?? []).filter((c) => !c.repeatable);
  const todo = ballots.filter((c) => c.status === 'open' && c.my_option_id === null).sort(newestOpened);
  const done = ballots
    .filter((c) => c.status === 'closed' || (c.status === 'open' && c.my_option_id !== null))
    .sort(newestOpened);
  const own = (submissions.data ?? []).filter((s) => s.author_id === user.id);
  const title = categories.data
    ? todo.length === 0
      ? `Hey ${first}. Gerade ist alles erledigt.`
      : `Hey ${first}. ${todo.length === 1 ? '1 Sammlung wartet' : `${todo.length} Sammlungen warten`} auf deine Stimme.`
    : `Hey ${first}.`;
  return (
    <>
      <PageHead title={title}>
        {todo.length > 0
          ? 'Deine Stimme entscheidet mit, was in der Abizeitung landet.'
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
            <Empty>Gerade ist nichts offen. Sobald die Redaktion eine Sammlung öffnet, steht sie hier.</Empty>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {todo.map((p, i) => (
                <li key={p.id} className="flex min-w-0 flex-col rounded-ui bg-white p-5">
                  <h3 className="text-xl font-extrabold leading-snug">{p.name}</h3>
                  {p.description && <p className="mt-2 text-[15px] text-muted">{p.description}</p>}
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
                    <span className="flex items-center gap-1.5 text-[13px] text-muted">
                      <KindIcon icon={kindIcon[p.kind]} />
                      {[kindLabel[p.kind], plural(p.options.length, 'Option', 'Optionen'), since(p.opened_at)]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                    <Link to={`/sammlungen/${p.id}`} className={i === 0 ? btn.primary : btn.secondary}>
                      Abstimmen<span className="sr-only"> bei {p.name}</span>
                    </Link>
                  </div>
                  <DevDebug
                    label="Sammlung"
                    data={{
                      id: p.id,
                      status: p.status,
                      kind: p.kind,
                      version: p.version,
                      options: p.options.length,
                      allowSelfVote: p.allow_self_vote,
                      hasVoted: p.my_option_id !== null,
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="home-fortlaufend" className="mt-10">
        <h2 id="home-fortlaufend" className={heading}>
          Fortlaufend
        </h2>
        <div className="mt-4">
          {categories.isPending ? (
            <Loading />
          ) : categories.error ? (
            <Failure error={categories.error} retry={() => categories.refetch()} />
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {categories.data
                ?.filter((c) => c.repeatable)
                .map((c) => {
                  const n = own.filter((s) => s.category_id === c.id).length;
                  return (
                    <li key={c.id} className="min-w-0">
                      <div className="flex h-full flex-col">
                        <Link
                          to={`/sammlungen/${c.id}`}
                          className="flex h-full flex-col rounded-ui bg-white p-5 transition-transform hover:-translate-y-1 hover:bg-pop/40 active:scale-[.99]"
                        >
                          <span className="flex items-start justify-between gap-3">
                            <span className="flex min-w-0 items-center gap-2.5">
                              <KindIcon icon={kindIcon[c.kind]} className="size-5 text-muted" />
                              <strong className="text-xl font-extrabold leading-snug">{c.name}</strong>
                            </span>
                            <Arrow />
                          </span>
                          {c.description && <span className="mt-2 text-[15px] text-muted">{c.description}</span>}
                          <span className="mt-auto pt-4 text-[13px] text-muted">
                            {n ? `${n} eingereicht` : 'Noch nichts eingereicht'}
                          </span>
                        </Link>
                        {import.meta.env.DEV && (
                          <div className="px-5">
                            <DevDebug label="Sammlung" data={{ id: c.id, kind: c.kind, ownSubmissions: n }} />
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="home-beitraege" className="mt-10">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="home-beitraege" className={heading}>
            Deine Beiträge
          </h2>
          {own.length > 0 && (
            <Link to="/beitraege" className={btn.text}>
              Alle ansehen <Arrow />
            </Link>
          )}
        </div>
        <div className="mt-4">
          {submissions.isPending ? (
            <Loading />
          ) : submissions.error ? (
            <Failure error={submissions.error} retry={() => submissions.refetch()} />
          ) : own.length ? (
            <SubmissionList items={own.slice(0, 5)} categories={categories.data ?? []} />
          ) : (
            <Empty>Die erste Geschichte wartet auf dich. Such dir oben eine Sammlung aus.</Empty>
          )}
        </div>
      </section>

      {done.length > 0 && (
        <details className="mt-10 rounded-ui bg-white">
          <summary className="cursor-pointer px-5 py-4 text-[15px] font-semibold">
            Erledigte Sammlungen ({done.length})
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {done.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/sammlungen/${p.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-3 text-[15px] hover:bg-pop/30"
                >
                  <span className="min-w-0">{p.name}</span>
                  <span className="flex-none text-[13px] text-muted">{p.my_option_id ? 'abgestimmt' : 'beendet'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className={`${notice} mt-10 text-muted`}>
        <strong className="font-semibold text-ink">Unsere Erinnerungen bleiben im Jahrgang.</strong> Nur du und
        berechtigte Mitglieder der Redaktion können deine Beiträge sehen.
      </p>
    </>
  );
}

// ponytail: min-h-28 keeps room for a per-row summary line; nothing generates one yet.
function ThickRow({
  to,
  icon,
  title,
  badge,
  meta,
  count,
  unit,
  extra,
  debug,
}: {
  to: string;
  icon: LucideIcon;
  title: string;
  badge?: ReactNode;
  meta: string;
  count: number;
  unit: [string, string];
  extra?: string;
  debug?: { label: string; data: Record<string, string | number | boolean | null | undefined> };
}) {
  return (
    <li>
      <Link to={to} className="flex min-h-28 items-start gap-4 bg-white p-5 transition-colors hover:bg-pop/30">
        <KindIcon icon={icon} className="mt-1 size-5 text-muted" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <strong className="text-lg font-extrabold leading-snug">{title}</strong>
            {badge}
          </span>
          <small className="mt-1 block text-[13px] text-muted">{meta}</small>
        </span>
        <span className="ml-2 flex-none text-right">
          <strong className="block text-3xl font-extrabold tabular-nums leading-none">{count}</strong>
          <span className="mt-1 block text-[13px] text-muted">{unit[count === 1 ? 0 : 1]}</span>
          {extra && <span className="block text-[13px] tabular-nums text-muted">{extra}</span>}
        </span>
      </Link>
      {import.meta.env.DEV && debug && (
        <div className="px-5 pb-2">
          <DevDebug label={debug.label} data={debug.data} />
        </div>
      )}
    </li>
  );
}
const rows = 'mt-4 divide-y divide-line overflow-hidden rounded-ui bg-white';

function AdminHome() {
  const users = useData<User[]>('/admin/users');
  const categories = useData<Category[]>('/categories');
  const submissions = useData<Submission[]>('/submissions');
  const waiting = (users.data ?? []).filter((u) => !u.admitted).sort((a, b) => time(b.created_at) - time(a.created_at));
  const latest = [...(categories.data ?? [])].sort(newestOpened).slice(0, 4);
  const card = 'flex min-w-0 flex-col rounded-ui bg-white p-5 sm:p-6';
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
  const initials = (name: string) =>
    name
      .replace(/\(.*?\)/g, '')
      .split(/\s+/)
      .filter((w) => /^\p{L}/u.test(w))
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  return (
    <>
      <PageHead title="Redaktion">Zugänge und Sammlungen im Überblick.</PageHead>
      <section aria-labelledby="home-sammlungen" className="mb-10">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="home-sammlungen" className={heading}>
            Sammlungen
          </h2>
        </div>
        {state(categories) ?? (
          <ul className="mt-4 grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-3">
            {allKinds.map((kind) => {
              const mine = (categories.data ?? []).filter((c) => c.kind === kind);
              const ids = new Set(mine.map((c) => c.id));
              const n = (submissions.data ?? []).filter((s) => ids.has(s.category_id)).length;
              const repeatable = repeatableKinds.includes(kind);
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
                      <span className="text-[13px] text-muted">{mine.length === 1 ? 'Sammlung' : 'Sammlungen'}</span>
                    </span>
                    {repeatable ? (
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
      <div className="grid items-start gap-4 lg:grid-cols-[5fr_7fr]">
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
        <section aria-labelledby="home-neueste" className={card}>
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="home-neueste" className={`${heading} flex items-center gap-2`}>
              <Vote aria-hidden="true" className="size-[18px] shrink-0" />
              Neueste Sammlungen
            </h2>
            <Link to="/sammlungen" className={btn.text}>
              Alle <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
            </Link>
          </div>
          {state(categories) ??
            (latest.length === 0 ? (
              <div className="mt-4">
                <Empty>Noch keine Sammlung.</Empty>
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {latest.map((c) => (
                  <li key={c.id} className="min-w-0">
                    <Link
                      to={`/sammlungen/${c.id}`}
                      className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-pop/30"
                    >
                      <KindIcon icon={kindIcon[c.kind]} className="size-4 text-muted" />
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-[15px] font-semibold">{c.name}</strong>
                        <span className="block text-[13px] text-muted">
                          {[kindLabel[c.kind], c.status === 'open' && !c.repeatable ? since(c.opened_at) : '']
                            .filter(Boolean)
                            .join(', ')}
                        </span>
                      </span>
                      {!c.repeatable && <Badge status={c.status} />}
                    </Link>
                    <DevDebug
                      label="Sammlung"
                      data={{ id: c.id, status: c.status, kind: c.kind, version: c.version, options: c.options.length }}
                    />
                  </li>
                ))}
              </ul>
            ))}
        </section>
      </div>
    </>
  );
}

function EditorHome() {
  const categories = useData<Category[]>('/categories');
  const submissions = useData<Submission[]>('/submissions');
  const collected = (submissions.data ?? []).length;
  const open = (categories.data ?? []).filter((c) => !c.repeatable && c.status === 'open').length;
  const fact =
    !categories.data || !submissions.data
      ? ''
      : `${plural(collected, 'Beitrag', 'Beiträge')} gesammelt, ${open === 0 ? 'keine Wahl offen' : plural(open, 'Wahl', 'Wahlen') + ' offen'}`;
  const ballots = (categories.data ?? [])
    .filter((c) => !c.repeatable)
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || newestOpened(a, b));
  const fortlaufend = (categories.data ?? []).filter((c) => c.repeatable);
  return (
    <>
      <PageHead title="Redaktion">{fact || 'Einen Moment …'}</PageHead>
      <section aria-labelledby="home-sammlungen">
        <h2 id="home-sammlungen" className={heading}>
          Sammlungen
        </h2>
        {categories.isPending ? (
          <div className="mt-4">
            <Loading />
          </div>
        ) : categories.error ? (
          <div className="mt-4">
            <Failure error={categories.error} retry={() => categories.refetch()} />
          </div>
        ) : ballots.length === 0 ? (
          <div className="mt-4">
            <Empty>
              Noch keine Wahl. <Link to="/sammlungen?neu">Neue Sammlung anlegen →</Link>
            </Empty>
          </div>
        ) : (
          <ul className={rows}>
            {ballots.map((p) => (
              <ThickRow
                key={p.id}
                to={`/sammlungen/${p.id}`}
                icon={kindIcon[p.kind]}
                title={p.name}
                badge={<Badge status={p.status} />}
                meta={[
                  kindLabel[p.kind],
                  plural(p.options.length, 'Option', 'Optionen'),
                  p.status === 'open' ? since(p.opened_at) : '',
                ]
                  .filter(Boolean)
                  .join(', ')}
                count={p.ballot_count ?? 0}
                unit={['Stimme', 'Stimmen']}
                debug={{
                  label: 'Sammlung',
                  data: {
                    id: p.id,
                    status: p.status,
                    kind: p.kind,
                    version: p.version,
                    options: p.options.length,
                    allowSelfVote: p.allow_self_vote,
                  },
                }}
              />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="home-fortlaufend" className="mt-10">
        <h2 id="home-fortlaufend" className={heading}>
          Fortlaufend
        </h2>
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
        ) : (
          <ul className={rows}>
            {fortlaufend.map((c) => {
              const mine = (submissions.data ?? []).filter((s) => s.category_id === c.id);
              return (
                <ThickRow
                  key={c.id}
                  to={`/sammlungen/${c.id}`}
                  icon={kindIcon[c.kind]}
                  title={c.name}
                  meta={c.description || kindLabel[c.kind]}
                  count={mine.length}
                  unit={['Beitrag', 'Beiträge']}
                  debug={{
                    label: 'Sammlung',
                    data: {
                      id: c.id,
                      kind: c.kind,
                      submissions: mine.length,
                      pending: mine.filter((s) => s.status === 'pending').length,
                    },
                  }}
                />
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
