import { useState } from 'react';
import { api, json } from './api';
import { btn, Failure, Loading, useAction, useData } from './ui';

export function ReminderSettings() {
  const [open, setOpen] = useState(false);
  return (
    <details className="px-1 text-sm" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer py-1">E-Mail-Erinnerungen</summary>
      {open && <Preference />}
    </details>
  );
}
function Preference() {
  const preference = useData<{ enabled: boolean }>('/me/email-reminders');
  const action = useAction();
  if (preference.isPending) return <Loading />;
  if (preference.error) return <Failure error={preference.error} retry={() => preference.refetch()} />;
  return (
    <div className="mt-2 space-y-2">
      <p>Erinnerungen an offene Abgaben: {preference.data.enabled ? 'aktiv' : 'ausgeschaltet'}.</p>
      <button
        type="button"
        className={btn.text}
        disabled={action.busy}
        onClick={() =>
          action.run(async () => {
            await api('/me/email-reminders', json('PATCH', { enabled: !preference.data.enabled }));
            await preference.refetch();
          })
        }
      >
        {preference.data.enabled ? 'Erinnerungen ausschalten' : 'Erinnerungen aktivieren'}
      </button>
      <p className="text-xs text-muted">Anmelde-E-Mails bleiben verfügbar.</p>
      {action.feedback}
    </div>
  );
}
