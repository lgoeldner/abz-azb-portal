import { useEffect, useState } from 'react';
import type { components } from './generated/api';
import { api, json } from './api';
import { Failure, PageHead, btn, field, useSession } from './ui';

type Policy = components['schemas']['EmailPolicy'];
type Status = components['schemas']['EmailStatus'];
type Message = components['schemas']['EmailMessage'];
type MessageDetails = components['schemas']['EmailMessageDetail'];
const labels: Record<string, string> = {
  accepted: 'Vom Anbieter angenommen',
  delivered: 'Zugestellt',
  failed: 'Fehlgeschlagen',
  pending: 'Ausstehend',
  queued: 'Warteschlange',
  login: 'Anmeldung',
  reminder: 'Erinnerung',
};

export function EmailAdmin() {
  const { user } = useSession();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [kind, setKind] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [detail, setDetail] = useState<MessageDetails | null>(null);
  const [eligible, setEligible] = useState<number | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const refresh = async () => {
    try {
      const x = await api<Status>('/admin/email/status');
      setStatus(x);
      setDraft(x.policy);
      setError(null);
    } catch (e) {
      setError(e as Error);
    }
  };
  const loadMessages = async (reset = true) => {
    const c = reset ? null : cursor;
    const query = new URLSearchParams();
    if (kind) query.set('kind', kind);
    if (stateFilter) query.set('status', stateFilter);
    if (c) query.set('cursor', c);
    try {
      const x = await api<{ items: Message[]; next_cursor: string | null }>(`/admin/email/messages?${query}`);
      setMessages(reset ? x.items : [...messages, ...x.items]);
      setNext(x.next_cursor);
      setCursor(x.next_cursor);
    } catch (e) {
      setError(e as Error);
    }
  };
  useEffect(() => {
    if (user.role !== 'admin') return;
    let active = true;
    void api<Status>('/admin/email/status')
      .then((x) => {
        if (active) {
          setStatus(x);
          setDraft(x.policy);
        }
      })
      .catch((e: Error) => {
        if (active) setError(e);
      });
    void api<{ items: Message[]; next_cursor: string | null }>('/admin/email/messages?')
      .then((x) => {
        if (active) {
          setMessages(x.items);
          setNext(x.next_cursor);
          setCursor(x.next_cursor);
        }
      })
      .catch((e: Error) => {
        if (active) setError(e);
      });
    return () => {
      active = false;
    };
  }, [user.role]);
  if (user.role !== 'admin') return <p role="alert">Diese Seite ist nur für Administratoren.</p>;
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const x = await api<Status>('/admin/email/settings', json('PATCH', draft));
      setStatus(x);
      setDraft(x.policy);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };
  const act = async (path: string) => {
    setBusy(true);
    try {
      const x = await api<Partial<Status> & { eligible?: number }>(path, json('POST'));
      if (x.eligible !== undefined) setEligible(x.eligible);
      if (x.policy) {
        setStatus(x as Status);
        setDraft(x.policy);
      }
      await refresh();
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };
  const numeric = (key: 'daily_limit' | 'reminder_limit' | 'login_reserve', label: string) => (
    <label className="block text-sm font-semibold">
      {label}
      <input
        aria-label={label}
        disabled={busy}
        type="number"
        min="0"
        className={`${field} mt-1`}
        value={draft?.[key] ?? ''}
        onChange={(e) => setDraft(draft ? { ...draft, [key]: Number(e.target.value) } : null)}
      />
    </label>
  );
  return (
    <>
      <PageHead title="E-Mail-Verwaltung">Versandkontingent, Anbieterstatus und Zustellprotokoll.</PageHead>
      {error && <Failure error={error} retry={() => void refresh()} />}
      <section className="mb-5 rounded-ui bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">Versandstatus</h2>
            <p className="mt-1 text-sm text-muted">
              {status
                ? `${status.provider.name}: ${status.provider.configured ? 'konfiguriert' : 'nicht konfiguriert'} · Portal-Zählung ${status.usage.day} (UTC)`
                : 'Kontingent unbekannt'}
            </p>
          </div>
          <button className={btn.secondary} onClick={() => void refresh()}>
            Status aktualisieren
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            Verbraucht: <b>{status?.usage.used ?? '—'}</b>
          </div>
          <div>
            Reserviert: <b>{status?.usage.reserved ?? '—'}</b>
          </div>
          <div>
            Verfügbar: <b>{status?.usage.remaining ?? '—'}</b>
          </div>
          <div>
            Anmeldungen: <b>{status?.usage.login ?? '—'}</b>
          </div>
          <div>
            Erinnerungen: <b>{status?.usage.reminder ?? '—'}</b>
          </div>
          <div>
            Wartend / fehlgeschlagen: <b>{status ? `${status.health.pending} / ${status.health.failed}` : '—'}</b>
          </div>
        </div>
        {draft && (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {numeric('daily_limit', 'Tageslimit')}
              {numeric('reminder_limit', 'Erinnerungslimit')}
              {numeric('login_reserve', 'Anmeldungsreserve')}
            </div>
            <div className="mt-4 flex flex-wrap gap-4">
              <label>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={draft.paused}
                  onChange={(e) => setDraft({ ...draft, paused: e.target.checked })}
                />{' '}
                Erinnerungen pausieren
              </label>
              <label>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={draft.pause_all}
                  onChange={(e) => setDraft({ ...draft, pause_all: e.target.checked })}
                />{' '}
                Alle E-Mails pausieren
              </label>
            </div>
            {draft.pause_all && (
              <p role="alert" className="mt-3 rounded bg-amber-100 p-3 font-semibold">
                Achtung: „Alle E-Mails pausieren“ stoppt auch Anmelde-E-Mails.
              </p>
            )}
            <button className={`${btn.primary} mt-4`} disabled={busy} onClick={() => void save()}>
              Einstellungen speichern
            </button>
          </>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button className={btn.secondary} disabled={busy} onClick={() => void act('/admin/email/reconcile')}>
            Anbieterstatus abgleichen
          </button>
          <button className={btn.secondary} disabled={busy} onClick={() => void act('/admin/email/reminders/preview')}>
            Erinnerungen vorschauen
          </button>
          {eligible !== null && <span role="status">{eligible} berechtigte Empfänger</span>}
        </div>
      </section>
      <section className="rounded-ui bg-white p-5">
        <h2 className="text-xl font-bold">Versandprotokoll</h2>
        <div className="my-3 flex gap-2">
          <select
            aria-label="Nachrichtenart"
            className={field}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setTimeout(() => void loadMessages(), 0);
            }}
          >
            <option value="">Alle Arten</option>
            <option value="login">Anmeldung</option>
            <option value="reminder">Erinnerung</option>
          </select>
          <select
            aria-label="Versandstatus"
            className={field}
            value={stateFilter}
            onChange={(e) => {
              setStateFilter(e.target.value);
              setTimeout(() => void loadMessages(), 0);
            }}
          >
            <option value="">Alle Status</option>
            <option value="accepted">Angenommen</option>
            <option value="delivered">Zugestellt</option>
            <option value="failed">Fehlgeschlagen</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Empfänger</th>
                <th>Art</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.id} className="border-t border-line">
                  <td>{new Date(m.created_at).toLocaleString('de-DE')}</td>
                  <td>{m.recipient_masked}</td>
                  <td>{labels[m.kind] ?? m.kind}</td>
                  <td>
                    {labels[m.status] ?? m.status}
                    {m.failure_code && ` · ${m.failure_code}`}
                  </td>
                  <td>
                    <button
                      className="underline"
                      onClick={async () => setDetail(await api<MessageDetails>(`/admin/email/messages/${m.id}`))}
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {next && (
          <button className={`${btn.secondary} mt-3`} onClick={() => void loadMessages(false)}>
            Weitere laden
          </button>
        )}
        {detail && (
          <div role="dialog" aria-label="Versanddetails" className="mt-4 border-t pt-3">
            <button className="float-right" onClick={() => setDetail(null)}>
              Schließen
            </button>
            <h3 className="font-bold">Versandversuche</h3>
            <p>
              {detail.message.recipient_masked} · {labels[detail.message.status] ?? detail.message.status} ·{' '}
              {detail.message.attempts} Versuche
            </p>
            {detail.message.failure_code && <p>Fehlercode: {detail.message.failure_code}</p>}
            <ul>
              {detail.events.map((e) => (
                <li key={e.id}>
                  {new Date(e.created_at).toLocaleString('de-DE')} · {labels[e.status] ?? e.status}
                  {e.failure_code && ` · ${e.failure_code}`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </>
  );
}
