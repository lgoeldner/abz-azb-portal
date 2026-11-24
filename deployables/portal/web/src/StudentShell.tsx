import { ArrowLeft, User as UserIcon } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, editorial, json, type Category, type Submission } from './api';
import { LegalLinks } from './Consent';
import { offerKey, PasskeyOffer } from './Passkeys';
import { useAction, useData, useSession, useWorkspaceView } from './ui';
import './StudentUI.css';

type ProgressInfo = { done: number; total: number } | null;
const HeaderProgressContext = createContext<(p: ProgressInfo) => void>(() => {});

export function useSetHeaderProgress() {
  return useContext(HeaderProgressContext);
}

export function StudentShell() {
  const { user } = useSession();
  const [, setView] = useWorkspaceView();
  const location = useLocation();
  const navigate = useNavigate();
  const categories = useData<Category[]>('/categories');
  const submissions = useData<Submission[]>('/submissions');
  const logoutAction = useAction();

  const [menuOpen, setMenuOpen] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo>(null);
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
  const pct =
    isHome && progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

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
    <HeaderProgressContext.Provider value={setProgress}>
      <div data-workspace="schueler" className="flex min-h-screen flex-col bg-paper text-ink">
        <header className="sticky top-0 z-30 bg-paper/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <div className="mx-auto flex h-13 max-w-xl items-center justify-between px-5">
            {isHome ? (
              <Link
                to="/"
                className="text-[17px] font-extrabold tracking-[-0.03em] text-ink"
                aria-label="AbiZeitBetrug Startseite"
              >
                AbiZeitBetrug
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => navigate('/')}
                className="-ml-2 inline-flex min-h-10 items-center gap-1.5 rounded-full px-2 text-[15px] font-medium text-ink hover:bg-soft"
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
                className="relative -mr-1.5 grid size-10 place-items-center rounded-full text-ink transition-colors hover:bg-soft active:scale-95"
              >
                <UserIcon aria-hidden="true" className="size-[20px]" strokeWidth={1.9} />
                {steckbriefPending && (
                  <span
                    aria-hidden="true"
                    className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent ring-2 ring-paper"
                  />
                )}
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  aria-label="Kontomenü"
                  className="student-dropdown absolute right-0 mt-1.5 w-56 rounded-2xl border border-black/[0.08] bg-white py-1.5 shadow-lg"
                >
                  <p className="truncate px-4 py-2 text-[13px] font-semibold text-muted">{user.name}</p>
                  <div className="my-1 border-t border-black/[0.06]" />

                  {steckbriefHref && (
                    <Link
                      role="menuitem"
                      to={steckbriefHref}
                      onClick={() => setMenuOpen(false)}
                      className="flex min-h-10 items-center justify-between px-4 text-[14px] font-medium text-ink hover:bg-soft"
                    >
                      <span>Steckbrief</span>
                      {steckbriefPending && (
                        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-accent">
                          <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
                          Offen
                        </span>
                      )}
                    </Link>
                  )}

                  <Link
                    role="menuitem"
                    to="/beitraege"
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-10 items-center justify-between px-4 text-[14px] font-medium text-ink hover:bg-soft"
                  >
                    <span>Meine Beiträge</span>
                    {own.length > 0 && <span className="text-[12px] tabular-nums text-muted">{own.length}</span>}
                  </Link>

                  <Link
                    role="menuitem"
                    to="/einstellungen"
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-10 items-center px-4 text-[14px] font-medium text-ink hover:bg-soft"
                  >
                    Einstellungen
                  </Link>

                  {editorial(user) && (
                    <>
                      <div className="my-1 border-t border-black/[0.06]" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={openRedaktion}
                        className="flex min-h-10 w-full items-center px-4 text-left text-[14px] font-medium text-ink hover:bg-soft"
                      >
                        Redaktion
                      </button>
                    </>
                  )}

                  <div className="my-1 border-t border-black/[0.06]" />
                  <button
                    type="button"
                    role="menuitem"
                    disabled={logoutAction.busy}
                    onClick={handleLogout}
                    className="flex min-h-10 w-full items-center px-4 text-left text-[14px] text-muted hover:bg-soft hover:text-ink"
                  >
                    Abmelden
                  </button>
                  <div className="mt-1 border-t border-black/[0.06] px-4 py-2">
                    <LegalLinks className="text-[11px]" />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Razor-thin progress bar integrated into the bottom hairline of the sticky header */}
          <div
            role={isHome && progress && progress.total > 0 ? 'progressbar' : undefined}
            aria-valuenow={progress?.done}
            aria-valuemin={0}
            aria-valuemax={progress?.total}
            aria-label={progress ? `${progress.done} von ${progress.total} Fragen beantwortet` : undefined}
            className="h-[2px] w-full bg-black/[0.07]"
          >
            {isHome && progress && progress.total > 0 && (
              <div
                className={`h-full transition-[width,background-color] duration-500 ease-out ${
                  pct === 100 ? 'bg-ok' : 'bg-ink'
                }`}
                style={{ width: `${pct}%` }}
              />
            )}
          </div>
        </header>

        <main
          id="inhalt"
          className={
            isHome
              ? 'w-full flex-1 pb-[max(4rem,env(safe-area-inset-bottom))] pt-5'
              : 'mx-auto w-full max-w-xl flex-1 px-5 pb-[max(4rem,env(safe-area-inset-bottom))] pt-6'
          }
        >
          {localStorage.getItem(offerKey) && (
            <div className={isHome ? 'mx-auto max-w-xl px-5' : ''}>
              <PasskeyOffer />
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </HeaderProgressContext.Provider>
  );
}
