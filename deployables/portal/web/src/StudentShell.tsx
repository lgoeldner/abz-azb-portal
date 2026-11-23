import { ArrowLeft, Check, FileText, IdCard, LayoutDashboard, LogOut, Settings, User as UserIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, editorial, json, type Category, type Submission } from './api';
import { LegalLinks } from './Consent';
import { offerKey, PasskeyOffer } from './Passkeys';
import { useAction, useData, useSession, useWorkspaceView } from './ui';
import './StudentUI.css';

export function StudentShell() {
  const { user } = useSession();
  const [, setView] = useWorkspaceView();
  const location = useLocation();
  const navigate = useNavigate();
  const categories = useData<Category[]>('/categories');
  const submissions = useData<Submission[]>('/submissions');
  const logoutAction = useAction();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const own = (submissions.data ?? []).filter((s) => s.author_id === user.id && s.status !== 'withdrawn');
  const steckbriefCategory = (categories.data ?? []).find((c) => c.kind === 'steckbrief' && c.status === 'open');
  const steckbriefSubmission = steckbriefCategory
    ? own.find((s) => s.category_id === steckbriefCategory.id)
    : undefined;
  const steckbriefPending = Boolean(steckbriefCategory && !steckbriefSubmission);
  const steckbriefHref = steckbriefSubmission
    ? `/beitraege/${steckbriefSubmission.id}`
    : steckbriefCategory
      ? `/beitraege/neu?sammlung=${steckbriefCategory.id}`
      : null;

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const isHome = location.pathname === '/';

  const handleLogout = () => {
    setMenuOpen(false);
    void logoutAction.run(async () => {
      await api('/auth/logout', json('POST'));
      if (import.meta.env.VITE_PREVIEW_MOCK !== 'true') {
        window.location.assign('/');
      }
    });
  };

  const openRedaktion = () => {
    setMenuOpen(false);
    setView('redaktion');
    navigate('/');
  };

  return (
    <div data-workspace="schueler" className="flex min-h-screen flex-col bg-paper text-ink">
      <a
        href="#inhalt"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
      >
        Zum Inhalt springen
      </a>

      <header className="sticky top-0 z-30 border-b border-black/[0.06] bg-paper/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-3 px-4 sm:px-6">
          {isHome ? (
            <Link
              to="/"
              className="text-[19px] font-extrabold tracking-[-0.035em] text-ink"
              aria-label="AbiZeitBetrug Startseite"
            >
              AbiZeitBetrug
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/')}
              className="-ml-2 inline-flex min-h-10 items-center gap-1.5 rounded-full px-2.5 text-[15px] font-semibold text-ink transition-colors hover:bg-black/[0.05] active:scale-[0.98]"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              <span>Zurück</span>
            </button>
          )}

          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-label={steckbriefPending ? 'Konto öffnen – Steckbrief noch offen' : 'Konto öffnen'}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              onClick={() => setMenuOpen((v) => !v)}
              className="relative grid size-10 place-items-center rounded-full border border-black/[0.09] bg-white text-ink shadow-xs transition-transform hover:bg-soft active:scale-95"
            >
              <UserIcon aria-hidden="true" className="size-[18px]" strokeWidth={2.1} />
              {steckbriefPending && (
                <span
                  aria-hidden="true"
                  className="absolute right-0.5 top-0.5 size-2.5 rounded-full bg-accent ring-2 ring-paper"
                />
              )}
            </button>

            {menuOpen && (
              <div
                role="menu"
                aria-label="Kontomenü"
                className="student-dropdown absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl border border-black/[0.08] bg-white p-1.5 shadow-xl"
              >
                <div className="px-3 py-2.5">
                  <p className="truncate text-[14px] font-bold text-ink">{user.name}</p>
                </div>

                <div className="my-1 border-t border-black/[0.06]" />

                {steckbriefHref && (
                  <Link
                    role="menuitem"
                    to={steckbriefHref}
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-11 items-center justify-between gap-2 rounded-xl px-3 py-2 text-[14px] font-medium text-ink transition-colors hover:bg-soft"
                  >
                    <span className="flex items-center gap-2.5">
                      <IdCard aria-hidden="true" className="size-4 text-muted" />
                      <span>Steckbrief</span>
                    </span>
                    {steckbriefPending ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-bold text-accent">
                        <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
                        Offen
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-ok">
                        <Check aria-hidden="true" className="size-3.5" />
                        Fertig
                      </span>
                    )}
                  </Link>
                )}

                <Link
                  role="menuitem"
                  to="/beitraege"
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-11 items-center justify-between gap-2 rounded-xl px-3 py-2 text-[14px] font-medium text-ink transition-colors hover:bg-soft"
                >
                  <span className="flex items-center gap-2.5">
                    <FileText aria-hidden="true" className="size-4 text-muted" />
                    <span>Meine Beiträge</span>
                  </span>
                  {own.length > 0 && <span className="text-[12px] tabular-nums text-muted">{own.length}</span>}
                </Link>

                <Link
                  role="menuitem"
                  to="/einstellungen"
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 text-[14px] font-medium text-ink transition-colors hover:bg-soft"
                >
                  <Settings aria-hidden="true" className="size-4 text-muted" />
                  <span>Einstellungen</span>
                </Link>

                {editorial(user) && (
                  <>
                    <div className="my-1 border-t border-black/[0.06]" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={openRedaktion}
                      className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[14px] font-medium text-ink transition-colors hover:bg-soft"
                    >
                      <LayoutDashboard aria-hidden="true" className="size-4 text-muted" />
                      <span>Redaktion öffnen</span>
                    </button>
                  </>
                )}

                <div className="my-1 border-t border-black/[0.06]" />

                <button
                  type="button"
                  role="menuitem"
                  disabled={logoutAction.busy}
                  onClick={handleLogout}
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[14px] font-medium text-muted transition-colors hover:bg-soft hover:text-ink"
                >
                  <LogOut aria-hidden="true" className="size-4" />
                  <span>Abmelden</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main
        id="inhalt"
        className={isHome ? 'w-full flex-1 pb-24 pt-5' : 'mx-auto w-full max-w-2xl flex-1 px-4 pb-24 pt-6 sm:px-6'}
      >
        {localStorage.getItem(offerKey) && (
          <div className={isHome ? 'mx-auto max-w-2xl px-4 sm:px-6' : ''}>
            <PasskeyOffer />
          </div>
        )}
        <Outlet />
      </main>

      <footer className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-2 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2 text-[12px] text-muted sm:px-6">
        <span>AbiZeitBetrug · LMGU 2027</span>
        <LegalLinks className="text-[12px]" />
      </footer>
    </div>
  );
}
