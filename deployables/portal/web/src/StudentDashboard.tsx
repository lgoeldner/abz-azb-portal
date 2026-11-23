import { Check, ChevronDown, ChevronRight, Clock, Plus, RotateCw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Category, Submission } from './api';
import { BallotForm } from './BallotForm';
import {
  Failure,
  isBallot,
  isSubmissionCollection,
  KindIcon,
  kindIcon,
  kindLabel,
  Loading,
  newestOpened,
  plural,
  useData,
  useSession,
} from './ui';

const hasVoted = (c: Category) => Boolean(c.my_words?.length || c.my_option_ids?.length || c.my_option_id);

function savedSelection(poll: Category): string[] {
  if (poll.kind === 'words') return poll.my_words ?? [];
  return poll.my_option_ids?.length ? poll.my_option_ids : poll.my_option_id ? [poll.my_option_id] : [];
}

function savedAnswerSummary(poll: Category): string {
  if (poll.kind === 'words') {
    const words = poll.my_words ?? [];
    return words.length ? words.join(', ') : 'Nicht abgestimmt';
  }
  const ids = savedSelection(poll);
  if (!ids.length) return 'Nicht abgestimmt';
  return ids
    .map((id) => poll.options.find((o) => o.id === id)?.label)
    .filter(Boolean)
    .join(', ');
}

function shortDeadline(closesAt: string | null): string | null {
  if (!closesAt) return null;
  const diffMs = new Date(closesAt).getTime() - Date.now();
  if (diffMs <= 0) return 'Beendet';
  const hours = Math.ceil(diffMs / 3_600_000);
  if (hours < 24) return `noch ${hours} Std.`;
  const days = Math.ceil(diffMs / 86_400_000);
  return days === 1 ? 'noch 1 Tag' : `noch ${days} Tage`;
}

export function StudentDashboard() {
  const { user } = useSession();
  const categories = useData<Category[]>('/categories');
  const submissions = useData<Submission[]>('/submissions');

  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const carouselRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);

  const allCategories = useMemo(() => categories.data ?? [], [categories.data]);
  const ownSubmissions = useMemo(
    () => (submissions.data ?? []).filter((s) => s.author_id === user.id && s.status !== 'withdrawn'),
    [submissions.data, user.id],
  );

  // Set-and-forget one-off polls: live in the swipe carousel while unanswered, move to Abgegeben once answered.
  const oneOffPolls = useMemo(() => allCategories.filter((c) => isBallot(c.kind) && !c.repeatable), [allCategories]);
  const openOneOffPolls = useMemo(() => oneOffPolls.filter((c) => c.status === 'open'), [oneOffPolls]);
  const unansweredPolls = useMemo(
    () => openOneOffPolls.filter((c) => !hasVoted(c)).sort(newestOpened),
    [openOneOffPolls],
  );
  const answeredOpenPolls = useMemo(
    () => openOneOffPolls.filter((c) => hasVoted(c)).sort(newestOpened),
    [openOneOffPolls],
  );
  const closedPolls = useMemo(() => oneOffPolls.filter((c) => c.status === 'closed').sort(newestOpened), [oneOffPolls]);

  // Accumulating / ongoing inputs: quotes, photos, memories, ideas, and any repeatable polls (Steckbrief lives in Account menu).
  const accumulatingCollections = useMemo(
    () =>
      allCategories.filter(
        (c) =>
          c.status === 'open' &&
          ((isSubmissionCollection(c.kind) && c.kind !== 'steckbrief') || (isBallot(c.kind) && c.repeatable)),
      ),
    [allCategories],
  );

  const totalOpenPolls = openOneOffPolls.length;
  const answeredOpenCount = answeredOpenPolls.length;
  const progressPct = totalOpenPolls > 0 ? Math.round((answeredOpenCount / totalOpenPolls) * 100) : 100;
  const submittedDrawerCount = answeredOpenPolls.length + closedPolls.length;

  const clampedIndex = unansweredPolls.length ? Math.min(activeIndex, unansweredPolls.length - 1) : 0;

  // Track active slide on scroll
  useEffect(() => {
    const el = carouselRef.current;
    if (!el || unansweredPolls.length === 0) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const center = el.scrollLeft + el.clientWidth / 2;
        let bestIdx = 0;
        let bestDist = Infinity;
        slideRefs.current.forEach((slide, idx) => {
          if (!slide || idx >= unansweredPolls.length) return;
          const slideCenter = slide.offsetLeft + slide.offsetWidth / 2;
          const dist = Math.abs(slideCenter - center);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = idx;
          }
        });
        setActiveIndex(bestIdx);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', onScroll);
    };
  }, [unansweredPolls.length]);

  const scrollToSlide = (idx: number) => {
    const count = unansweredPolls.length;
    if (count === 0) return;
    const wrapped = ((idx % count) + count) % count;
    const target = slideRefs.current[wrapped];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
    setActiveIndex(wrapped);
  };

  if (categories.isPending) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <Loading />
      </div>
    );
  }
  if (categories.error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <Failure error={categories.error} retry={() => categories.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* 1. Progress bar + Active Poll Carousel */}
      <section aria-label="Offene Fragen">
        {totalOpenPolls > 0 && (
          <div className="mx-auto mb-4 max-w-2xl px-4 sm:px-6">
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="font-semibold text-ink">
                {unansweredPolls.length === 0 ? 'Alles beantwortet' : 'Offene Fragen'}
              </span>
              <span className="tabular-nums text-muted">
                {answeredOpenCount} von {totalOpenPolls}
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={answeredOpenCount}
              aria-valuemin={0}
              aria-valuemax={totalOpenPolls}
              aria-label="Fortschritt bei offenen Fragen"
              className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/[0.07]"
            >
              <div
                className={`h-full rounded-full transition-[width,background-color] duration-500 ease-out ${
                  progressPct === 100 ? 'bg-ok' : 'bg-ink'
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {unansweredPolls.length > 0 ? (
          <>
            <div ref={carouselRef} className="student-carousel" role="region" aria-label="Fragen-Karussell">
              {unansweredPolls.map((poll, index) => {
                const isActive = index === clampedIndex;
                const deadline = shortDeadline(poll.closes_at);
                const choices = drafts[poll.id] ?? savedSelection(poll);
                return (
                  <div
                    key={poll.id}
                    ref={(node) => {
                      slideRefs.current[index] = node;
                    }}
                    data-active={isActive}
                    onClick={!isActive ? () => scrollToSlide(index) : undefined}
                    className="student-carousel-slide"
                  >
                    <article className="student-card flex h-full flex-col p-5 sm:p-6">
                      <div className="flex items-center justify-between gap-2 text-[12px] font-medium text-muted">
                        <span className="inline-flex items-center gap-1.5">
                          <KindIcon icon={kindIcon[poll.kind]} className="size-3.5" />
                          <span>{kindLabel[poll.kind]}</span>
                        </span>
                        {deadline && (
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <Clock aria-hidden="true" className="size-3" />
                            {deadline}
                          </span>
                        )}
                      </div>

                      <h1 className="mt-2.5 text-[21px] font-extrabold leading-snug tracking-[-0.025em] text-ink sm:text-[23px]">
                        {poll.name}
                      </h1>
                      {poll.description && <p className="mt-1 text-[14px] text-muted">{poll.description}</p>}

                      <div className="mt-5 flex-1">
                        <BallotForm
                          poll={poll}
                          choices={choices}
                          onChoicesChange={(next) => setDrafts((prev) => ({ ...prev, [poll.id]: next }))}
                          onSaved={() => {
                            setDrafts((prev) => {
                              const next = { ...prev };
                              delete next[poll.id];
                              return next;
                            });
                            void categories.refetch();
                          }}
                        />
                      </div>
                    </article>
                  </div>
                );
              })}
            </div>

            {/* Minimal pagination dots + wrap-around loop cue */}
            {unansweredPolls.length > 1 && (
              <div className="mx-auto mt-2 flex max-w-2xl items-center justify-center gap-2 px-4">
                <div className="flex items-center gap-1.5" role="tablist" aria-label="Fragen auswählen">
                  {unansweredPolls.map((poll, idx) => {
                    const active = idx === clampedIndex;
                    return (
                      <button
                        key={poll.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        aria-label={`Frage ${idx + 1}: ${poll.name}`}
                        onClick={() => scrollToSlide(idx)}
                        className={`h-1.5 rounded-full transition-all duration-200 ${
                          active ? 'w-6 bg-ink' : 'w-1.5 bg-black/20 hover:bg-black/40'
                        }`}
                      />
                    );
                  })}
                </div>
                {clampedIndex === unansweredPolls.length - 1 && (
                  <button
                    type="button"
                    onClick={() => scrollToSlide(0)}
                    aria-label="Zurück zur ersten Frage"
                    className="ml-2 inline-flex items-center gap-1 rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-semibold text-muted transition-colors hover:bg-black/[0.09] hover:text-ink"
                  >
                    <RotateCw aria-hidden="true" className="size-3" />
                    <span>Anfang</span>
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="mx-auto max-w-2xl px-4 sm:px-6">
            <div className="student-card flex items-center gap-4 p-5 sm:p-6">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ok-tint text-ok">
                <Check aria-hidden="true" className="size-5" strokeWidth={2.5} />
              </span>
              <div className="min-w-0">
                <p className="text-[16px] font-bold text-ink">Alle offenen Fragen erledigt</p>
                <p className="text-[13px] text-muted">
                  {answeredOpenPolls.length > 0
                    ? 'Tippe unten auf „Abgegeben“, um Antworten vor Fristende zu ändern.'
                    : 'Sobald neue Fragen freigeschaltet werden, erscheinen sie hier.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 2. "Abgegeben [N]" pill bar directly beneath the carousel */}
        <div className="mx-auto mt-4 max-w-2xl px-4 sm:px-6">
          <button
            type="button"
            disabled={submittedDrawerCount === 0}
            onClick={() => setSheetOpen(true)}
            className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-2xl border border-black/[0.08] bg-white px-4 py-3 text-left shadow-2xs transition-colors hover:bg-soft/60 active:scale-[0.99] disabled:opacity-50"
          >
            <span className="flex items-center gap-2.5 text-[15px] font-semibold text-ink">
              <Check aria-hidden="true" className="size-4 text-ok" strokeWidth={2.5} />
              <span>Abgegeben</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="grid min-w-7 place-items-center rounded-full bg-ink px-2 py-0.5 text-[12px] font-bold tabular-nums text-white">
                {submittedDrawerCount}
              </span>
              <ChevronRight aria-hidden="true" className="size-4 text-muted" />
            </span>
          </button>
        </div>
      </section>

      {/* 3. Accumulating / Ongoing Contributions — distinct minimalist tile grid */}
      {accumulatingCollections.length > 0 && (
        <section aria-labelledby="student-sammeln" className="mx-auto max-w-2xl px-4 sm:px-6">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 id="student-sammeln" className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">
              Jederzeit ergänzen
            </h2>
            <span className="text-[12px] text-muted">Wenn Momente passieren</span>
          </div>

          <ul className="grid grid-cols-2 gap-3">
            {accumulatingCollections.map((collection) => {
              const matching = ownSubmissions.filter((s) => s.category_id === collection.id);
              const photoCount =
                collection.kind === 'photo'
                  ? matching.reduce((sum, s) => sum + s.attachments.length, 0)
                  : matching.length;
              const countLabel =
                collection.kind === 'photo'
                  ? photoCount === 0
                    ? 'Noch keine Fotos'
                    : plural(photoCount, 'Foto', 'Fotos')
                  : isBallot(collection.kind)
                    ? 'Mehrfach möglich'
                    : photoCount === 0
                      ? 'Noch leer'
                      : plural(photoCount, 'Eintrag', 'Einträge');

              return (
                <li key={collection.id} className="min-w-0">
                  <Link
                    to={`/sammlungen/${collection.id}`}
                    className="group flex h-full min-h-[112px] flex-col justify-between rounded-2xl border border-black/[0.08] bg-white p-4 transition-all hover:border-black/20 hover:shadow-xs active:scale-[0.98]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="grid size-9 place-items-center rounded-xl bg-soft text-ink transition-colors group-hover:bg-ink group-hover:text-white">
                        <KindIcon icon={kindIcon[collection.kind]} className="size-[18px]" />
                      </span>
                      <span
                        aria-hidden="true"
                        className="grid size-7 place-items-center rounded-full text-muted transition-colors group-hover:bg-soft group-hover:text-ink"
                      >
                        <Plus className="size-4" />
                      </span>
                    </div>
                    <div className="mt-4">
                      <span className="block truncate text-[15px] font-bold text-ink">{collection.name}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-muted">{countLabel}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Bottom Sheet for Answered & Expired Polls */}
      {sheetOpen && (
        <SubmittedPollsSheet
          editable={answeredOpenPolls}
          closed={closedPolls}
          onClose={() => setSheetOpen(false)}
          onUpdated={() => void categories.refetch()}
        />
      )}
    </div>
  );
}

function SubmittedPollsSheet({
  editable,
  closed,
  onClose,
  onUpdated,
}: {
  editable: Category[];
  closed: Category[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const toggleExpand = (poll: Category) => {
    setExpandedId((prev) => (prev === poll.id ? null : poll.id));
    setDrafts((prev) => (prev[poll.id] ? prev : { ...prev, [poll.id]: savedSelection(poll) }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="student-backdrop fixed inset-0 bg-black/35 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="abgegeben-sheet-title"
        className="student-sheet relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[26px] bg-white shadow-2xl sm:rounded-[26px]"
      >
        <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-black/15" />
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-black/[0.06] px-5 py-4">
          <h2 id="abgegeben-sheet-title" className="text-[18px] font-extrabold tracking-tight text-ink">
            Abgegeben
          </h2>
          <button
            type="button"
            aria-label="Schließen"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-full bg-soft text-muted transition-colors hover:text-ink"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {editable.length > 0 && (
            <section aria-labelledby="sheet-editable">
              <p id="sheet-editable" className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-muted">
                Noch änderbar ({editable.length})
              </p>
              <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.07] bg-paper/60">
                {editable.map((poll) => {
                  const open = expandedId === poll.id;
                  const deadline = shortDeadline(poll.closes_at);
                  return (
                    <li key={poll.id}>
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => toggleExpand(poll)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-black/[0.03]"
                      >
                        <div className="min-w-0">
                          <span className="block truncate text-[14px] font-bold text-ink">{poll.name}</span>
                          <span className="mt-0.5 block truncate text-[13px] text-ok">{savedAnswerSummary(poll)}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 text-[12px] text-muted">
                          {deadline && <span className="tabular-nums">{deadline}</span>}
                          <ChevronDown
                            aria-hidden="true"
                            className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`}
                          />
                        </div>
                      </button>
                      {open && (
                        <div className="border-t border-black/[0.06] bg-white px-4 py-4">
                          <BallotForm
                            poll={poll}
                            choices={drafts[poll.id] ?? savedSelection(poll)}
                            onChoicesChange={(next) => setDrafts((prev) => ({ ...prev, [poll.id]: next }))}
                            onSaved={() => {
                              setExpandedId(null);
                              onUpdated();
                            }}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {closed.length > 0 && (
            <section aria-labelledby="sheet-closed">
              <p id="sheet-closed" className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-muted">
                Beendet ({closed.length})
              </p>
              <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.07] bg-paper/40">
                {closed.map((poll) => (
                  <li key={poll.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
                    <div className="min-w-0">
                      <span className="block truncate text-[14px] font-semibold text-ink/80">{poll.name}</span>
                      <span className="mt-0.5 block truncate text-[13px] text-muted">{savedAnswerSummary(poll)}</span>
                    </div>
                    <span className="shrink-0 rounded-full bg-black/[0.06] px-2.5 py-0.5 text-[11px] font-semibold text-muted">
                      Beendet
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
