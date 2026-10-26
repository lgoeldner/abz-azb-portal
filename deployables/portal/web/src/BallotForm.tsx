import type { FormEvent } from 'react';
import type { Category } from './api';
import { api, json } from './api';
import { PeoplePicker } from './PeoplePicker';
import { Arrow, btn, notice, useAction, useSession } from './ui';

export function BallotPrivacyNotice() {
  return (
    <p className="text-sm text-muted">
      Namentliche Abstimmung: Die Administration kann deine Stimme und Änderungen zuordnen. Während der Öffnung kannst
      du deine Auswahl ändern. Ergebnisse sind für Schüler:innen nicht sichtbar.
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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    onBusyChange?.(true);
    let saved = false;
    void action
      .run(async () => {
        await api(`/categories/${poll.id}/ballot`, json('PUT', { option_ids: choices }));
        saved = true;
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
            {savedChoices.length ? 'Stimme ändern' : 'Stimme speichern'} <Arrow />
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
      <BallotPrivacyNotice />
    </>
  );
}
