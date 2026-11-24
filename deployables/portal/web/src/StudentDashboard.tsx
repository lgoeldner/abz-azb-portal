import { Check, ChevronDown, Plus, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, json, type Category, type Submission } from './api';
import { useSetHeaderProgress } from './StudentShell';
import {
  Failure,
  isBallot,
  isSubmissionCollection,
  KindIcon,
  kindIcon,
  Loading,
  newestOpened,
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
    return words.length ? words.join(', ') : '—';
  }
  const ids = savedSelection(poll);
  if (!ids.length) return '—';
  return ids
    .map((id) => poll.options.find((o) => o.id === id)?.label)
    .filter(Boolean)
    .join(', ');
}

function shortDeadline(closesAt: string | null): string | null {
  if (!closesAt) return null;
  const diffMs = new Date(closesAt).getTime() - Date.now();
  if (diffMs <= 0) return null;
  const hours = Math.ceil(diffMs / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.ceil(diffMs / 86_400_000)}T`;
}

function normalizeWord(value: string) {
  return value.trim().toLowerCase().normalize('NFC');
}

export function StudentDashboard() {
  const { user } = useSession();
  const categories = useData<Category[]>('/categories');
  const submissions = useData<Submission[]>('/submissions');
  const setHeaderProgress = useSetHeaderProgress();

  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [droppingId, setDroppingId] = useState<string | null>(null);
  const [badgePulse, setBadgePulse] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);

  const carouselRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const jumpingRef = useRef(false);

  const allCategories = useMemo(() => categories.data ?? [], [categories.data]);
  const ownSubmissions = useMemo(
    () => (submissions.data ?? []).filter((s) => s.author_id === user.id && s.status !== 'withdrawn'),
    [submissions.data, user.id],
  );

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

  const accumulatingCollections = useMemo(
    () =>
      allCategories.filter(
        (c) =>
          c.status === 'open' &&
          ((isSubmissionCollection(c.kind) && c.kind !== 'steckbrief') || (isBallot(c.kind) && c.repeatable)),
      ),
    [allCategories],
  );

  // Sync razor-thin sticky header progress bar
  useEffect(() => {
    setHeaderProgress({ done: answeredOpenPolls.length, total: openOneOffPolls.length });
    return () => setHeaderProgress(null);
  }, [answeredOpenPolls.length, openOneOffPolls.length, setHeaderProgress]);

  const count = unansweredPolls.length;
  const looping = count > 1;
  // Clone last slide at index 0 and first slide at index count+1 for true seamless looping
  const slides = useMemo(() => {
    if (!looping) return unansweredPolls.map((poll, realIndex) => ({ key: poll.id, poll, realIndex, clone: false }));
    return [
      {
        key: `clone-prev-${unansweredPolls[count - 1].id}`,
        poll: unansweredPolls[count - 1],
        realIndex: count - 1,
        clone: true,
      },
      ...unansweredPolls.map((poll, realIndex) => ({ key: poll.id, poll, realIndex, clone: false })),
      { key: `clone-next-${unansweredPolls[0].id}`, poll: unansweredPolls[0], realIndex: 0, clone: true },
    ];
  }, [unansweredPolls, looping, count]);

  const clampedIndex = count > 0 ? Math.min(activeIndex, count - 1) : 0;

  const centerSlide = useCallback((slidePos: number, behavior: ScrollBehavior) => {
    const el = carouselRef.current;
    const target = slideRefs.current[slidePos];
    if (!el || !target) return;
    const left = target.offsetLeft - (el.clientWidth - target.offsetWidth) / 2;
    el.scrollTo({ left, behavior });
  }, []);

  // Position carousel on the real active slide whenever item count changes
  useLayoutEffect(() => {
    if (!looping) return;
    jumpingRef.current = true;
    centerSlide(clampedIndex + 1, 'auto');
    const t = window.setTimeout(() => {
      jumpingRef.current = false;
    }, 60);
    return () => window.clearTimeout(t);
  }, [count, looping]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track active slide and silently wrap when landing on boundary clones
  useEffect(() => {
    const el = carouselRef.current;
    if (!el || count === 0) return;
    let raf = 0;
    let settleTimer = 0;

    const closestSlidePos = () => {
      const center = el.scrollLeft + el.clientWidth / 2;
      let bestPos = looping ? 1 : 0;
      let bestDist = Infinity;
      for (let i = 0; i < slides.length; i += 1) {
        const node = slideRefs.current[i];
        if (!node) continue;
        const dist = Math.abs(node.offsetLeft + node.offsetWidth / 2 - center);
        if (dist < bestDist) {
          bestDist = dist;
          bestPos = i;
        }
      }
      return bestPos;
    };

    const onScroll = () => {
      if (jumpingRef.current) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const pos = closestSlidePos();
        const entry = slides[pos];
        if (entry) setActiveIndex(entry.realIndex);
      });
      if (looping) {
        window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => {
          const pos = closestSlidePos();
          if (pos === 0) {
            jumpingRef.current = true;
            centerSlide(count, 'auto');
            setActiveIndex(count - 1);
            requestAnimationFrame(() => {
              jumpingRef.current = false;
            });
          } else if (pos === count + 1) {
            jumpingRef.current = true;
            centerSlide(1, 'auto');
            setActiveIndex(0);
            requestAnimationFrame(() => {
              jumpingRef.current = false;
            });
          }
        }, 120);
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settleTimer);
      el.removeEventListener('scroll', onScroll);
    };
  }, [slides, looping, count, centerSlide]);

  const goToRealIndex = (realIdx: number) => {
    if (count === 0) return;
    setActiveIndex(realIdx);
    centerSlide(looping ? realIdx + 1 : realIdx, 'smooth');
  };

  const handleCardSubmitted = (pollId: string) => {
    setDroppingId(pollId);
    setBadgePulse((n) => n + 1);
    window.setTimeout(() => {
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[pollId];
        return next;
      });
      setDroppingId(null);
      void categories.refetch();
    }, 310);
  };

  const submittedCount = answeredOpenPolls.length + closedPolls.length;

  if (categories.isPending) {
    return (
      <div className="mx-auto max-w-xl px-5 py-12">
        <Loading />
      </div>
    );
  }
  if (categories.error) {
    return (
      <div className="mx-auto max-w-xl px-5 py-8">
        <Failure error={categories.error} retry={() => categories.refetch()} />
      </div>
    );
  }

  return (
    <div>
      {/* 1. Infinite Horizontal Carousel of Unanswered Polls */}
      <section aria-label="Offene Fragen">
        {count > 0 ? (
          <>
            <div ref={carouselRef} className="student-carousel" role="region" aria-label="Fragen-Karussell">
              {slides.map((slide, pos) => {
                const isActive = !slide.clone && slide.realIndex === clampedIndex;
                const deadline = shortDeadline(slide.poll.closes_at);
                const choices = drafts[slide.poll.id] ?? savedSelection(slide.poll);
                const dropping = !slide.clone && droppingId === slide.poll.id;

                return (
                  <div
                    key={slide.key}
                    ref={(node) => {
                      slideRefs.current[pos] = node;
                    }}
                    data-active={isActive}
                    data-dropping={dropping}
                    aria-hidden={slide.clone || undefined}
                    onClick={!isActive ? () => centerSlide(pos, 'smooth') : undefined}
                    className="student-carousel-slide"
                  >
                    <article className="student-card flex h-full flex-col p-5">
                      <div className="flex items-baseline justify-between gap-3">
                        <h1 className="text-[19px] font-bold leading-snug tracking-[-0.02em] text-ink">
                          {slide.poll.name}
                        </h1>
                        {deadline && (
                          <span className="shrink-0 text-[12px] font-medium tabular-nums text-muted">{deadline}</span>
                        )}
                      </div>

                      <div className="mt-4 flex-1">
                        <MinimalPollInput
                          poll={slide.poll}
                          choices={choices}
                          disabled={slide.clone || dropping}
                          onChoicesChange={(next) => setDrafts((prev) => ({ ...prev, [slide.poll.id]: next }))}
                          onSaved={() => handleCardSubmitted(slide.poll.id)}
                        />
                      </div>
                    </article>
                  </div>
                );
              })}
            </div>

            {count > 1 && (
              <div className="mt-3 flex items-center justify-center gap-1.5" role="tablist" aria-label="Fragen">
                {unansweredPolls.map((poll, idx) => {
                  const active = idx === clampedIndex;
                  return (
                    <button
                      key={poll.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-label={`Frage ${idx + 1}: ${poll.name}`}
                      onClick={() => goToRealIndex(idx)}
                      className={`h-[5px] rounded-full transition-all duration-200 ${
                        active ? 'w-5 bg-ink' : 'w-[5px] bg-black/20 hover:bg-black/40'
                      }`}
                    />
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div className="mx-auto max-w-xl px-5 py-8 text-center">
            <p className="text-[15px] font-semibold text-ink">Alles beantwortet</p>
            <p className="mt-0.5 text-[13px] text-muted">Keine offenen Fragen mehr.</p>
          </div>
        )}
      </section>

      {/* 2. "Abgegeben" — bare text between two faint lines, NO box */}
      <div className="mx-auto mt-6 max-w-xl px-5">
        <button
          type="button"
          disabled={submittedCount === 0}
          onClick={() => setSheetOpen(true)}
          className="flex min-h-13 w-full items-center justify-between border-y border-black/[0.09] py-3 text-left transition-colors hover:bg-soft/60 active:opacity-70 disabled:opacity-40"
        >
          <span className="text-[15px] font-medium text-ink">Abgegeben</span>
          <span
            key={badgePulse}
            className={`grid size-6 place-items-center rounded-full bg-ink text-[12px] font-bold tabular-nums text-white ${
              badgePulse > 0 ? 'student-badge-catch' : ''
            }`}
          >
            {submittedCount}
          </span>
        </button>
      </div>

      {/* 3. Accumulating / Ongoing inputs — bare hairline-divided list rows, NO boxes */}
      {accumulatingCollections.length > 0 && (
        <section aria-labelledby="student-sammeln" className="mx-auto mt-7 max-w-xl px-5">
          <h2 id="student-sammeln" className="mb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">
            Sammeln
          </h2>
          <ul className="divide-y divide-black/[0.08]">
            {accumulatingCollections.map((collection) => {
              const matching = ownSubmissions.filter((s) => s.category_id === collection.id);
              const entryCount =
                collection.kind === 'photo'
                  ? matching.reduce((sum, s) => sum + s.attachments.length, 0)
                  : matching.length;
              return (
                <li key={collection.id}>
                  <Link
                    to={`/sammlungen/${collection.id}`}
                    className="flex min-h-13 items-center justify-between gap-3 py-3 text-ink transition-opacity active:opacity-60"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <KindIcon icon={kindIcon[collection.kind]} className="size-[17px] text-muted" />
                      <span className="truncate text-[15px] font-medium">{collection.name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2.5 text-[13px] tabular-nums text-muted">
                      {entryCount > 0 && <span>{entryCount}</span>}
                      <Plus aria-hidden="true" className="size-4 text-ink/50" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

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

/** Razor-minimal poll control: zero verbose instructions, zero toast notifications, zero nested boxes. */
function MinimalPollInput({
  poll,
  choices,
  onChoicesChange,
  onSaved,
  disabled = false,
  submitLabel = 'Abgeben',
}: {
  poll: Category;
  choices: string[];
  onChoicesChange: (next: string[]) => void;
  onSaved: () => void;
  disabled?: boolean;
  submitLabel?: string;
}) {
  const { user } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [wordDraft, setWordDraft] = useState('');
  const [search, setSearch] = useState('');

  const eligible = user.admitted && user.cohort_member;
  const readOnly = disabled || busy || poll.status !== 'open' || !eligible;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (readOnly) return;

    let finalWords = choices;
    if (poll.kind === 'words' && wordDraft.trim()) {
      const added = addWordCandidate(wordDraft, choices, poll.max_choices);
      if (added.error) {
        setError(added.error);
        return;
      }
      finalWords = added.next;
      onChoicesChange(finalWords);
      setWordDraft('');
    }

    if (!finalWords.length) return;
    setBusy(true);
    setError('');
    try {
      if (poll.kind === 'words') {
        await api(`/categories/${poll.id}/ballot`, json('PUT', { words: finalWords }));
      } else {
        await api(`/categories/${poll.id}/ballot`, json('PUT', { option_ids: finalWords }));
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  if (poll.kind === 'words') {
    const pushDraft = () => {
      if (!wordDraft.trim()) return;
      const res = addWordCandidate(wordDraft, choices, poll.max_choices);
      onChoicesChange(res.next);
      setError(res.error);
      if (!res.error) setWordDraft('');
    };

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        pushDraft();
      }
    };

    return (
      <form onSubmit={submit} className="flex h-full flex-col justify-between gap-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2 border-b border-black/15 pb-2 focus-within:border-ink">
            <input
              type="text"
              value={wordDraft}
              disabled={readOnly || choices.length >= poll.max_choices}
              maxLength={64}
              placeholder={choices.length >= poll.max_choices ? 'Limit erreicht' : 'Wort eingeben …'}
              aria-label="Wort eingeben"
              onChange={(e) => {
                setWordDraft(e.target.value);
                setError('');
              }}
              onKeyDown={onKeyDown}
              className="min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-muted/70 focus:outline-none"
            />
            <span className="text-[12px] tabular-nums text-muted">
              {choices.length}/{poll.max_choices}
            </span>
            {wordDraft.trim() && (
              <button
                type="button"
                onClick={pushDraft}
                aria-label="Wort hinzufügen"
                className="grid size-7 place-items-center rounded-full bg-ink text-white"
              >
                <Plus aria-hidden="true" className="size-3.5" />
              </button>
            )}
          </div>

          {choices.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Ausgewählte Wörter">
              {choices.map((word) => (
                <li
                  key={word}
                  className="inline-flex items-center gap-1 rounded-full bg-soft px-3 py-1 text-[13px] font-medium text-ink"
                >
                  <span>{word}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      aria-label={`${word} entfernen`}
                      onClick={() => onChoicesChange(choices.filter((w) => w !== word))}
                      className="ml-0.5 text-muted hover:text-ink"
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p className="text-[12px] text-accent" role="alert">
              {error}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={readOnly || (choices.length === 0 && !wordDraft.trim())}
          className="min-h-11 w-full rounded-full bg-ink text-[14px] font-semibold text-white transition-opacity disabled:opacity-25"
        >
          {submitLabel}
        </button>
      </form>
    );
  }

  // Proposal or Person poll — clean hairline-divided options
  const visibleOptions = poll.options
    .filter((o) => poll.allow_self_vote || o.user_id !== user.id)
    .filter((o) => !search.trim() || o.label.toLocaleLowerCase('de').includes(search.trim().toLocaleLowerCase('de')));

  const selected = new Set(choices);
  const toggleOption = (id: string) => {
    if (readOnly) return;
    if (selected.has(id)) {
      onChoicesChange(choices.filter((x) => x !== id));
    } else if (poll.max_choices === 1) {
      onChoicesChange([id]);
    } else if (choices.length < poll.max_choices) {
      onChoicesChange([...choices, id]);
    }
  };

  return (
    <form onSubmit={submit} className="flex h-full flex-col justify-between gap-4">
      <div className="space-y-2">
        {poll.options.length >= 10 && (
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suchen …"
            aria-label="Option suchen"
            className="w-full border-b border-black/15 bg-transparent pb-1.5 text-[14px] placeholder:text-muted/70 focus:border-ink focus:outline-none"
          />
        )}

        <ul className="max-h-56 divide-y divide-black/[0.06] overflow-y-auto" role="group" aria-label={poll.name}>
          {visibleOptions.map((option) => {
            const isSelected = selected.has(option.id);
            const blocked = !isSelected && poll.max_choices > 1 && choices.length >= poll.max_choices;
            return (
              <li key={option.id}>
                <button
                  type="button"
                  disabled={readOnly || blocked}
                  aria-pressed={isSelected}
                  onClick={() => toggleOption(option.id)}
                  className={`flex min-h-11 w-full items-center justify-between gap-3 py-2.5 text-left text-[15px] transition-colors ${
                    isSelected ? 'font-semibold text-ink' : 'text-ink/80 hover:text-ink'
                  } disabled:opacity-35`}
                >
                  <span className="min-w-0 break-words">{option.label}</span>
                  <span
                    aria-hidden="true"
                    className={`grid size-5 shrink-0 place-items-center rounded-full border transition-colors ${
                      isSelected ? 'border-ink bg-ink text-white' : 'border-black/20'
                    }`}
                  >
                    {isSelected && <Check className="size-3" strokeWidth={3} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {poll.max_choices > 1 && (
          <p className="text-[12px] tabular-nums text-muted">
            {choices.length}/{poll.max_choices}
          </p>
        )}

        {error && (
          <p className="text-[12px] text-accent" role="alert">
            {error}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={readOnly || choices.length === 0}
        className="min-h-11 w-full rounded-full bg-ink text-[14px] font-semibold text-white transition-opacity disabled:opacity-25"
      >
        {submitLabel}
      </button>
    </form>
  );
}

function addWordCandidate(raw: string, existing: string[], max: number): { next: string[]; error: string } {
  const candidates = raw.split(',').map(normalizeWord).filter(Boolean);
  const next = [...existing];
  let error = '';
  for (const w of candidates) {
    if (/\s/u.test(w)) {
      error ||= 'Nur einzelne Wörter.';
      continue;
    }
    if (next.includes(w)) continue;
    if (next.length >= max) {
      error ||= `Maximal ${max}.`;
      continue;
    }
    next.push(w);
  }
  return { next, error };
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
    const onKeyDown = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
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
        className="student-backdrop fixed inset-0 bg-black/30 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="abgegeben-sheet-title"
        className="student-sheet relative z-10 flex max-h-[84vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[24px] bg-white shadow-2xl sm:rounded-[24px]"
      >
        <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden="true">
          <span className="h-1 w-9 rounded-full bg-black/15" />
        </div>

        <div className="flex items-center justify-between px-5 py-3.5">
          <h2 id="abgegeben-sheet-title" className="text-[17px] font-bold tracking-tight text-ink">
            Abgegeben
          </h2>
          <button
            type="button"
            aria-label="Schließen"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-full text-muted hover:bg-soft hover:text-ink"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {editable.length > 0 && (
            <section aria-labelledby="sheet-editable">
              <p id="sheet-editable" className="mb-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted">
                Noch änderbar
              </p>
              <ul className="divide-y divide-black/[0.08] border-y border-black/[0.08]">
                {editable.map((poll) => {
                  const open = expandedId === poll.id;
                  const deadline = shortDeadline(poll.closes_at);
                  return (
                    <li key={poll.id}>
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => toggleExpand(poll)}
                        className="flex w-full items-center justify-between gap-3 py-3 text-left"
                      >
                        <div className="min-w-0">
                          <span className="block truncate text-[14px] font-semibold text-ink">{poll.name}</span>
                          <span className="mt-0.5 block truncate text-[13px] text-muted">
                            {savedAnswerSummary(poll)}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 text-[12px] tabular-nums text-muted">
                          {deadline && <span>{deadline}</span>}
                          <ChevronDown
                            aria-hidden="true"
                            className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`}
                          />
                        </div>
                      </button>
                      {open && (
                        <div className="pb-4 pt-1">
                          <MinimalPollInput
                            poll={poll}
                            choices={drafts[poll.id] ?? savedSelection(poll)}
                            submitLabel="Ändern"
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
              <p id="sheet-closed" className="mb-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted">
                Beendet
              </p>
              <ul className="divide-y divide-black/[0.08] border-y border-black/[0.08]">
                {closed.map((poll) => (
                  <li key={poll.id} className="py-3 opacity-60">
                    <span className="block truncate text-[14px] font-medium text-ink">{poll.name}</span>
                    <span className="mt-0.5 block truncate text-[13px] text-muted">{savedAnswerSummary(poll)}</span>
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
