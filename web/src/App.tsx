import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError, editorial, json, setCsrf, type Category, type Me, type Poll, type Submission } from './api';
import { Arrow, Badge, Empty, Failure, Loading, PageHead, Session, SubmissionList, btn, heading, notice, roleName, since, useAction, useData, useSession, useView, type View } from './ui';
import { Admin, ContributionDetail, Contributions, Editorial, NewContribution, NotFound, PollDetail, Polls } from './pages';
import { DevDebug } from './DevDebug';

export function App() {
  const me = useData<Me>('/me');
  useEffect(() => { if (me.data) setCsrf(me.data.csrf_token); }, [me.data]);
  if (me.isPending) return <main className="grid min-h-screen place-items-center p-6"><Loading/></main>;
  if (me.error) return me.error instanceof ApiError && me.error.status === 401 ? <Login/> : <main className="grid min-h-screen place-items-center p-6"><Failure error={me.error} retry={() => me.refetch()}/></main>;
  if (!me.data.user.admitted) return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="flex w-full max-w-md flex-col items-start gap-5 rounded-ui bg-white p-6 sm:p-8">
        <Brand/>
        <h1 className="text-3xl font-extrabold tracking-tight">Dein Platz ist reserviert.</h1>
        <p className="text-[15px] text-muted">Die Administration muss deinen Zugang noch freigeben. Melde dich beim Abizeitungsteam.</p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <button type="button" className={btn.secondary} onClick={() => me.refetch()}>Freigabe prüfen</button>
          <Logout/>
        </div>
      </section>
    </main>
  );
  return <Session.Provider value={me.data}><Routes><Route element={<Layout/>}><Route index element={<Overview/>}/><Route path="beitraege" element={<Contributions/>}/><Route path="beitraege/neu" element={<NewContribution/>}/><Route path="beitraege/:id" element={<ContributionDetail/>}/><Route path="abstimmungen" element={<Polls/>}/><Route path="abstimmungen/:id" element={<PollDetail/>}/><Route path="redaktion" element={<RoleGuard><Editorial/></RoleGuard>}/><Route path="admin" element={<RoleGuard admin><Admin/></RoleGuard>}/><Route path="*" element={<NotFound/>}/></Route></Routes></Session.Provider>;
}

// ---------- small helpers ----------
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const time = (value: string | null | undefined) => (value ? new Date(value).getTime() : 0);
const newestOpened = (a: Poll, b: Poll) => time(b.opened_at ?? b.created_at) - time(a.opened_at ?? a.created_at);
const kindLabel = (kind: Poll['kind']) => (kind === 'person' ? 'Personenwahl' : 'Vorschlag');
const statusOrder = { open: 0, draft: 1, closed: 2 } as const;

// The sidebar switch and the home page must agree on the view, so Layout owns the single hook instance.
const ViewContext = createContext<[View, (view: View) => void]>(['schueler', () => {}]);

function Mark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 40" className={`flex-none ${className}`}>
      <g transform="rotate(-7 20 20)">
        <path d="M5 4h30a2 2 0 0 1 2 2v28a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" className="fill-ink"/>
        <path d="M37 6v11H26a2 2 0 0 1-2-2V4h11a2 2 0 0 1 2 2z" className="fill-accent"/>
        <path d="M24 4v11a2 2 0 0 0 2 2h11" fill="none" strokeWidth="1.5" className="stroke-paper"/>
        <text x="4.5" y="31" fontSize="21" fontWeight="800" letterSpacing="-1.5" className="fill-pop" style={{ fontFamily: 'inherit' }}>27</text>
        <rect x="6" y="9" width="13" height="2.4" rx="1.2" className="fill-paper"/>
      </g>
    </svg>
  );
}
function Brand({ large = false }: { large?: boolean }) {
  return <span className="inline-flex items-center gap-2.5"><Mark className={large ? 'size-12' : 'size-8'}/><span className={`font-extrabold tracking-tighter ${large ? 'text-3xl' : 'text-xl'}`}>AbiZeit<span className="text-accent">Betrug</span>.</span></span>;
}
function Logout() {
  const action = useAction();
  return <>{action.feedback}<button type="button" className={btn.text} disabled={action.busy} onClick={() => action.run(async () => { await api('/auth/logout', json('POST')); window.location.assign('/'); })}>Abmelden <Arrow/></button></>;
}

function Login() {
  return (
    <main className="grid min-h-screen bg-paper md:grid-cols-[1.15fr_1fr]">
      <section className="flex flex-col justify-between gap-12 p-6 sm:p-10 lg:p-14">
        <Brand large/>
        <div>
          <span aria-hidden="true" className="block select-none -rotate-6 text-[min(40vw,15rem)] font-extrabold leading-[.8] tracking-tighter text-pop">27</span>
          <h1 className="mt-8 text-5xl font-extrabold leading-[1.02] tracking-tighter sm:text-7xl">Die beste Zeit.<br/><span className="text-muted">Zum Festhalten.</span></h1>
          <p className="mt-4 max-w-md text-[17px] text-muted">13 Jahre Schule. Unzählige Geschichten.<br/>Hier entsteht unsere Abizeitung.</p>
        </div>
        <p className="text-sm text-muted">LMGU 2027 · Unser Jahrgang, unsere Geschichten.</p>
      </section>
      <section className="flex items-center bg-chrome p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-md rounded-ui bg-white p-6 sm:p-8">
          <h2 className="text-3xl font-extrabold tracking-tight">Schön, dass du da bist.</h2>
          <p className="mt-3 text-[15px] text-muted">Melde dich an, um Erinnerungen einzureichen und bei unseren Abstimmungen mitzumachen.</p>
          <a className={`${btn.primary} mt-6 w-full`} href="/auth/login">Mit Schulkonto anmelden <Arrow/></a>
          <p className="mt-5 text-sm text-muted">Privater Bereich für unseren Jahrgang. Beiträge und Bilder sind nur für berechtigte Personen zugänglich.</p>
        </div>
      </section>
    </main>
  );
}

// ---------- layout + sidebar ----------
const navItem = 'flex min-h-10 items-center justify-between gap-3 rounded-full px-3.5 py-1.5 text-[15px] transition-transform active:scale-[.98] max-[651px]:min-h-11';
const groupLabel = 'px-3.5 text-sm font-bold text-ink';

function Layout() {
  const { user } = useSession();
  const view = useView();
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  return (
    <ViewContext.Provider value={view}>
      <a className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-full focus:bg-white focus:px-3 focus:py-2 focus:text-sm" href="#inhalt">Zum Inhalt</a>
      <header className="fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-3 bg-chrome px-2 min-[651px]:hidden">
        <button type="button" className="grid size-10 place-items-center rounded-full text-xl hover:bg-pill" aria-label={menu ? 'Menü schließen' : 'Menü öffnen'} aria-expanded={menu} onClick={() => setMenu(!menu)}><span aria-hidden="true">☰</span></button>
        <Brand/>
      </header>
      {menu && <button type="button" tabIndex={-1} aria-hidden="true" className="fixed inset-0 z-30 bg-ink/30 min-[651px]:hidden" onClick={() => setMenu(false)}/>}
      <aside aria-label="Seitenleiste" className={`fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col bg-chrome max-[651px]:top-12 max-[651px]:w-[min(86vw,320px)] max-[651px]:transition-transform ${menu ? '' : 'max-[651px]:invisible max-[651px]:-translate-x-full'}`}>
        <Link to="/" className="flex-none rounded-full px-5 pb-4 pt-5 max-[651px]:hidden" aria-label="AbiZeitBetrug Startseite" onClick={() => setMenu(false)}><Brand/></Link>
        <nav aria-label="Hauptnavigation" className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-3 py-2 max-[651px]:pt-4" onClick={e => { if ((e.target as Element).closest('a')) setMenu(false); }}>
          <NavItem to="/">Überblick</NavItem>
          {view[0] === 'redaktion' && editorial(user) ? <EditorNav/> : <StudentNav/>}
        </nav>
        <div className="flex flex-none flex-col gap-3 bg-pill px-3 py-4">
          {editorial(user) && <ViewSwitch onSwitch={() => setMenu(false)}/>}
          <div className="flex items-center gap-3 px-1">
            <span className="grid size-9 flex-none place-items-center rounded-full bg-pop text-[13px] font-bold" aria-hidden="true">{user.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</span>
            <div className="min-w-0 leading-tight"><strong className="block truncate text-[15px] font-semibold">{user.name}</strong><small className="text-[13px] text-muted">{roleName(user.role)}</small></div>
          </div>
          <div className="px-3.5"><Logout/></div>
        </div>
      </aside>
      <div className="flex min-h-screen flex-col bg-paper max-[651px]:pt-12 min-[651px]:pl-[260px]">
        <main id="inhalt" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-8 sm:py-10"><Outlet/>{import.meta.env.DEV && <div className="mt-8"><DevDebug label="Sitzung" data={{ role: user.role, view: view[0], admitted: user.admitted, cohort: user.cohort_member, grants: user.category_ids.length, route: location.pathname }}/></div>}</main>
        <footer className="px-4 pb-6 text-[13px] text-muted sm:px-8">AbiZeitBetrug. · Privater Jahrgangsbereich LMGU 2027</footer>
      </div>
    </ViewContext.Provider>
  );
}

function ViewSwitch({ onSwitch }: { onSwitch: () => void }) {
  const [view, setView] = useContext(ViewContext);
  const navigate = useNavigate();
  const choose = (next: View) => { setView(next); onSwitch(); navigate('/'); };
  const seg = (active: boolean) => `min-h-10 flex-1 rounded-full px-3 text-sm transition-transform active:scale-95 ${active ? 'bg-ink font-bold text-pop' : 'font-semibold text-ink hover:bg-white/60'}`;
  return (
    <div className="flex gap-0.5 rounded-full bg-white/70 p-1">
      <button type="button" className={seg(view === 'schueler')} aria-pressed={view === 'schueler'} onClick={() => choose('schueler')}>Schüler</button>
      <button type="button" className={seg(view === 'redaktion')} aria-pressed={view === 'redaktion'} onClick={() => choose('redaktion')}>Redaktion</button>
    </div>
  );
}

function NavItem({ to, children }: { to: string; children: ReactNode }) {
  const location = useLocation();
  const active = location.pathname + location.search === to;
  return <Link to={to} aria-current={active ? 'page' : undefined} className={`${navItem} ${active ? 'bg-ink font-bold text-pop' : 'hover:bg-pill'}`}>{children}</Link>;
}
function NavRow({ to, title, sub, end }: { to: string; title: string; sub?: string; end?: string }) {
  const location = useLocation();
  const active = location.pathname + location.search === to;
  return (
    <Link to={to} aria-current={active ? 'page' : undefined} className={`${navItem} ${active ? 'bg-ink text-white' : 'hover:bg-pill'}`}>
      <span className="min-w-0"><span className={`block truncate ${active ? 'font-bold text-pop' : ''}`}>{title}</span>{sub && <small className={`block truncate text-[13px] ${active ? 'text-white/80' : 'text-muted'}`}>{sub}</small>}</span>
      {end && <span className={`flex-none text-[13px] tabular-nums ${active ? 'text-white/80' : 'text-muted'}`}>{end}</span>}
    </Link>
  );
}
function NavGroup({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div role="group" aria-labelledby={id} className="flex flex-col gap-1"><p id={id} className={groupLabel}>{label}</p>{children}</div>;
}
const quiet = 'px-3.5 text-[13px] text-muted';

function StudentNav() {
  const { user } = useSession();
  const polls = useData<Poll[]>('/polls');
  const categories = useData<Category[]>('/categories');
  const submissions = useData<Submission[]>('/submissions');
  const todo = (polls.data ?? []).filter(p => p.status === 'open' && p.my_option_id === null).sort(newestOpened);
  const done = (polls.data ?? []).filter(p => p.status === 'closed' || (p.status === 'open' && p.my_option_id !== null)).sort(newestOpened);
  const own = (submissions.data ?? []).filter(s => s.author_id === user.id);
  return <>
    <NavGroup id="nav-offen" label="Offen">
      {polls.isPending ? <p className={quiet}>Einen Moment …</p> : polls.error ? <p className={quiet}>Abstimmungen nicht erreichbar.</p> : todo.length === 0 ? <p className={quiet}>Gerade ist nichts offen.</p> : (
        <ol aria-labelledby="nav-offen" className="ml-3 flex flex-col border-l-2 border-pill">
          {todo.map(p => <li key={p.id} className="relative pl-3"><span aria-hidden="true" className="absolute left-0 top-[17px] size-2 -translate-x-1/2 rounded-full bg-accent"/><NavRow to={`/abstimmungen/${p.id}`} title={p.title} sub={since(p.opened_at)}/></li>)}
        </ol>
      )}
    </NavGroup>
    <NavGroup id="nav-jederzeit" label="Jederzeit">
      {categories.isPending ? <p className={quiet}>Einen Moment …</p> : categories.error ? <p className={quiet}>Rubriken nicht erreichbar.</p> : categories.data?.map(c => {
        const n = own.filter(s => s.category_id === c.id).length;
        return <NavRow key={c.id} to={`/beitraege/neu?kategorie=${c.id}`} title={c.name} sub={n ? `${n} eingereicht` : 'Noch nichts eingereicht'}/>;
      })}
    </NavGroup>
    <div className="flex flex-col gap-1">
      <details className="group">
        <summary className={`${navItem} cursor-pointer list-none text-muted hover:bg-pill [&::-webkit-details-marker]:hidden`}>Erledigt ({done.length})<span aria-hidden="true" className="text-xs group-open:rotate-90">›</span></summary>
        <div className="mt-1 flex flex-col gap-1">
          {done.length === 0 ? <p className={quiet}>Noch nichts erledigt.</p> : done.map(p => <NavRow key={p.id} to={`/abstimmungen/${p.id}`} title={p.title} sub={p.my_option_id ? '✓ abgestimmt' : 'beendet'}/>)}
        </div>
      </details>
      <NavItem to="/beitraege">Meine Beiträge</NavItem>
    </div>
  </>;
}

function EditorNav() {
  const { user } = useSession();
  const polls = useData<Poll[]>('/polls');
  const categories = useData<Category[]>('/categories');
  const submissions = useData<Submission[]>('/submissions');
  const groups: [Poll['status'], string, string][] = [['open', 'Offen', 'nav-poll-offen'], ['draft', 'Entwürfe', 'nav-poll-entwuerfe'], ['closed', 'Beendet', 'nav-poll-beendet']];
  return <>
    <NavGroup id="nav-abstimmungen" label="Abstimmungen">
      {polls.isPending ? <p className={quiet}>Einen Moment …</p> : polls.error ? <p className={quiet}>Abstimmungen nicht erreichbar.</p> : polls.data?.length === 0 ? <p className={quiet}>Noch keine Abstimmung.</p> : groups.map(([status, label, id]) => {
        const items = (polls.data ?? []).filter(p => p.status === status).sort(newestOpened);
        return items.length > 0 && (
          <div key={status} role="group" aria-labelledby={id} className="mt-1 flex flex-col gap-1">
            <p id={id} className={`${quiet} flex items-center gap-1.5`}>{status === 'open' && <span aria-hidden="true" className="size-1.5 rounded-full bg-accent"/>}{label}</p>
            {items.map(p => <NavRow key={p.id} to={`/abstimmungen/${p.id}`} title={p.title} end={plural(p.ballot_count ?? 0, 'Stimme', 'Stimmen')}/>)}
          </div>
        );
      })}
      <NavItem to="/abstimmungen?neu">Neue Abstimmung</NavItem>
    </NavGroup>
    <NavGroup id="nav-rubriken" label="Rubriken">
      {categories.isPending ? <p className={quiet}>Einen Moment …</p> : categories.error ? <p className={quiet}>Rubriken nicht erreichbar.</p> : categories.data?.map(c => {
        const mine = (submissions.data ?? []).filter(s => s.category_id === c.id);
        return <NavRow key={c.id} to={`/redaktion?rubrik=${c.id}`} title={c.name} sub={`${plural(mine.length, 'Beitrag', 'Beiträge')} · ${mine.filter(s => s.status === 'pending').length} offen`}/>;
      })}
      <NavItem to="/redaktion">Alle Beiträge</NavItem>
    </NavGroup>
    {user.role === 'admin' && <NavItem to="/admin">Verwaltung</NavItem>}
  </>;
}

function RoleGuard({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { user } = useSession();
  return (admin ? user.role === 'admin' : editorial(user)) ? children : <Navigate to="/" replace/>;
}

// ---------- home ----------
function Overview() {
  const { user } = useSession();
  const [view] = useContext(ViewContext);
  return view === 'redaktion' && editorial(user) ? <EditorHome/> : <StudentHome/>;
}

function StudentHome() {
  const { user } = useSession();
  const polls = useData<Poll[]>('/polls');
  const categories = useData<Category[]>('/categories');
  const submissions = useData<Submission[]>('/submissions');
  const first = user.name.split(' ')[0];
  const todo = (polls.data ?? []).filter(p => p.status === 'open' && p.my_option_id === null).sort(newestOpened);
  const done = (polls.data ?? []).filter(p => p.status === 'closed' || (p.status === 'open' && p.my_option_id !== null)).sort(newestOpened);
  const own = (submissions.data ?? []).filter(s => s.author_id === user.id);
  const title = polls.data ? (todo.length === 0 ? `Hey ${first}. Gerade ist alles erledigt.` : `Hey ${first}. ${todo.length === 1 ? '1 Abstimmung wartet' : `${todo.length} Abstimmungen warten`} auf dich.`) : `Hey ${first}.`;
  return <>
    <PageHead title={title}>{todo.length > 0 ? 'Deine Stimme entscheidet mit, was in der Abizeitung landet.' : 'Vielleicht fällt dir noch eine Geschichte ein, die in die Abizeitung gehört.'}</PageHead>

    <section aria-labelledby="home-dran">
      <h2 id="home-dran" className={heading}>Jetzt dran</h2>
      <div className="mt-4">
        {polls.isPending ? <Loading/> : polls.error ? <Failure error={polls.error} retry={() => polls.refetch()}/> : todo.length === 0 ? <Empty>Gerade ist nichts offen. Sobald die Redaktion eine Abstimmung öffnet, steht sie hier.</Empty> : (
          <ul className="grid gap-4 md:grid-cols-2">
            {todo.map((p, i) => (
              <li key={p.id} className="flex min-w-0 flex-col rounded-ui bg-white p-5">
                <h3 className="text-xl font-extrabold leading-snug">{p.title}</h3>
                {p.description && <p className="mt-2 text-[15px] text-muted">{p.description}</p>}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
                  <span className="text-[13px] text-muted">{[kindLabel(p.kind), plural(p.options.length, 'Option', 'Optionen'), since(p.opened_at)].filter(Boolean).join(' · ')}</span>
                  <Link to={`/abstimmungen/${p.id}`} className={i === 0 ? btn.primary : btn.secondary}>Abstimmen<span className="sr-only"> bei {p.title}</span></Link>
                </div>
                <DevDebug label="Abstimmung" data={{ id: p.id, category: p.category_id, status: p.status, kind: p.kind, version: p.version, options: p.options.length, allowSelfVote: p.allow_self_vote, hasVoted: p.my_option_id !== null }}/>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>

    <section aria-labelledby="home-jederzeit" className="mt-10">
      <h2 id="home-jederzeit" className={heading}>Jederzeit</h2>
      <div className="mt-4">
        {categories.isPending ? <Loading/> : categories.error ? <Failure error={categories.error} retry={() => categories.refetch()}/> : (
          <ul className="grid gap-4 md:grid-cols-2">
            {categories.data?.map(c => {
              const n = own.filter(s => s.category_id === c.id).length;
              return (
                <li key={c.id} className="min-w-0">
                  <div className="flex h-full flex-col">
                  <Link to={`/beitraege/neu?kategorie=${c.id}`} className="flex h-full flex-col rounded-ui bg-white p-5 transition-transform hover:-translate-y-1 hover:bg-pop/40 active:scale-[.99]">
                    <span className="flex items-start justify-between gap-3"><strong className="text-xl font-extrabold leading-snug">{c.name}</strong><Arrow/></span>
                    {c.description && <span className="mt-2 text-[15px] text-muted">{c.description}</span>}
                    <span className="mt-auto pt-4 text-[13px] text-muted">{n ? `${n} eingereicht` : 'Noch nichts eingereicht'}</span>
                  </Link>
                  {import.meta.env.DEV && <div className="px-5"><DevDebug label="Rubrik" data={{ id: c.id, kind: c.kind, ownSubmissions: n }}/></div>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>

    <section aria-labelledby="home-beitraege" className="mt-10">
      <div className="flex items-baseline justify-between gap-4"><h2 id="home-beitraege" className={heading}>Deine Beiträge</h2>{own.length > 0 && <Link to="/beitraege" className={btn.text}>Alle ansehen <Arrow/></Link>}</div>
      <div className="mt-4">
        {submissions.isPending ? <Loading/> : submissions.error ? <Failure error={submissions.error} retry={() => submissions.refetch()}/> : own.length ? <SubmissionList items={own.slice(0, 5)} categories={categories.data ?? []}/> : <Empty>Die erste Geschichte wartet auf dich. Such dir oben eine Rubrik aus.</Empty>}
      </div>
    </section>

    {done.length > 0 && (
      <details className="mt-10 rounded-ui bg-white">
        <summary className="cursor-pointer px-5 py-4 text-[15px] font-semibold">Erledigte Abstimmungen ({done.length})</summary>
        <ul className="divide-y divide-line border-t border-line">
          {done.map(p => <li key={p.id}><Link to={`/abstimmungen/${p.id}`} className="flex items-center justify-between gap-4 px-5 py-3 text-[15px] hover:bg-pop/30"><span className="min-w-0">{p.title}</span><span className="flex-none text-[13px] text-muted">{p.my_option_id ? '✓ abgestimmt' : 'beendet'}</span></Link></li>)}
        </ul>
      </details>
    )}

    <p className={`${notice} mt-10 text-muted`}><strong className="font-semibold text-ink">Unsere Erinnerungen bleiben im Jahrgang.</strong> Nur du und berechtigte Mitglieder der Redaktion können deine Beiträge sehen.</p>
  </>;
}

// ponytail: min-h-28 keeps room for a per-row summary line; nothing generates one yet.
function ThickRow({ to, title, badge, meta, count, unit, extra, debug }: { to: string; title: string; badge?: ReactNode; meta: string; count: number; unit: [string, string]; extra?: string; debug?: { label: string; data: Record<string, string | number | boolean | null | undefined> } }) {
  return (
    <li>
      <Link to={to} className="flex min-h-28 items-start justify-between gap-6 bg-white p-5 transition-colors hover:bg-pop/30">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1"><strong className="text-lg font-extrabold leading-snug">{title}</strong>{badge}</span>
          <small className="mt-1 block text-[13px] text-muted">{meta}</small>
        </span>
        <span className="flex-none text-right"><strong className="block text-3xl font-extrabold tabular-nums leading-none">{count}</strong><span className="mt-1 block text-[13px] text-muted">{unit[count === 1 ? 0 : 1]}</span>{extra && <span className="block text-[13px] tabular-nums text-muted">{extra}</span>}</span>
      </Link>
      {import.meta.env.DEV && debug && <div className="px-5 pb-2"><DevDebug label={debug.label} data={debug.data}/></div>}
    </li>
  );
}
const rows = 'mt-4 divide-y divide-line overflow-hidden rounded-ui bg-white';

function EditorHome() {
  const polls = useData<Poll[]>('/polls');
  const categories = useData<Category[]>('/categories');
  const submissions = useData<Submission[]>('/submissions');
  const pending = (submissions.data ?? []).filter(s => s.status === 'pending').length;
  const open = (polls.data ?? []).filter(p => p.status === 'open').length;
  const fact = !polls.data || !submissions.data ? '' : `${pending === 0 ? 'Keine Beiträge warten auf Prüfung' : pending === 1 ? '1 Beitrag wartet auf Prüfung' : `${pending} Beiträge warten auf Prüfung`} · ${open === 0 ? 'keine Abstimmung offen' : plural(open, 'Abstimmung', 'Abstimmungen') + ' offen'}`;
  const sorted = [...(polls.data ?? [])].sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || newestOpened(a, b));
  return <>
    <PageHead title="Redaktion">{fact || 'Einen Moment …'}</PageHead>
    <section aria-labelledby="home-abstimmungen">
      <h2 id="home-abstimmungen" className={heading}>Abstimmungen</h2>
      {polls.isPending ? <div className="mt-4"><Loading/></div> : polls.error ? <div className="mt-4"><Failure error={polls.error} retry={() => polls.refetch()}/></div> : sorted.length === 0 ? <div className="mt-4"><Empty>Noch keine Abstimmung. <Link to="/abstimmungen?neu">Neue Abstimmung anlegen →</Link></Empty></div> : (
        <ul className={rows}>
          {sorted.map(p => <ThickRow key={p.id} to={`/abstimmungen/${p.id}`} title={p.title} badge={<Badge status={p.status}/>} meta={[kindLabel(p.kind), plural(p.options.length, 'Option', 'Optionen'), p.status === 'open' ? since(p.opened_at) : ''].filter(Boolean).join(' · ')} count={p.ballot_count ?? 0} unit={['Stimme', 'Stimmen']} debug={{ label: 'Abstimmung', data: { id: p.id, category: p.category_id, status: p.status, kind: p.kind, version: p.version, options: p.options.length, allowSelfVote: p.allow_self_vote, hasVoted: p.my_option_id !== null } }}/>) }
        </ul>
      )}
    </section>
    <section aria-labelledby="home-rubriken" className="mt-10">
      <h2 id="home-rubriken" className={heading}>Rubriken</h2>
      {categories.isPending || submissions.isPending ? <div className="mt-4"><Loading/></div> : categories.error || submissions.error ? <div className="mt-4"><Failure error={(categories.error ?? submissions.error)!} retry={() => { categories.refetch(); submissions.refetch(); }}/></div> : (
        <ul className={rows}>
          {categories.data?.map(c => {
            const mine = (submissions.data ?? []).filter(s => s.category_id === c.id);
            return <ThickRow key={c.id} to={`/redaktion?rubrik=${c.id}`} title={c.name} meta={c.description || 'Rubrik'} count={mine.length} unit={['Beitrag', 'Beiträge']} extra={`${mine.filter(s => s.status === 'pending').length} offen`} debug={{ label: 'Rubrik', data: { id: c.id, kind: c.kind, submissions: mine.length, pending: mine.filter(s => s.status === 'pending').length } }}/>;
          })}
        </ul>
      )}
    </section>
  </>;
}
