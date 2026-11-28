import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError, json } from './api';
import { btn, Failure, Loading, notice, panel, useAction, useData } from './ui';

type Account = { id: string; created_at: string };
const day = (value: string) => new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(value));
const returned = {
  linked: 'Google ist verknüpft. Du kannst dich jetzt mit Google anmelden.',
  failed:
    'Google konnte nicht verknüpft werden. Dieses Google-Konto ist vielleicht schon mit einem anderen Zugang verbunden.',
};

// The auth service answers 404 for these routes while Google sign-in is not configured: then the section stays hidden.
export function GoogleAccount() {
  const accounts = useData<Account[]>('/api/auth/list-accounts');
  const action = useAction();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState(() => returned[params.get('google') as keyof typeof returned] ?? '');
  useEffect(() => {
    if (params.has('google')) setParams({}, { replace: true });
  }, [params, setParams]);
  if (accounts.error instanceof ApiError && accounts.error.status === 404) return null;
  const stale = action.error instanceof ApiError && action.error.code === 'session_not_fresh';
  const link = () =>
    action.run(async () => {
      setStatus('');
      const { url } = await api<{ url: string }>('/api/auth/link-social', json('POST'));
      window.location.assign(url);
    });
  const unlink = (account: Account) => {
    if (!window.confirm('Google-Verknüpfung entfernen?')) return;
    setStatus('');
    return action.run(async () => {
      await api('/api/auth/unlink-account', json('POST', { id: account.id }));
      setStatus('Google-Verknüpfung entfernt.');
    });
  };
  return (
    <section className={`${panel} space-y-4`} aria-labelledby="google-account">
      <h2 id="google-account" className="text-xl font-bold tracking-tight">
        Google
      </h2>
      <p className="text-[15px] text-muted">
        Verknüpfe dein Google-Konto, um dich mit „Mit Google anmelden“ einzuloggen. Der Anmeldelink per E-Mail bleibt
        als Ersatz.
      </p>
      {accounts.isPending ? (
        <Loading />
      ) : accounts.error ? (
        <Failure error={accounts.error} retry={() => accounts.refetch()} />
      ) : accounts.data.length === 0 ? (
        <button type="button" className={btn.secondary} disabled={action.busy} onClick={link}>
          Google verknüpfen
        </button>
      ) : (
        <ul className="space-y-3">
          {accounts.data.map((account) => (
            <li key={account.id} className="flex items-center justify-between gap-3">
              <span>Verknüpft seit {day(account.created_at)}</span>
              <button type="button" className={btn.danger} disabled={action.busy} onClick={() => unlink(account)}>
                Entfernen<span className="sr-only">: Google-Verknüpfung</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div aria-live="polite">
        {status && <p>{status}</p>}
        {stale ? (
          <p className={notice} role="alert">
            Deine Anmeldung ist älter als eine Stunde. Melde dich erneut an, um Google zu ändern.{' '}
            <a className="underline" href="/auth/login">
              Erneut anmelden
            </a>
          </p>
        ) : (
          action.feedback
        )}
      </div>
    </section>
  );
}
