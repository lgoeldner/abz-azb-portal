import { PageHead, panel } from './ui';
import { Passkeys } from './Passkeys';
import { Preference } from './ReminderSettings';

export function Settings() {
  return (
    <>
      <PageHead title="Einstellungen">Dein Konto: E-Mail-Benachrichtigungen und Passkeys.</PageHead>
      <div className="space-y-6">
        <section className={`${panel} space-y-3`} aria-labelledby="settings-email">
          <h2 id="settings-email" className="text-xl font-extrabold tracking-tight">
            E-Mail-Benachrichtigungen
          </h2>
          <Preference />
        </section>
        <Passkeys />
      </div>
    </>
  );
}
