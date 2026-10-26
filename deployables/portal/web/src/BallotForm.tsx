import { useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Category } from './api';
import { api, json } from './api';
import { PeoplePicker } from './PeoplePicker';
import { Arrow, btn, notice, useAction, useSession } from './ui';

const pendingBallots = new Map<string, { id: string; selectionKey: string }>();

function ballotKey(userId: string, pollId: string) {
  return JSON.stringify([userId, pollId]);
}

function pendingBallotId(userId: string, pollId: string, selectionKey: string) {
  const key = ballotKey(userId, pollId);
  const pending = pendingBallots.get(key);
  const id = pending?.selectionKey === selectionKey ? pending.id : crypto.randomUUID();
  pendingBallots.set(key, { id, selectionKey });
  return id;
}

function clearPendingBallot(userId: string, pollId: string, id: string) {
  const key = ballotKey(userId, pollId);
  if (pendingBallots.get(key)?.id === id) pendingBallots.delete(key);
}

export function BallotPrivacyNotice({ repeatable = false }: { repeatable?: boolean }) {
  return (
    <p className="text-sm text-muted">
      {repeatable
        ? 'Namentliche Abstimmung: Die Administration kann jede Abgabe zuordnen. Jede erneute Abgabe wird als eigene Stimme geführt. Ergebnisse sind für Schüler:innen nicht sichtbar.'
        : 'Namentliche Abstimmung: Die Administration kann deine Stimme und Änderungen zuordnen. Während der Öffnung kannst du deine Auswahl ändern. Ergebnisse sind für Schüler:innen nicht sichtbar.'}
    </p>
  );
}

export function BallotForm({
  poll,
  choices,
  onChoicesChange,
  onSaved,
  onBusyChange,
  disabled = false,
}: {
  poll: Category;
  choices: string[];
  onChoicesChange: (ids: string[]) => void;
  onSaved?: () => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const { user } = useSession();
  const action = useAction();
  const [submitted, setSubmitted] = useState(false);
  const savedChoices = poll.my_option_ids?.length ? poll.my_option_ids : poll.my_option_id ? [poll.my_option_id] : [];
  const eligible = user.admitted && user.cohort_member;
  const hasSelfVote =
    poll.kind === 'person' &&
    !poll.allow_self_vote &&
    choices.some((choice) => poll.options.some((option) => option.id === choice && option.user_id === user.id));
  const validChoices =
    poll.status === 'open' &&
    eligible &&
    choices.length > 0 &&
    choices.length <= poll.max_choices &&
    new Set(choices).size === choices.length &&
    choices.every((choice) => poll.options.some((option) => option.id === choice)) &&
    !hasSelfVote;
  const canSubmit = validChoices && !action.busy && !disabled;

  if (poll.kind === 'words') {
    return (
      <WordsBallotForm
        poll={poll}
        words={choices}
        onWordsChange={onChoicesChange}
        onSaved={onSaved}
        onBusyChange={onBusyChange}
        disabled={disabled}
      />
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const submittedChoices = poll.repeatable ? [...choices].sort() : choices;
    const ballotId = poll.repeatable ? pendingBallotId(user.id, poll.id, JSON.stringify(submittedChoices)) : undefined;
    onBusyChange?.(true);
    let saved = false;
    void action
      .run(async () => {
        await api(
          `/categories/${poll.id}/ballot`,
          json('PUT', { option_ids: submittedChoices, ...(ballotId ? { ballot_id: ballotId } : {}) }),
        );
        saved = true;
        if (ballotId) {
          clearPendingBallot(user.id, poll.id, ballotId);
          setSubmitted(true);
        }
      }, 'Deine Stimme wurde gespeichert.')
      .finally(() => {
        onBusyChange?.(false);
        if (saved) onSaved?.();
      });
  }

  return (
    <>
      {action.feedback}
      <form className="space-y-4" onSubmit={submit}>
        <PeoplePicker
          legend={`${poll.kind === 'person' ? 'Personen' : 'Optionen'} auswählen (bis zu ${poll.max_choices})`}
          searchLabel={poll.kind === 'person' ? 'Person suchen' : 'Option suchen'}
          options={poll.options.map((option) => ({
            id: option.id,
            name: option.label,
            user_id: option.user_id,
          }))}
          selectedIds={choices}
          onChange={onChoicesChange}
          maxSelected={poll.max_choices}
          disabledUserIds={poll.allow_self_vote ? [] : [user.id]}
          disabled={disabled || poll.status !== 'open' || !eligible || action.busy}
        />
        {poll.kind === 'person' && poll.all_people && (
          <p className="text-sm text-muted">Die Personenliste wurde beim Öffnen festgelegt und bleibt gleich.</p>
        )}
        {poll.status === 'open' && (
          <button className={btn.primary} disabled={!canSubmit}>
            {poll.repeatable
              ? savedChoices.length || submitted
                ? 'Erneut abstimmen'
                : 'Stimme speichern'
              : savedChoices.length
                ? 'Stimme ändern'
                : 'Stimme speichern'}{' '}
            <Arrow />
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
      <BallotPrivacyNotice repeatable={poll.repeatable} />
    </>
  );
}

function normalizeWord(value: string) {
  return value.trim().toLowerCase().normalize('NFC');
}

function WordsBallotForm({
  poll,
  words,
  onWordsChange,
  onSaved,
  onBusyChange,
  disabled = false,
}: {
  poll: Category;
  words: string[];
  onWordsChange: (words: string[]) => void;
  onSaved?: () => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const { user } = useSession();
  const action = useAction();
  const savedWords = poll.my_words ?? [];
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const eligible = user.admitted && user.cohort_member;
  const readOnly = poll.status !== 'open' || disabled || !eligible;
  const validWords =
    words.length > 0 &&
    words.length <= poll.max_choices &&
    new Set(words).size === words.length &&
    words.every(
      (word) =>
        normalizeWord(word) === word && !/\s/u.test(word) && !/\p{Cc}/u.test(word) && Array.from(word).length <= 64,
    );
  const canSubmit = poll.status === 'open' && eligible && validWords && !action.busy && !disabled;

  function addWords(raw = input) {
    if (readOnly || action.busy) return;
    const candidates = raw.split(',').map(normalizeWord).filter(Boolean);
    if (!candidates.length) {
      setInputError('Gib ein Wort ein.');
      return;
    }
    const next = [...words];
    let error = '';
    for (const word of candidates) {
      if (/\s/u.test(word) || /\p{Cc}/u.test(word)) {
        error ||= 'Jeder Eintrag muss aus genau einem Wort ohne Steuerzeichen bestehen.';
        continue;
      }
      if (Array.from(word).length > 64) {
        error ||= 'Ein Wort darf höchstens 64 Zeichen lang sein.';
        continue;
      }
      if (next.includes(word)) continue;
      if (next.length >= poll.max_choices) {
        error ||= `Du kannst höchstens ${poll.max_choices} Wörter auswählen.`;
        continue;
      }
      next.push(word);
    }
    onWordsChange(next);
    setInputError(error);
    if (!error) setInput('');
  }

  function onWordKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addWords();
    }
  }

  function removeWord(word: string) {
    onWordsChange(words.filter((item) => item !== word));
    setInputError('');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const submittedWords = poll.repeatable ? [...words].sort() : words;
    const ballotId = poll.repeatable ? pendingBallotId(user.id, poll.id, JSON.stringify(submittedWords)) : undefined;
    onBusyChange?.(true);
    let saved = false;
    void action
      .run(async () => {
        await api(
          `/categories/${poll.id}/ballot`,
          json('PUT', { words: submittedWords, ...(ballotId ? { ballot_id: ballotId } : {}) }),
        );
        saved = true;
        if (ballotId) {
          clearPendingBallot(user.id, poll.id, ballotId);
          setSubmitted(true);
        }
      }, 'Deine Wörter wurden gespeichert.')
      .finally(() => {
        onBusyChange?.(false);
        if (saved) onSaved?.();
      });
  }

  return (
    <>
      {action.feedback}
      <form className="space-y-4" onSubmit={submit}>
        {poll.status === 'open' && (
          <>
            <label className="block text-sm font-bold" htmlFor={`word-input-${poll.id}`}>
              Wörter eingeben (bis zu {poll.max_choices})
              <span className="sr-only">, jeweils ein Wort mit Enter oder Komma hinzufügen</span>
              <input
                id={`word-input-${poll.id}`}
                className="mt-1.5 block min-h-12 w-full rounded-ui border-2 border-line bg-white px-4 py-2 text-[15px] font-normal text-ink placeholder:text-muted/70 focus:border-ink"
                value={input}
                maxLength={256}
                disabled={readOnly || words.length >= poll.max_choices || action.busy}
                placeholder="z. B. Zusammenhalt"
                onChange={(event) => {
                  setInput(event.target.value);
                  setInputError('');
                }}
                onKeyDown={onWordKeyDown}
                aria-describedby={`word-help-${poll.id}`}
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p id={`word-help-${poll.id}`} className="text-sm text-muted">
                Ein Wort pro Eintrag, höchstens 64 Zeichen. Groß- und Kleinschreibung wird vereinheitlicht.
              </p>
              <button
                className="rounded-full bg-pop px-4 py-2 text-sm font-bold text-ink transition-colors hover:bg-pill disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                disabled={readOnly || !input.trim() || action.busy}
                onClick={() => addWords()}
              >
                Wort hinzufügen
              </button>
            </div>
            {inputError && (
              <p className="text-sm text-bad" role="alert">
                {inputError}
              </p>
            )}
            <p className="text-sm tabular-nums text-muted">
              {words.length} von {poll.max_choices} ausgewählt
            </p>
          </>
        )}
        {words.length > 0 ? (
          <ul
            className="flex flex-wrap gap-2"
            aria-label={poll.status === 'open' ? 'Ausgewählte Wörter' : 'Deine gespeicherten Wörter'}
          >
            {words.map((word) => (
              <li
                key={word}
                className="inline-flex items-center gap-1 rounded-full bg-pop px-3 py-1.5 text-sm font-semibold text-ink"
              >
                <span>{word}</span>
                {poll.status === 'open' && !readOnly && (
                  <button
                    type="button"
                    className="rounded-full px-1 text-base leading-none text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                    aria-label={`Wort ${word} entfernen`}
                    disabled={action.busy}
                    onClick={() => removeWord(word)}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Du hast noch keine Wörter gespeichert.</p>
        )}
        {poll.status === 'open' && !readOnly && (
          <button className={btn.primary} disabled={!canSubmit}>
            {poll.repeatable
              ? savedWords.length || submitted
                ? 'Erneut abstimmen'
                : 'Stimme speichern'
              : savedWords.length
                ? 'Stimme ändern'
                : 'Stimme speichern'}{' '}
            <Arrow />
          </button>
        )}
        {!eligible && <p className={notice}>Nur freigegebene Mitglieder des Jahrgangs dürfen abstimmen.</p>}
      </form>
      <BallotPrivacyNotice repeatable={poll.repeatable} />
    </>
  );
}
