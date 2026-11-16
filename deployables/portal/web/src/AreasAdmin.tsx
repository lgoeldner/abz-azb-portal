import { useState } from 'react';
import { api, json, type Area, type User } from './api';
import { PeoplePicker, type PeoplePickerOption } from './PeoplePicker';
import {
  Empty,
  Failure,
  Loading,
  PageHead,
  btn,
  field,
  heading,
  label,
  panel,
  useAction,
  useData,
  useSession,
} from './ui';

// Only admitted managers and admins may be default reviewers.
export const eligibleReviewers = (users: User[]): PeoplePickerOption[] =>
  users
    .filter((u) => (u.role === 'manager' || u.role === 'admin') && u.admitted)
    .map((u) => ({ id: u.id, name: u.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

export function AreasAdmin() {
  const { user } = useSession();
  const isAdmin = user.role === 'admin';
  const areas = useData<Area[]>('/areas', isAdmin);
  const users = useData<User[]>('/admin/users', isAdmin);
  if (!isAdmin) {
    return (
      <>
        <PageHead title="Bereiche" />
        <p role="alert" className="rounded-ui bg-bad-tint px-4 py-3 text-sm text-bad">
          Bereiche verwalten ist nur für Administratoren.
        </p>
      </>
    );
  }
  const options = eligibleReviewers(users.data ?? []);
  const areaList = areas.data ?? [];
  const error = areas.error ?? users.error;
  return (
    <>
      <PageHead title="Bereiche">
        Tickets gehören zu einem Bereich. Die Standard-Reviewer eines Bereichs nehmen dessen Tickets ab.
      </PageHead>
      {areas.isPending || users.isPending ? (
        <Loading />
      ) : error ? (
        <Failure
          error={error}
          retry={() => {
            areas.refetch();
            users.refetch();
          }}
        />
      ) : (
        <>
          <NewArea options={options} />
          <section aria-labelledby="areas-list" className="mt-10">
            <h2 id="areas-list" className={heading}>
              Bestehende Bereiche
            </h2>
            {areaList.length === 0 ? (
              <div className="mt-4">
                <Empty>Es gibt noch keine Bereiche.</Empty>
              </div>
            ) : (
              <ul className="mt-4 space-y-4">
                {areaList.map((area) => (
                  <AreaRow key={area.id} area={area} options={options} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}

function NewArea({ options }: { options: PeoplePickerOption[] }) {
  const action = useAction();
  const [name, setName] = useState('');
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const trimmed = name.trim();
  return (
    <section aria-labelledby="areas-new" className="mt-10">
      <h2 id="areas-new" className={heading}>
        Neuer Bereich
      </h2>
      <form
        aria-label="Neuer Bereich"
        className={`${panel} mt-4 space-y-5`}
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmed) return;
          action.run(async () => {
            await api('/admin/areas', json('POST', { name: trimmed, reviewer_ids: reviewerIds }));
            setName('');
            setReviewerIds([]);
          }, 'Bereich angelegt.');
        }}
      >
        <label className={label}>
          Name
          <input className={field} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <PeoplePicker
          legend="Standard-Reviewer"
          options={options}
          selectedIds={reviewerIds}
          onChange={setReviewerIds}
        />
        {options.length === 0 && (
          <p className="text-sm text-muted">Es gibt noch keine freigegebenen Redaktions- oder Administrationskonten.</p>
        )}
        <button type="submit" className={btn.primary} disabled={!trimmed || action.busy}>
          Bereich anlegen
        </button>
        {action.feedback}
      </form>
    </section>
  );
}

function AreaRow({ area, options }: { area: Area; options: PeoplePickerOption[] }) {
  const action = useAction();
  const eligible = new Set(options.map((o) => o.id));
  const initialReviewers = area.reviewers.map((r) => r.id).filter((id) => eligible.has(id));
  const [name, setName] = useState(area.name);
  const [reviewerIds, setReviewerIds] = useState<string[]>(initialReviewers);
  const dropped = area.reviewers.length - initialReviewers.length;
  const trimmed = name.trim();
  return (
    <li className={panel}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="min-w-0 break-words text-lg font-extrabold">{area.name}</h3>
        {area.reviewers.length === 0 && (
          <span className="inline-flex items-center rounded-full bg-bad-tint px-3 py-1 text-xs font-bold text-bad">
            Keine Reviewer: Tickets dieses Bereichs können nicht abgenommen werden
          </span>
        )}
      </div>
      <form
        aria-label={`Bereich ${area.name}`}
        className="mt-4 space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmed) return;
          action.run(
            () =>
              api(
                `/admin/areas/${area.id}`,
                json('PATCH', { name: trimmed, reviewer_ids: reviewerIds, version: area.version }),
              ),
            'Bereich gespeichert.',
          );
        }}
      >
        <label className={label}>
          Name
          <input className={field} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <PeoplePicker
          legend="Standard-Reviewer"
          options={options}
          selectedIds={reviewerIds}
          onChange={setReviewerIds}
        />
        {dropped > 0 && (
          <p className="text-sm text-muted">
            {dropped === 1 ? 'Eine Person ist' : `${dropped} Personen sind`} nicht mehr als Reviewer berechtigt und wird
            beim Speichern entfernt.
          </p>
        )}
        <button type="submit" className={btn.secondary} disabled={!trimmed || action.busy}>
          Speichern
        </button>
        {action.feedback}
      </form>
    </li>
  );
}
