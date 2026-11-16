import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { Baby, ChevronLeft, ChevronRight, Paperclip, UserRound, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { api, json, type Category, type Submission } from './api';
import { Arrow, btn, useAction } from './ui';
import './Steckbrief.css';

// A Steckbrief is one ordinary submission: body = JSON object of answers, photos = attachments whose
// caption is the slot name. The server only checks that shape; the questions live here.
//
// ponytail: templates are hardcoded JSX (at most three will ever exist). To add one: write another
// Template below from the Line/Lines/Pick/Photo building blocks (or any JSX), register it in templates,
// and add its id and photo slots on the Go side (steckbriefSlots, the template enums in types.go and
// contract.go, then node scripts/check-contract.mjs --write).

type Answers = Record<string, string>;
type Paper = {
  answers: Answers;
  set: (key: string, value: string) => void;
  photos: Record<string, string | undefined>;
  pick: (slot: string, file: File | null) => void;
  readOnly: boolean;
  busy: boolean;
};
const PaperContext = createContext<Paper>(null!);

/** One handwritten line. */
export function Line({
  k,
  label,
  placeholder,
  max = 80,
  wide = false,
}: {
  k: string;
  label: string;
  placeholder?: string;
  max?: number;
  wide?: boolean;
}) {
  const paper = useContext(PaperContext);
  const className = 'sb-line' + (wide ? ' sb-wide' : '');
  if (paper.readOnly)
    return (
      <div className={className}>
        <span className="sb-label">{label}</span>
        <span className="sb-value">{paper.answers[k]}</span>
      </div>
    );
  return (
    <label className={className}>
      <span className="sb-label">{label}</span>
      <input
        className="sb-input"
        value={paper.answers[k] ?? ''}
        maxLength={max}
        placeholder={placeholder}
        disabled={paper.busy}
        onChange={(e) => paper.set(k, e.target.value)}
      />
    </label>
  );
}

/** A few ruled lines for longer answers. */
export function Lines({
  k,
  label,
  placeholder,
  rows = 2,
  max = 300,
}: {
  k: string;
  label: string;
  placeholder?: string;
  rows?: number;
  max?: number;
}) {
  const paper = useContext(PaperContext);
  const style = { '--rows': rows } as CSSProperties;
  if (paper.readOnly)
    return (
      <div className="sb-line sb-wide">
        <span className="sb-label">{label}</span>
        <span className="sb-ruled" style={style}>
          {paper.answers[k]}
        </span>
      </div>
    );
  return (
    <label className="sb-line sb-wide">
      <span className="sb-label">{label}</span>
      <textarea
        className="sb-ruled"
        style={style}
        rows={rows}
        value={paper.answers[k] ?? ''}
        maxLength={max}
        placeholder={placeholder}
        disabled={paper.busy}
        onChange={(e) => paper.set(k, e.target.value)}
      />
    </label>
  );
}

const circle = (
  <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
    <path d="M52 4C28 2 5 9 4 21c-1 11 20 16 46 15 27-1 47-7 46-18C95 8 74 3 44 5" vectorEffect="non-scaling-stroke" />
  </svg>
);

/** "Circle one": choosing the circled answer again clears it. */
export function Pick({ k, label, options }: { k: string; label: string; options: string[] }) {
  const paper = useContext(PaperContext);
  const name = useId();
  const chosen = paper.answers[k];
  if (paper.readOnly)
    return (
      <div className="sb-pick sb-wide">
        <span className="sb-label">{label}</span>
        <span className="sb-options">
          {options.map((option) => (
            <span className="sb-option" data-on={chosen === option || undefined} key={option}>
              {option}
              {chosen === option && <span className="sr-only"> (gewählt)</span>}
              {circle}
            </span>
          ))}
        </span>
      </div>
    );
  return (
    <fieldset className="sb-pick sb-wide" disabled={paper.busy}>
      <legend className="sb-label">{label}</legend>
      <span className="sb-options">
        {options.map((option) => (
          <label className="sb-option" data-on={chosen === option || undefined} key={option}>
            <input
              className="sr-only"
              type="radio"
              name={name}
              checked={chosen === option}
              onChange={() => paper.set(k, option)}
              onClick={() => chosen === option && paper.set(k, '')}
            />
            {option}
            {circle}
          </label>
        ))}
      </span>
    </fieldset>
  );
}

/** A photo stuck to the sheet. slot must be one of the template's slots on the server. */
export function Photo({
  slot,
  label,
  tilt = -2,
  fix = 'tape',
  icon: Icon = UserRound,
}: {
  slot: string;
  label: string;
  tilt?: number;
  fix?: 'tape' | 'clip';
  icon?: LucideIcon;
}) {
  const paper = useContext(PaperContext);
  const id = useId();
  const url = paper.photos[slot];
  const picture = url ? (
    <img src={url} alt={label} />
  ) : (
    <span className="sb-photo-empty">
      <Icon aria-hidden="true" strokeWidth={1.25} className="size-14" />
      {paper.readOnly ? 'Kein Foto' : 'Foto wählen'}
    </span>
  );
  return (
    <figure className="sb-photo" style={{ '--tilt': tilt + 'deg' } as CSSProperties}>
      {fix === 'tape' ? (
        <span className="sb-tape" aria-hidden="true" />
      ) : (
        <Paperclip className="sb-clip" aria-hidden="true" strokeWidth={1.5} />
      )}
      {paper.readOnly ? (
        <span className="sb-photo-frame">{picture}</span>
      ) : (
        <label className="sb-photo-frame" htmlFor={id}>
          {picture}
        </label>
      )}
      <figcaption>{label}</figcaption>
      {!paper.readOnly && (
        <span className="sb-photo-actions">
          <input
            id={id}
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label={label + (url ? ' tauschen' : ' wählen')}
            disabled={paper.busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.currentTarget.value = '';
              if (file) paper.pick(slot, file);
            }}
          />
          {url && (
            <button type="button" className={btn.text} disabled={paper.busy} onClick={() => paper.pick(slot, null)}>
              Entfernen
            </button>
          )}
        </span>
      )}
    </figure>
  );
}

const Stamp = () => (
  <svg className="sb-stamp" viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="55" />
    <circle cx="60" cy="60" r="47" strokeDasharray="2 5" />
    <path d="M30 76h60M30 44h60" />
    <text x="60" y="69" textAnchor="middle">
      ABI 27
    </text>
    <path d="m52 30 8-10 8 10M52 90l8 10 8-10" />
  </svg>
);
const Squiggle = () => (
  <svg className="sb-squiggle" viewBox="0 0 240 14" preserveAspectRatio="none" aria-hidden="true">
    <path d="M3 9c18-9 28 7 46 0s28-8 46-1 28 6 46 0 30-8 48-1 28 5 48-2" />
  </svg>
);
const Star = ({ className = '' }: { className?: string }) => (
  <svg className={'sb-doodle ' + className} viewBox="0 0 48 48" aria-hidden="true">
    <path d="M24 5c2 8 4 12 6 14 3 1 8 1 14 2-6 3-10 6-11 8 0 3 1 8 3 14-5-4-9-7-12-7-3 0-7 3-12 7 2-6 3-11 3-14-1-2-5-5-11-8 6-1 11-1 14-2 2-2 4-6 6-14Z" />
  </svg>
);
const Swoosh = ({ className = '' }: { className?: string }) => (
  <svg className={'sb-doodle ' + className} viewBox="0 0 90 48" aria-hidden="true">
    <path d="M4 10c14 22 40 30 74 22M66 22l13 10-15 8" />
  </svg>
);

type Template = { sheets: { title: string; content: ReactNode }[] };

// Photo slots here must match steckbriefSlots["standard"] in categories.go.
const standard: Template = {
  sheets: [
    {
      title: 'Das bin ich',
      content: (
        <>
          <div className="sb-masthead">
            <p className="sb-title">
              Steckbrief
              <Squiggle />
            </p>
            <Stamp />
          </div>
          <div className="sb-photos">
            <Photo slot="foto" label="Heute" tilt={-2.5} />
            <Swoosh className="sb-swoosh" />
            <Photo slot="kinderfoto" label="Damals" tilt={2} fix="clip" icon={Baby} />
          </div>
          <div className="sb-grid">
            <Line k="name" label="Name" placeholder="Wie du in der Zeitung stehen willst" wide />
            <Line k="spitzname" label="Spitzname" placeholder="So nennt mich jeder" />
            <Line k="geburtstag" label="Geburtstag" placeholder="TT.MM." max={20} />
            <Line k="fehltage" label="Fehltage (geschätzt)" placeholder="Ehrlich bleiben" max={40} />
            <Line k="verspaetungen" label="Davon verschlafen" placeholder="Ungefähr …" max={40} />
          </div>
        </>
      ),
    },
    {
      title: 'Lieblingsdinge',
      content: (
        <>
          <Star className="sb-star" />
          <div className="sb-grid">
            <Line k="lieblingsfach" label="Lieblingsfach" placeholder="Pause zählt nicht" />
            <Line k="hassfach" label="Hassfach" placeholder="Nie wieder" />
            <Line k="lieblingsessen" label="Lieblingsessen" placeholder="Am liebsten jeden Tag" />
            <Line k="pausensnack" label="Pausensnack" placeholder="Bäcker oder Brotdose?" />
            <Line k="lieblingsort" label="Lieblingsort in der Schule" placeholder="Wo man mich findet" wide />
            <Line k="song" label="Soundtrack meiner Schulzeit" placeholder="Song und Interpret" wide />
            <Pick
              k="typ_morgen"
              label="Morgens bin ich"
              options={['hellwach', 'körperlich anwesend', 'noch im Bett']}
            />
            <Pick k="typ_reihe" label="Mein Platz" options={['erste Reihe', 'goldene Mitte', 'letzte Reihe']} />
            <Pick
              k="typ_hausaufgaben"
              label="Hausaufgaben"
              options={['gemacht', 'im Bus gemacht', 'welche Hausaufgaben?']}
            />
          </div>
        </>
      ),
    },
    {
      title: 'Und sonst so?',
      content: (
        <div className="sb-grid">
          <Lines k="in_zehn_jahren" label="In zehn Jahren bin ich …" placeholder="Träum ruhig groß" />
          <Lines k="ohne" label="Ohne … hätte ich das Abi nie geschafft" placeholder="Person, Getränk, App …" />
          <Lines k="ausrede" label="Meine beste Ausrede" placeholder="Der Bus war es natürlich nie" />
          <Lines k="vermissen" label="Das werde ich vermissen" />
          <Lines k="nicht_vermissen" label="Das garantiert nicht" />
          <Lines k="letzte_worte" label="Letzte Worte an den Jahrgang" rows={3} max={400} />
          <Line k="unterschrift" label="Unterschrift" placeholder="Hier unterschreiben" max={60} />
        </div>
      ),
    },
  ],
};
const templates: Record<string, Template> = { standard };

function parse(body?: string): Answers {
  try {
    const value: unknown = JSON.parse(body || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}
// Stable key order and no empty answers, so an unchanged sheet serializes identically.
const serialize = (answers: Answers) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(answers)
        .map(([key, value]) => [key, value.trim()] as const)
        .filter(([, value]) => value)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );

export function Steckbrief({
  category,
  submission,
  readOnly = false,
}: {
  category: Category;
  submission?: Submission;
  readOnly?: boolean;
}) {
  const template = templates[category.template || 'standard'] ?? standard;
  const count = template.sheets.length;
  const navigate = useNavigate();
  const action = useAction();
  const idempotencyKey = useRef(crypto.randomUUID());
  const tabs = useId();
  // The record this form last wrote; the prop catches up after the refetch.
  const [saved, setSaved] = useState<Submission>();
  const current = saved && (!submission || saved.version >= submission.version) ? saved : submission;
  const [answers, setAnswers] = useState(() => parse(submission?.body));
  const [picked, setPicked] = useState<Record<string, { file: File; url: string } | null>>({});
  const [dirty, setDirty] = useState(false);
  const [top, setTop] = useState({ index: 0, left: -1, forward: true });
  const go = (index: number) =>
    index !== top.index &&
    index >= 0 &&
    index < count &&
    setTop({ index, left: top.index, forward: index > top.index });

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const photos: Record<string, string | undefined> = {};
  for (const attachment of current?.attachments ?? []) photos[attachment.caption] = attachment.preview_url;
  for (const [slot, choice] of Object.entries(picked)) photos[slot] = choice?.url;

  const paper: Paper = {
    answers,
    photos,
    readOnly,
    busy: action.busy,
    set: (key, value) => {
      setAnswers((previous) => ({ ...previous, [key]: value }));
      setDirty(true);
    },
    pick: (slot, file) => {
      if (file && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
        return void toast.error('Bitte ein JPEG, PNG oder WebP wählen.');
      if (file && file.size > 20 * 1024 * 1024) return void toast.error('Das Foto darf höchstens 20 MiB groß sein.');
      if (picked[slot]) URL.revokeObjectURL(picked[slot].url);
      setPicked((previous) => ({ ...previous, [slot]: file && { file, url: URL.createObjectURL(file) } }));
      setDirty(true);
    },
  };

  const save = () =>
    action.run(async () => {
      const body = serialize(answers);
      const text = { title: 'Steckbrief', body, context: '' };
      let record: Submission = current
        ? serialize(parse(current.body)) === body
          ? current
          : await api<Submission>(
              '/submissions/' + current.id,
              json('PATCH', { version: current.version, category_id: current.category_id, ...text }),
            )
        : await api<Submission>(
            '/submissions',
            json('POST', { idempotency_key: idempotencyKey.current, category_id: category.id, ...text }),
          );
      setSaved(record);
      // Every write bumps the version, so photo changes chain on the latest record one by one.
      for (const [slot, choice] of Object.entries(picked)) {
        if (choice) {
          const upload = new FormData();
          upload.set('file', choice.file);
          upload.set('version', String(record.version));
          upload.set('caption', slot);
          record = await api<Submission>('/submissions/' + record.id + '/attachments', {
            method: 'POST',
            body: upload,
          });
        } else {
          const old = record.attachments.find((attachment) => attachment.caption === slot);
          if (old)
            record = await api<Submission>(
              '/submissions/' + record.id + '/attachments/' + old.id,
              json('DELETE', { version: record.version }),
            );
        }
        setSaved(record);
        setPicked((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== slot)));
      }
      setDirty(false);
      if (!submission) navigate('/beitraege/' + record.id, { replace: true });
    }, 'Steckbrief gespeichert.');

  return (
    <PaperContext.Provider value={paper}>
      <form
        className={'sb' + (readOnly ? ' sb-read' : '')}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {!readOnly && (
          <div className="sb-tabs" role="tablist" aria-label="Blätter des Steckbriefs">
            {template.sheets.map((sheet, index) => (
              <button
                type="button"
                role="tab"
                id={tabs + 'tab' + index}
                aria-controls={tabs + 'sheet' + index}
                aria-selected={index === top.index}
                className="sb-tab"
                key={sheet.title}
                onClick={() => go(index)}
              >
                <span className="sb-tab-number">{index + 1}</span>
                <span className="sb-tab-title">{sheet.title}</span>
              </button>
            ))}
          </div>
        )}
        <div className="sb-stack">
          {template.sheets.map((sheet, index) => {
            const depth = (index - top.index + count) % count;
            const stacked = !readOnly;
            return (
              <section
                key={sheet.title}
                id={tabs + 'sheet' + index}
                role={stacked ? 'tabpanel' : undefined}
                aria-labelledby={stacked ? tabs + 'tab' + index : undefined}
                aria-label={stacked ? undefined : sheet.title}
                className="sb-sheet"
                data-depth={stacked ? Math.min(depth, 3) : undefined}
                data-move={
                  !stacked
                    ? undefined
                    : top.forward && index === top.left
                      ? 'back'
                      : !top.forward && index === top.index && top.left >= 0
                        ? 'front'
                        : undefined
                }
                inert={stacked && depth !== 0}
              >
                <header className="sb-sheet-head">
                  <h2>{sheet.title}</h2>
                  <span>
                    Blatt {index + 1}/{count}
                  </span>
                </header>
                {sheet.content}
              </section>
            );
          })}
        </div>
        {!readOnly && (
          <>
            {action.feedback}
            <div className="sb-bar">
              <span className="flex gap-2">
                <button
                  type="button"
                  className="sb-flip"
                  aria-label="Vorheriges Blatt"
                  disabled={top.index === 0}
                  onClick={() => go(top.index - 1)}
                >
                  <ChevronLeft aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="sb-flip"
                  aria-label="Nächstes Blatt"
                  disabled={top.index === count - 1}
                  onClick={() => go(top.index + 1)}
                >
                  <ChevronRight aria-hidden="true" />
                </button>
              </span>
              <button className={btn.primary} disabled={action.busy || (!!current && !dirty)}>
                {action.busy
                  ? 'Wird gespeichert …'
                  : !current
                    ? 'Steckbrief abgeben'
                    : dirty
                      ? 'Änderungen speichern'
                      : 'Gespeichert'}{' '}
                <Arrow />
              </button>
            </div>
            <p className="mt-3 text-sm text-muted">
              Du musst nicht alles auf einmal ausfüllen. Solange dein Steckbrief eingereicht ist, kannst du ihn
              jederzeit ergänzen. Nur du und die Redaktion sehen ihn.
            </p>
          </>
        )}
      </form>
    </PaperContext.Provider>
  );
}
