import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError, json } from './api';
import { btn, Failure, Loading, notice, panel, useAction, useData } from './ui';

type Passkey = { id: string; name: string | null; created_at: string };
const base = '/api/auth/passkey';
const day = (value: string) => new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(value));
const supported = () =>
  typeof PublicKeyCredential !== 'undefined' && 'parseCreationOptionsFromJSON' in PublicKeyCredential;

export function Passkeys() {
  const passkeys = useData<Passkey[]>(`${base}/list-user-passkeys`);
  const action = useAction();
  const [status, setStatus] = useState('');
  const stale = action.error instanceof ApiError && action.error.code === 'session_not_fresh';
  const add = () =>
    action.run(async () => {
      setStatus('');
      try {
        const options = await api<PublicKeyCredentialCreationOptionsJSON>(
          `${base}/generate-register-options`,
          json('POST'),
        );
        const credential = await navigator.credentials.create({
          publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
        });
        if (!credential) return;
        await api(
          `${base}/verify-registration`,
          json('POST', { response: (credential as PublicKeyCredential).toJSON() }),
        );
        setStatus('Passkey hinzugefügt.');
      } catch (e) {
        if (e instanceof DOMException && e.name === 'NotAllowedError') return; // dialog cancelled or timed out
        if (e instanceof DOMException && e.name === 'InvalidStateError')
          throw new Error('Auf diesem Gerät gibt es schon einen Passkey für dein Konto.', { cause: e });
        throw e;
      }
    });
  const remove = (key: Passkey) => {
    if (!window.confirm(`Passkey vom ${day(key.created_at)} entfernen?`)) return;
    setStatus('');
    return action.run(async () => {
      await api(`${base}/delete-passkey`, json('POST', { id: key.id }));
      setStatus('Passkey entfernt.');
    });
  };
  return (
    <>
      <section className={`${panel} space-y-4`} aria-labelledby="passkey-list">
        <h2 id="passkey-list" className="text-xl font-extrabold tracking-tight">
          Passkeys
        </h2>
        <p className="text-[15px] text-muted">
          Mit einem Passkey meldest du dich ohne E-Mail-Link an. Der Anmeldelink per E-Mail bleibt als Ersatz.
        </p>
        {passkeys.isPending ? (
          <Loading />
        ) : passkeys.error ? (
          <Failure error={passkeys.error} retry={() => passkeys.refetch()} />
        ) : passkeys.data.length === 0 ? (
          <p>Du hast noch keinen Passkey.</p>
        ) : (
          <ul className="space-y-3">
            {passkeys.data.map((key) => (
              <li key={key.id} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2.5">
                  <KeyRound aria-hidden="true" className="size-4" />
                  Passkey vom {day(key.created_at)}
                </span>
                <button type="button" className={btn.danger} disabled={action.busy} onClick={() => remove(key)}>
                  Entfernen<span className="sr-only">: Passkey vom {day(key.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {supported() ? (
          <button type="button" className={btn.secondary} disabled={action.busy} onClick={add}>
            Passkey hinzufügen
          </button>
        ) : (
          <p className={notice}>
            Dieser Browser unterstützt keine Passkeys. Du kannst dich weiter per E-Mail-Link anmelden.
          </p>
        )}
        <div aria-live="polite">
          {status && <p>{status}</p>}
          {stale ? (
            <p className={notice} role="alert">
              Deine Anmeldung ist älter als eine Stunde. Melde dich erneut an, um einen Passkey hinzuzufügen.{' '}
              <a className="underline" href="/auth/login">
                Erneut anmelden
              </a>
            </p>
          ) : (
            action.feedback
          )}
        </div>
      </section>
    </>
  );
}
