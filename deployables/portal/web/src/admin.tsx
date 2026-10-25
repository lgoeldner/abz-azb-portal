import { Check, GraduationCap, MoreHorizontal, PenLine, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, date, json, patchUser, type AuditEvent, type SystemStatus, type User } from './api';
import {
  Empty,
  Failure,
  Loading,
  PageHead,
  btn,
  field,
  heading,
  panel,
  roleName,
  useAction,
  useData,
  useSession,
} from './ui';

type Role = User['role'];
const roles: Role[] = ['student', 'manager', 'admin'];
const roleIcon: Record<Role, LucideIcon> = {
  student: GraduationCap,
  manager: PenLine,
  admin: ShieldCheck,
};
const chip = 'inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium';
const chipAction =
  'cursor-pointer ring-1 ring-transparent transition-shadow hover:ring-current focus-visible:ring-current disabled:opacity-60';
const menuItem = 'flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm hover:bg-pill';
// PATCH replaces every field, so build it from the current server record instead of the possibly stale list.
const updateUser = async (u: User, change: Partial<User>) => {
  const now = (await api<User[]>('/admin/users')).find((x) => x.id === u.id);
  if (!now) throw new ApiError(404, 'not_found', 'Diese Person gibt es nicht mehr.');
  return patchUser(now, change);
};

// ---------- Personen ----------
const filters: [string, string, (u: User) => boolean][] = [
  ['all', 'Alle', () => true],
  ['student', 'Jahrgang', (u) => u.role === 'student'],
  ['manager', 'Redaktion', (u) => u.role === 'manager'],
  ['admin', 'Administration', (u) => u.role === 'admin'],
  ['waiting', 'Wartet auf Freigabe', (u) => !u.admitted],
];

export function People() {
  const users = useData<User[]>('/admin/users');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const active = filters.find((f) => f[0] === filter)![2];
  const shown = (users.data ?? []).filter((u) => active(u) && u.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <>
      <PageHead title="Personen">Zugänge freigeben, Rollen verteilen und Gäste in den Jahrgang aufnehmen.</PageHead>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 className={heading}>Unser Jahrgang & Team</h2>
        <label className="block w-full sm:w-72">
          <span className="sr-only">Person suchen</span>
          <input
            type="search"
            className={field}
            placeholder="Person suchen …"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Personen filtern">
        {filters.map(([id, text, test]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-transform active:scale-95 ${
              filter === id ? 'bg-ink text-pop' : 'bg-pill text-ink hover:bg-pop/40'
            }`}
            onClick={() => setFilter(id)}
          >
            {text}
            <span className="tabular-nums opacity-70">{(users.data ?? []).filter(test).length}</span>
          </button>
        ))}
      </div>
      {users.isPending ? (
        <Loading />
      ) : users.error ? (
        <Failure error={users.error} retry={() => users.refetch()} />
      ) : shown.length ? (
        <ul className="divide-y divide-line rounded-ui border-2 border-line bg-white">
          {shown.map((u) => (
            <PersonRow key={u.id} u={u} />
          ))}
        </ul>
      ) : (
        <Empty>Keine Personen gefunden.</Empty>
      )}
    </>
  );
}

type Confirming = { kind: 'role'; role: Role } | { kind: 'block' } | { kind: 'delete' } | null;
function PersonRow({ u }: { u: User }) {
  const action = useAction();
  const [confirm, setConfirm] = useState<Confirming>(null);
  const RoleIcon = roleIcon[u.role];
  const self = useSession().user.id === u.id;
  const close = () => setConfirm(null);
  return (
    <li className="min-w-0 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
          <strong className="min-w-0 break-words text-[15px] font-semibold">{u.name}</strong>
          {!u.cohort_member && (
            <button
              type="button"
              disabled={action.busy}
              className={`${chip} bg-pill text-muted ${chipAction}`}
              aria-label={`Zum Jahrgangsmitglied machen: ${u.name}`}
              title="Zum Jahrgangsmitglied machen"
              onClick={() => action.run(() => updateUser(u, { cohort_member: true }), 'Zum Jahrgangsmitglied gemacht.')}
            >
              Gast
            </button>
          )}
          <span role="img" aria-label={roleName(u.role)} title={roleName(u.role)} className="text-muted">
            <RoleIcon aria-hidden="true" className="size-[18px]" />
          </span>
          {u.admitted ? (
            <span className={`${chip} bg-ok-tint text-ok`}>Freigegeben</span>
          ) : (
            <button
              type="button"
              disabled={action.busy}
              className={`${chip} bg-wait-tint text-wait ${chipAction}`}
              aria-label={`Zugang freigeben: ${u.name}`}
              title="Zugang freigeben"
              onClick={() => action.run(() => updateUser(u, { admitted: true }), 'Zugang freigegeben.')}
            >
              Wartet
            </button>
          )}
        </div>
        <RowMenu
          u={u}
          onRole={(role) => setConfirm({ kind: 'role', role })}
          onBlock={u.admitted && !self ? () => setConfirm({ kind: 'block' }) : undefined}
          onDelete={() => setConfirm({ kind: 'delete' })}
        />
      </div>
      {!confirm && action.feedback && <div className="mt-2">{action.feedback}</div>}
      {confirm?.kind === 'role' && (
        <Confirm
          title={`${u.name} wird zu ${roleName(confirm.role)}?`}
          busy={action.busy}
          onCancel={close}
          onConfirm={() =>
            action.run(async () => {
              await updateUser(u, { role: confirm.role });
              close();
            }, 'Rolle geändert.')
          }
          error={action.feedback}
        >
          Die Rolle ändert sich sofort. Die Administration kann Rollen jederzeit wieder ändern.
        </Confirm>
      )}
      {confirm?.kind === 'block' && (
        <Confirm
          danger
          title={`Zugang von ${u.name} sperren?`}
          confirmLabel="Sperren"
          busy={action.busy}
          onCancel={close}
          onConfirm={() =>
            action.run(async () => {
              await updateUser(u, { admitted: false });
              close();
            }, 'Zugang gesperrt.')
          }
          error={action.feedback}
        >
          Die Person wird sofort abgemeldet und kann das Portal erst nach erneuter Freigabe nutzen. Beiträge und Stimmen
          bleiben erhalten.
        </Confirm>
      )}
      {confirm?.kind === 'delete' && (
        <Confirm
          danger
          title={`${u.name} löschen?`}
          confirmLabel="Löschen"
          busy={action.busy}
          onCancel={close}
          onConfirm={() =>
            action.run(async () => {
              await api(`/admin/users/${u.id}`, json('DELETE'));
              close();
            }, 'Person gelöscht.')
          }
          error={action.feedback}
        >
          Das Konto wird dauerhaft entfernt. Das kann nicht rückgängig gemacht werden.
        </Confirm>
      )}
    </li>
  );
}

function RowMenu({
  u,
  onRole,
  onBlock,
  onDelete,
}: {
  u: User;
  onRole: (r: Role) => void;
  onBlock?: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const shut = () => {
    setOpen(false);
    setSub(false);
  };
  // Focus returns to the trigger before a dialog opens, so the dialog hands it back when it closes.
  const pick = (then: () => void) => {
    shut();
    trigger.current?.focus();
    then();
  };
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const down = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) shut();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') {
        shut();
        trigger.current?.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(box.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
        if (!items.length) return;
        e.preventDefault();
        const at = items.indexOf(document.activeElement as HTMLElement);
        items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div ref={box} className="relative flex-none">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Aktionen für ${u.name}`}
        title="Aktionen"
        className="grid size-10 place-items-center rounded-full hover:bg-pill"
        onClick={() => (open ? shut() : setOpen(true))}
      >
        <MoreHorizontal aria-hidden="true" className="size-5" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Aktionen für ${u.name}`}
          className="absolute right-0 top-full z-20 mt-1 w-56 rounded-ui border-2 border-line bg-white p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={sub}
            className={menuItem}
            onClick={() => setSub(!sub)}
          >
            Rolle ändern<span aria-hidden="true">›</span>
          </button>
          {sub && (
            <div role="menu" aria-label="Rolle ändern" className="mb-1 ml-3 border-l-2 border-pill pl-1">
              {roles.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="menuitemradio"
                  aria-checked={u.role === r}
                  className={menuItem}
                  onClick={() =>
                    pick(() => {
                      if (r !== u.role) onRole(r);
                    })
                  }
                >
                  {roleName(r)}
                  {u.role === r && <Check aria-hidden="true" className="size-4" />}
                </button>
              ))}
            </div>
          )}
          {onBlock && (
            <button type="button" role="menuitem" className={menuItem} onClick={() => pick(onBlock)}>
              Zugang sperren
            </button>
          )}
          <button type="button" role="menuitem" className={`${menuItem} text-bad`} onClick={() => pick(onDelete)}>
            Löschen
          </button>
        </div>
      )}
    </div>
  );
}

function Confirm({
  title,
  children,
  confirmLabel = 'Bestätigen',
  danger = false,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy: boolean;
  error?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  // Closing (not just unmounting) the modal lets the browser restore focus to the element that opened it.
  useLayoutEffect(() => {
    const d = ref.current!;
    if (typeof d.showModal === 'function') {
      if (!d.open) d.showModal();
    } else d.setAttribute('open', '');
    return () => {
      if (d.open && typeof d.close === 'function') d.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      className="m-auto w-[min(92vw,28rem)] rounded-ui bg-white p-6 text-ink backdrop:bg-ink/40"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id={id} className={heading}>
        {title}
      </h2>
      <p className="mt-2 text-sm text-muted">{children}</p>
      {error && <div className="mt-4">{error}</div>}
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        <button type="button" className={btn.secondary} onClick={onCancel}>
          Abbrechen
        </button>
        <button
          type="button"
          disabled={busy}
          className={
            danger
              ? 'inline-flex items-center justify-center rounded-full bg-bad px-5 py-2.5 text-[15px] font-bold text-white'
              : btn.primary
          }
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

// ---------- Aktivitätsprotokoll ----------
export function ActivityLog() {
  const audit = useData<AuditEvent[]>('/admin/audit');
  const system = useData<SystemStatus>('/admin/status');
  return (
    <>
      <PageHead title="Aktivitätsprotokoll">Was in der Verwaltung passiert ist und wie es dem Betrieb geht.</PageHead>
      {system.data && (
        <div className="mb-8 flex flex-wrap gap-x-10 gap-y-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${system.data.backup_stale ? 'bg-wait' : 'bg-ok'}`} />
              <strong>{system.data.backup_stale ? 'Backup prüfen' : 'Backup aktuell'}</strong>
            </div>
            <small className="mt-1 block text-muted">
              {system.data.backup_last_success
                ? `Letzter Erfolg: ${date(system.data.backup_last_success)}`
                : 'Noch kein erfolgreiches Backup gemeldet'}
            </small>
          </div>
          <div>
            <strong className="tabular-nums">{(system.data.upload_bytes / 1024 / 1024).toFixed(1)} MB</strong>
            <small className="mt-1 block text-muted">Dateispeicher belegt</small>
          </div>
        </div>
      )}
      {system.error && (
        <div className="mb-8">
          <Failure error={system.error} retry={() => system.refetch()} />
        </div>
      )}
      <h2 className={heading}>Letzte Aktivitäten</h2>
      <p className="mb-4 mt-1 text-sm text-muted">
        Die letzten 200 Aktionen. Keine Zugangsdaten oder Stimmzuordnungen.
      </p>
      {audit.isPending ? (
        <Loading />
      ) : audit.error ? (
        <Failure error={audit.error} retry={() => audit.refetch()} />
      ) : (
        <div className={`relative ${panel} overflow-x-auto`}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[13px] text-muted">
                <th className="py-2 pr-4 font-normal">Wer</th>
                <th className="py-2 pr-4 font-normal">Aktion</th>
                <th className="py-2 pr-4 font-normal">Datensatz</th>
                <th className="py-2 text-right font-normal">Zeitpunkt</th>
              </tr>
            </thead>
            <tbody>
              {audit.data?.map((a) => (
                <tr className="border-t border-line" key={a.id}>
                  <td className="py-3 pr-4 align-top">{a.actor_name}</td>
                  <td className="py-3 pr-4 align-top">{actionName(a.action)}</td>
                  <td className="py-3 pr-4 align-top">
                    <code className="text-[13px]" title={a.entity_id}>
                      {a.entity_id.slice(0, 8)}…
                    </code>
                  </td>
                  <td className="py-3 text-right align-top tabular-nums">{date(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!audit.data?.length && <p className="mt-3 text-sm text-muted">Keine Aktivitäten vorhanden.</p>}
        </div>
      )}
    </>
  );
}
function actionName(action: string) {
  const names: Record<string, string> = {
    'submission.created': 'Beitrag eingereicht',
    'submission.updated': 'Beitrag geändert',
    'submission.status': 'Beitragsstatus geändert',
    'attachment.created': 'Datei hinzugefügt',
    'attachment.deleted': 'Datei entfernt',
    'poll.created': 'Sammlung erstellt',
    'poll.updated': 'Sammlung geändert',
    'poll.status': 'Sammlungsstatus geändert',
    'user.updated': 'Zugang geändert',
    'user.deleted': 'Person gelöscht',
    'category.created': 'Sammlung erstellt',
    'category.updated': 'Sammlung geändert',
    'correction.created': 'Korrektur angefragt',
    'correction.resolved': 'Korrektur erledigt',
  };
  return names[action] ?? action.replaceAll('_', ' ').replaceAll('.', ' ');
}
