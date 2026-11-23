import type { components } from './generated/api';
import { ApiError } from './api';
import type {
  Area,
  Attachment,
  AuditEvent,
  BallotAudit,
  Category,
  Consent,
  Correction,
  Document,
  Me,
  MyBallot,
  PollOption,
  PollResult,
  Revision,
  Submission,
  SystemStatus,
  Ticket,
  TicketDetail,
  TicketEvent,
  TicketReview,
  User,
  UserRef,
  WordEntry,
} from './api-types';

type EmailStatus = components['schemas']['EmailStatus'];
type EmailMessage = components['schemas']['EmailMessage'];
type EmailMessageDetail = components['schemas']['EmailMessageDetail'];
type EmailPolicy = components['schemas']['EmailPolicy'];
type CategoryInput = components['schemas']['CategoryInput'];
type CategoryEdit = components['schemas']['CategoryEdit'];
type TicketInput = components['schemas']['TicketInput'];
type TicketEdit = components['schemas']['TicketEdit'];
type DocumentInput = components['schemas']['DocumentInput'];
type DocumentEdit = components['schemas']['DocumentEdit'];
type Passkey = { id: string; name: string | null; created_at: string };

const STORAGE_ACCOUNT_KEY = 'abizeit-preview-account';
const STORAGE_CONSENT_KEY = 'abizeit-preview-consent-required';

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const daysAhead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

let idSeq = 1000;
const nextUUID = () => {
  idSeq += 1;
  return `90000000-0000-4000-8000-${String(idSeq).padStart(12, '0')}`;
};

const svgPhoto = (width: number, height: number, bg1: string, bg2: string, label: string, sub: string) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${bg1}"/>
        <stop offset="100%" stop-color="${bg2}"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${Math.round(width * 0.78)}" cy="${Math.round(height * 0.24)}" r="${Math.round(Math.min(width, height) * 0.16)}" fill="rgba(255,255,255,0.22)"/>
    <rect x="32" y="${height - 130}" width="${width - 64}" height="96" rx="18" fill="rgba(20,24,20,0.34)"/>
    <text x="56" y="${height - 82}" font-family="system-ui,-apple-system,sans-serif" font-size="30" font-weight="700" fill="#fff">${label}</text>
    <text x="56" y="${height - 48}" font-family="system-ui,-apple-system,sans-serif" font-size="20" fill="rgba(255,255,255,0.88)">${sub}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const MANAGER_ID = '00000000-0000-4000-8000-000000000002';
const MIA_ID = '00000000-0000-4000-8000-000000000003';
const LEON_ID = '00000000-0000-4000-8000-000000000004';
const GUEST_ID = '00000000-0000-4000-8000-000000000005';
const PENDING_ID = '00000000-0000-4000-8000-000000000006';

const CAT_IDEEN = '10000000-0000-4000-8000-000000000001';
const CAT_ZITATE = '10000000-0000-4000-8000-000000000002';
const CAT_ERINNERUNGEN = '10000000-0000-4000-8000-000000000003';
const CAT_FOTOS = '10000000-0000-4000-8000-000000000004';
const CAT_STECKBRIEF = '10000000-0000-4000-8000-000000000005';

const POLL_MOTTO = '30000000-0000-4000-8000-000000000001';
const POLL_SPRUCH = '30000000-0000-4000-8000-000000000002';
const POLL_COVER = '30000000-0000-4000-8000-000000000003';
const POLL_WORDS = '30000000-0000-4000-8000-000000000004';
const POLL_CLOSED = '30000000-0000-4000-8000-000000000005';
const POLL_FREISTUNDE = '30000000-0000-4000-8000-000000000006';
const POLL_MOTTOWOCHE = '30000000-0000-4000-8000-000000000007';

const AREA_REDAKTION = '60000000-0000-4000-8000-000000000001';
const AREA_IDEEN = '60000000-0000-4000-8000-000000000002';
const AREA_ZITATE = '60000000-0000-4000-8000-000000000003';
const AREA_FOTOS = '60000000-0000-4000-8000-000000000004';
const AREA_LAYOUT = '60000000-0000-4000-8000-000000000005';
const AREA_ORGA = '60000000-0000-4000-8000-000000000008';

export const PREVIEW_ACCOUNTS = [
  { id: MIA_ID, label: 'Mia Weber', badge: 'Schüler:in' },
  { id: MANAGER_ID, label: 'Sam (Redaktion)', badge: 'Redaktion' },
  { id: ADMIN_ID, label: 'Alex (Admin)', badge: 'Admin' },
  { id: GUEST_ID, label: 'Kim (Gast)', badge: 'Gast' },
  { id: PENDING_ID, label: 'Pat', badge: 'Wartend' },
  { id: null, label: 'Abgemeldet', badge: 'Login' },
] as const;

type BallotRecord = {
  id: string;
  poll_id: string;
  user_id: string;
  option_ids: string[];
  words: string[];
  created_at: string;
};

type MockStore = {
  currentUserId: string | null;
  consentRequired: boolean;
  users: User[];
  categories: Category[];
  ballots: BallotRecord[];
  ballotAudit: Record<string, BallotAudit[]>;
  words: Record<string, WordEntry[]>;
  submissions: Submission[];
  revisions: Record<string, Revision[]>;
  corrections: Record<string, Correction[]>;
  areas: Area[];
  tickets: Ticket[];
  ticketEvents: Record<string, TicketEvent[]>;
  nextTicketNumber: number;
  documents: Document[];
  readDocs: Record<string, Set<string>>;
  auditEvents: AuditEvent[];
  reminderPrefs: Record<string, boolean>;
  passkeys: Record<string, Passkey[]>;
  emailStatus: EmailStatus;
  emailMessages: EmailMessage[];
};

const CONSENT_VERSION = 'entwurf-2026-11-16';
const CONSENT_TEXT = [
  'Vorschau-Modus: Diese Instanz läuft vollständig im Browser mit Beispieldaten (kein echtes Backend).',
  'Ich willige ein, dass meine Beiträge, Fotos und Bildunterschriften in diesem Portal gespeichert werden und dass die Redaktion sie für die gedruckte Abizeitung des Jahrgangs 2027 auswählen, kürzen und veröffentlichen darf.',
  'Ich weiß, dass meine Stimmen in Abstimmungen mit meinem Namen gespeichert werden. Die Redaktion sieht nur Ergebnisse. Nur die Administration kann einsehen, wer wie abgestimmt hat.',
  'Ich kann diese Einwilligung jederzeit widerrufen und die Löschung meiner Daten verlangen.',
];

function createInitialStore(initialAccountId: string | null, initialConsentRequired: boolean): MockStore {
  const users: User[] = [
    {
      id: ADMIN_ID,
      name: 'Alex (Administration)',
      role: 'admin',
      admitted: true,
      cohort_member: true,
      category_ids: [],
      created_at: daysAgo(45),
    },
    {
      id: MANAGER_ID,
      name: 'Sam (Redaktion)',
      role: 'manager',
      admitted: true,
      cohort_member: true,
      category_ids: [CAT_IDEEN, CAT_FOTOS, POLL_MOTTO, POLL_SPRUCH, POLL_COVER, POLL_WORDS],
      created_at: daysAgo(42),
    },
    {
      id: MIA_ID,
      name: 'Mia Weber',
      role: 'student',
      admitted: true,
      cohort_member: true,
      category_ids: [],
      created_at: daysAgo(35),
    },
    {
      id: LEON_ID,
      name: 'Leon Fischer',
      role: 'student',
      admitted: true,
      cohort_member: true,
      category_ids: [],
      created_at: daysAgo(33),
    },
    {
      id: GUEST_ID,
      name: 'Kim (Gast)',
      role: 'student',
      admitted: true,
      cohort_member: false,
      category_ids: [],
      created_at: daysAgo(20),
    },
    {
      id: PENDING_ID,
      name: 'Pat (Freigabe ausstehend)',
      role: 'student',
      admitted: false,
      cohort_member: false,
      category_ids: [],
      created_at: daysAgo(2),
    },
  ];

  const categories: Category[] = [
    {
      id: CAT_IDEEN,
      name: 'Ideen',
      description: 'Vorschläge für unsere Abizeitung',
      kind: 'idea',
      template: '',
      repeatable: true,
      ongoing: true,
      closes_at: null,
      status: 'open',
      allow_self_vote: false,
      all_people: false,
      max_choices: 1,
      version: 1,
      created_at: daysAgo(30),
      opened_at: daysAgo(30),
      options: [],
      my_option_id: null,
      my_option_ids: [],
      my_words: [],
      ballot_count: null,
      participation: null,
    },
    {
      id: CAT_ZITATE,
      name: 'Zitate',
      description: 'Sprüche, die bleiben',
      kind: 'quote',
      template: '',
      repeatable: true,
      ongoing: true,
      closes_at: null,
      status: 'open',
      allow_self_vote: false,
      all_people: false,
      max_choices: 1,
      version: 1,
      created_at: daysAgo(28),
      opened_at: daysAgo(28),
      options: [],
      my_option_id: null,
      my_option_ids: [],
      my_words: [],
      ballot_count: null,
      participation: null,
    },
    {
      id: CAT_ERINNERUNGEN,
      name: 'Erinnerungen',
      description: 'Unsere gemeinsame Schulzeit',
      kind: 'memory',
      template: '',
      repeatable: true,
      ongoing: true,
      closes_at: null,
      status: 'open',
      allow_self_vote: false,
      all_people: false,
      max_choices: 1,
      version: 1,
      created_at: daysAgo(26),
      opened_at: daysAgo(26),
      options: [],
      my_option_id: null,
      my_option_ids: [],
      my_words: [],
      ballot_count: null,
      participation: null,
    },
    {
      id: CAT_FOTOS,
      name: 'Fotos',
      description: 'Eure schönsten Momente in Originalqualität',
      kind: 'photo',
      template: '',
      repeatable: true,
      ongoing: true,
      closes_at: null,
      status: 'open',
      allow_self_vote: false,
      all_people: false,
      max_choices: 1,
      version: 1,
      created_at: daysAgo(25),
      opened_at: daysAgo(25),
      options: [],
      my_option_id: null,
      my_option_ids: [],
      my_words: [],
      ballot_count: null,
      participation: null,
    },
    {
      id: CAT_STECKBRIEF,
      name: 'Steckbrief',
      description: 'Dein Platz in der Abizeitung',
      kind: 'steckbrief',
      template: 'standard',
      repeatable: false,
      ongoing: false,
      closes_at: daysAhead(21),
      status: 'open',
      allow_self_vote: false,
      all_people: false,
      max_choices: 1,
      version: 1,
      created_at: daysAgo(22),
      opened_at: daysAgo(22),
      options: [],
      my_option_id: null,
      my_option_ids: [],
      my_words: [],
      ballot_count: null,
      participation: null,
    },
    {
      id: POLL_MOTTO,
      name: 'Unser Abimotto',
      description: 'Welche Idee passt zu uns?',
      kind: 'proposal',
      template: '',
      repeatable: false,
      ongoing: false,
      closes_at: daysAhead(10),
      status: 'open',
      allow_self_vote: false,
      all_people: false,
      max_choices: 1,
      version: 2,
      created_at: daysAgo(20),
      opened_at: daysAgo(18),
      options: [
        { id: '40000000-0000-4000-8000-000000000101', label: 'Abizeitbetrug – 13 Jahre abgesessen' },
        { id: '40000000-0000-4000-8000-000000000102', label: 'ABIversal – ein Jahrgang, viele Welten' },
        { id: '40000000-0000-4000-8000-000000000103', label: 'Abikalypse – wir sind raus' },
      ],
      my_option_id: null,
      my_option_ids: [],
      my_words: [],
      ballot_count: null,
      participation: null,
    },
    {
      id: POLL_SPRUCH,
      name: 'Wer hat immer einen guten Spruch?',
      description: 'Ein liebevolles Jahrgangsranking. Keine Selbstwahl.',
      kind: 'person',
      template: '',
      repeatable: false,
      ongoing: false,
      closes_at: daysAhead(14),
      status: 'open',
      allow_self_vote: false,
      all_people: true,
      max_choices: 2,
      version: 2,
      created_at: daysAgo(12),
      opened_at: daysAgo(9),
      options: [
        { id: '40000000-0000-4000-8000-000000000201', label: 'Alex (Administration)', user_id: ADMIN_ID },
        { id: '40000000-0000-4000-8000-000000000202', label: 'Leon Fischer', user_id: LEON_ID },
        { id: '40000000-0000-4000-8000-000000000203', label: 'Mia Weber', user_id: MIA_ID },
        { id: '40000000-0000-4000-8000-000000000204', label: 'Sam (Redaktion)', user_id: MANAGER_ID },
      ],
      my_option_id: null,
      my_option_ids: [],
      my_words: [],
      ballot_count: null,
      participation: null,
    },
    {
      id: POLL_WORDS,
      name: 'Unser Jahrgang in 3 Wörtern',
      description: 'Schreib bis zu drei Begriffe, die uns am besten beschreiben.',
      kind: 'words',
      template: '',
      repeatable: false,
      ongoing: false,
      closes_at: daysAhead(18),
      status: 'open',
      allow_self_vote: false,
      all_people: false,
      max_choices: 3,
      version: 2,
      created_at: daysAgo(8),
      opened_at: daysAgo(6),
      options: [],
      my_option_id: null,
      my_option_ids: [],
      my_words: [],
      ballot_count: null,
      participation: null,
    },
    {
      id: POLL_FREISTUNDE,
      name: 'Bester Ort in der Freistunde',
      description: 'Wo findet man dich zwischen zwei Kursen am ehesten?',
      kind: 'proposal',
      template: '',
      repeatable: false,
      ongoing: false,
      closes_at: daysAhead(6),
      status: 'open',
      allow_self_vote: false,
      all_people: false,
      max_choices: 1,
      version: 2,
      created_at: daysAgo(7),
      opened_at: daysAgo(4),
      options: [
        { id: '40000000-0000-4000-8000-000000000601', label: 'Bäcker an der Ecke' },
        { id: '40000000-0000-4000-8000-000000000602', label: 'Oberstufenraum' },
        { id: '40000000-0000-4000-8000-000000000603', label: 'Bibliothek (angeblich lernen)' },
        { id: '40000000-0000-4000-8000-000000000604', label: 'Pausenhof in der Sonne' },
      ],
      my_option_id: null,
      my_option_ids: [],
      my_words: [],
      ballot_count: null,
      participation: null,
    },
    {
      id: POLL_MOTTOWOCHE,
      name: 'Lieblingstag der Mottowoche',
      description: 'Welches Thema darf auf keinen Fall fehlen?',
      kind: 'proposal',
      template: '',
      repeatable: false,
      ongoing: false,
      closes_at: daysAhead(8),
      status: 'open',
      allow_self_vote: false,
      all_people: false,
      max_choices: 1,
      version: 2,
      created_at: daysAgo(15),
      opened_at: daysAgo(14),
      options: [
        { id: '40000000-0000-4000-8000-000000000701', label: 'Kindheitshelden' },
        { id: '40000000-0000-4000-8000-000000000702', label: 'Erster Schultag' },
        { id: '40000000-0000-4000-8000-000000000703', label: 'Zeitreise 2000er' },
        { id: '40000000-0000-4000-8000-000000000704', label: 'Alles außer Rucksack' },
      ],
      my_option_id: null,
      my_option_ids: [],
      my_words: [],
      ballot_count: null,
      participation: null,
    },
    {
      id: POLL_COVER,
      name: 'Die Farbe unseres Covers',
      description: 'Redaktionsentwurf – noch nicht veröffentlicht',
      kind: 'proposal',
      template: '',
      repeatable: false,
      ongoing: true,
      closes_at: null,
      status: 'draft',
      allow_self_vote: false,
      all_people: false,
      max_choices: 1,
      version: 1,
      created_at: daysAgo(3),
      opened_at: null,
      options: [
        { id: '40000000-0000-4000-8000-000000000301', label: 'Mitternachtsblau' },
        { id: '40000000-0000-4000-8000-000000000302', label: 'Sonnengelb' },
      ],
      my_option_id: null,
      my_option_ids: [],
      my_words: [],
      ballot_count: null,
      participation: null,
    },
    {
      id: POLL_CLOSED,
      name: 'Beste Erinnerung aus der 11. Klasse',
      description: 'Abgeschlossene Testabstimmung',
      kind: 'proposal',
      template: '',
      repeatable: false,
      ongoing: false,
      closes_at: daysAgo(2),
      status: 'closed',
      allow_self_vote: false,
      all_people: false,
      max_choices: 1,
      version: 3,
      created_at: daysAgo(25),
      opened_at: daysAgo(24),
      options: [
        { id: '40000000-0000-4000-8000-000000000501', label: 'Sommerfest auf dem Pausenhof' },
        { id: '40000000-0000-4000-8000-000000000502', label: 'Skifahrt im Februar' },
      ],
      my_option_id: null,
      my_option_ids: [],
      my_words: [],
      ballot_count: null,
      participation: null,
    },
  ];

  const wordEntries: WordEntry[] = [
    {
      option_id: '40000000-0000-4000-8000-000000000401',
      word: 'chaotisch',
      label: 'chaotisch',
      count: 2,
      excluded: false,
      version: 1,
    },
    {
      option_id: '40000000-0000-4000-8000-000000000402',
      word: 'laut',
      label: 'laut',
      count: 2,
      excluded: false,
      version: 1,
    },
    {
      option_id: '40000000-0000-4000-8000-000000000403',
      word: 'herzlich',
      label: 'herzlich',
      count: 1,
      excluded: false,
      version: 1,
    },
    {
      option_id: '40000000-0000-4000-8000-000000000404',
      word: 'kaffee',
      label: 'kaffee',
      count: 1,
      excluded: false,
      version: 1,
    },
  ];

  const ballots: BallotRecord[] = [
    {
      id: '80000000-0000-4000-8000-000000000001',
      poll_id: POLL_MOTTO,
      user_id: LEON_ID,
      option_ids: ['40000000-0000-4000-8000-000000000101'],
      words: [],
      created_at: daysAgo(5),
    },
    {
      id: '80000000-0000-4000-8000-000000000002',
      poll_id: POLL_MOTTO,
      user_id: MANAGER_ID,
      option_ids: ['40000000-0000-4000-8000-000000000102'],
      words: [],
      created_at: daysAgo(4),
    },
    {
      id: '80000000-0000-4000-8000-000000000003',
      poll_id: POLL_SPRUCH,
      user_id: LEON_ID,
      option_ids: ['40000000-0000-4000-8000-000000000203'],
      words: [],
      created_at: daysAgo(3),
    },
    {
      id: '80000000-0000-4000-8000-000000000004',
      poll_id: POLL_WORDS,
      user_id: LEON_ID,
      option_ids: [
        '40000000-0000-4000-8000-000000000401',
        '40000000-0000-4000-8000-000000000402',
        '40000000-0000-4000-8000-000000000403',
      ],
      words: ['chaotisch', 'laut', 'herzlich'],
      created_at: daysAgo(3),
    },
    {
      id: '80000000-0000-4000-8000-000000000005',
      poll_id: POLL_WORDS,
      user_id: MANAGER_ID,
      option_ids: [
        '40000000-0000-4000-8000-000000000401',
        '40000000-0000-4000-8000-000000000402',
        '40000000-0000-4000-8000-000000000404',
      ],
      words: ['chaotisch', 'laut', 'kaffee'],
      created_at: daysAgo(2),
    },
    {
      id: '80000000-0000-4000-8000-000000000006',
      poll_id: POLL_CLOSED,
      user_id: MIA_ID,
      option_ids: ['40000000-0000-4000-8000-000000000501'],
      words: [],
      created_at: daysAgo(7),
    },
    {
      id: '80000000-0000-4000-8000-000000000007',
      poll_id: POLL_MOTTOWOCHE,
      user_id: MIA_ID,
      option_ids: ['40000000-0000-4000-8000-000000000704'],
      words: [],
      created_at: daysAgo(2),
    },
  ];

  const photo1 = svgPhoto(960, 720, '#2e5948', '#8fb573', 'Kursfahrt Gardasee', 'Abends am See · Demo-Foto');
  const photo2 = svgPhoto(720, 960, '#3a4f7a', '#9ab3d5', 'Letzter Wandertag', 'Gipfelpause · Demo-Foto');
  const photo3 = svgPhoto(840, 840, '#9c523b', '#e2a36b', 'Pausenhof-Sommer', 'Nach der Mathe-LK-Klausur');

  const submissions: Submission[] = [
    {
      id: '20000000-0000-4000-8000-000000000001',
      category_id: CAT_IDEEN,
      author_id: MIA_ID,
      author_name: 'Mia Weber',
      title: 'Eine Playlist für unseren Jahrgang',
      body: 'Jede Person wählt einen Song, der an die Schulzeit erinnert – mit QR-Code auf der letzten Seite.',
      context: 'Idee für die letzte Seite',
      status: 'pending',
      version: 1,
      attachments: [],
      created_at: daysAgo(6),
      updated_at: daysAgo(6),
    },
    {
      id: '20000000-0000-4000-8000-000000000002',
      category_id: CAT_ZITATE,
      author_id: LEON_ID,
      author_name: 'Leon Fischer',
      title: 'Herr Dr. Müller',
      body: 'Das kommt garantiert nicht in der Klausur dran.',
      context: 'Mathe-LK, eine Woche vor den Ferien',
      status: 'accepted',
      version: 2,
      attachments: [],
      created_at: daysAgo(9),
      updated_at: daysAgo(5),
    },
    {
      id: '20000000-0000-4000-8000-000000000003',
      category_id: CAT_ERINNERUNGEN,
      author_id: MIA_ID,
      author_name: 'Mia Weber',
      title: 'Die Nacht vor der Kursfahrt',
      body: 'Niemand hatte gepackt. Um halb zwei morgens wurden noch Ladekabel getauscht – und im Bus waren trotzdem alle wach.',
      context: 'Kursfahrt 2025',
      status: 'accepted',
      version: 1,
      attachments: [],
      created_at: daysAgo(11),
      updated_at: daysAgo(10),
    },
    {
      id: '20000000-0000-4000-8000-000000000004',
      category_id: CAT_FOTOS,
      author_id: MIA_ID,
      author_name: 'Mia Weber',
      title: 'Kursfahrt & Pausenhof',
      body: '',
      context: 'Sommer 2026',
      status: 'pending',
      version: 1,
      attachments: [
        {
          id: '50000000-0000-4000-8000-000000000001',
          filename: 'gardasee.jpg',
          mime_type: 'image/svg+xml',
          size_bytes: 184200,
          caption: 'Sonnenuntergang am letzten Abend der Kursfahrt',
          url: photo1,
          preview_url: photo1,
        },
        {
          id: '50000000-0000-4000-8000-000000000002',
          filename: 'pausenhof.jpg',
          mime_type: 'image/svg+xml',
          size_bytes: 142900,
          caption: 'Nach der letzten Mathe-Klausur',
          url: photo3,
          preview_url: photo3,
        },
      ],
      created_at: daysAgo(3),
      updated_at: daysAgo(3),
    },
    {
      id: '20000000-0000-4000-8000-000000000005',
      category_id: CAT_FOTOS,
      author_id: LEON_ID,
      author_name: 'Leon Fischer',
      title: 'Unser letzter Wandertag',
      body: '',
      context: 'Gemeinsam unterwegs',
      status: 'pending',
      version: 1,
      attachments: [
        {
          id: '50000000-0000-4000-8000-000000000003',
          filename: 'wandertag.jpg',
          mime_type: 'image/svg+xml',
          size_bytes: 210400,
          caption: 'Kurze Pause vor dem letzten Anstieg',
          url: photo2,
          preview_url: photo2,
        },
      ],
      created_at: daysAgo(2),
      updated_at: daysAgo(2),
    },
  ];

  const revisions: Record<string, Revision[]> = {};
  for (const s of submissions) {
    revisions[s.id] = [
      {
        id: nextUUID(),
        version: s.version,
        actor_name: s.author_name,
        title: s.title,
        body: s.body,
        context: s.context,
        status: s.status,
        attachments: s.attachments,
        created_at: s.updated_at,
      },
    ];
  }

  const corrections: Record<string, Correction[]> = {
    '20000000-0000-4000-8000-000000000001': [
      {
        id: nextUUID(),
        submission_id: '20000000-0000-4000-8000-000000000001',
        author_name: 'Sam (Redaktion)',
        body: 'Super Idee! Können wir als Spotify- und Apple-Music-Link testen.',
        resolved: false,
        created_at: daysAgo(2),
      },
    ],
  };

  const areas: Area[] = [
    {
      id: AREA_REDAKTION,
      name: 'Redaktion',
      position: 1,
      version: 1,
      reviewers: [{ id: MANAGER_ID, name: 'Sam (Redaktion)' }],
    },
    { id: AREA_IDEEN, name: 'Ideen', position: 2, version: 1, reviewers: [] },
    { id: AREA_ZITATE, name: 'Zitate', position: 3, version: 1, reviewers: [] },
    {
      id: AREA_FOTOS,
      name: 'Fotos',
      position: 4,
      version: 1,
      reviewers: [{ id: MANAGER_ID, name: 'Sam (Redaktion)' }],
    },
    {
      id: AREA_LAYOUT,
      name: 'Layout',
      position: 5,
      version: 1,
      reviewers: [{ id: ADMIN_ID, name: 'Alex (Administration)' }],
    },
    { id: AREA_ORGA, name: 'Orga', position: 8, version: 1, reviewers: [] },
  ];

  const adminRef: UserRef = { id: ADMIN_ID, name: 'Alex (Administration)' };
  const managerRef: UserRef = { id: MANAGER_ID, name: 'Sam (Redaktion)' };

  const tickets: Ticket[] = [
    {
      id: '70000000-0000-4000-8000-000000000001',
      number: 1,
      type: 'aufgabe',
      title: 'Ideenwand für die Aula auswerten',
      body: 'Alle Zettel abfotografieren und nach Themen gruppieren.',
      area_id: AREA_IDEEN,
      area_name: 'Ideen',
      assignees: [],
      created_by: managerRef,
      size: 'S',
      goal: 'Alle Vorschläge sind gesichtet und nach Machbarkeit sortiert.',
      est_pages: null,
      status: 'todo',
      round: 1,
      version: 1,
      approved: false,
      reviews: [],
      comment_count: 0,
      created_at: daysAgo(6),
      updated_at: daysAgo(6),
      status_changed_at: daysAgo(6),
    },
    {
      id: '70000000-0000-4000-8000-000000000002',
      number: 2,
      type: 'artikel',
      title: 'Lehrerzitate: Auswahl und Kürzung',
      body: 'Aus den eingesendeten Zitaten eine Doppelseite zusammenstellen.',
      area_id: AREA_ZITATE,
      area_name: 'Zitate',
      assignees: [managerRef],
      created_by: adminRef,
      size: 'M',
      goal: 'Zwei Seiten mit den besten Zitaten, geprüft und ohne Namen von Schüler:innen.',
      est_pages: 2,
      status: 'in_progress',
      round: 1,
      version: 1,
      approved: false,
      reviews: [],
      comment_count: 1,
      created_at: daysAgo(8),
      updated_at: daysAgo(4),
      status_changed_at: daysAgo(4),
    },
    {
      id: '70000000-0000-4000-8000-000000000003',
      number: 3,
      type: 'aufgabe',
      title: 'Fototermin für die Kursfahrt abstimmen',
      body: 'Termin mit Kursleitung und Fotograf:in klären.',
      area_id: AREA_FOTOS,
      area_name: 'Fotos',
      assignees: [adminRef],
      created_by: managerRef,
      size: 'S',
      goal: 'Ein Termin steht fest und alle Beteiligten haben bestätigt.',
      est_pages: null,
      status: 'in_progress',
      round: 1,
      version: 1,
      approved: false,
      reviews: [],
      comment_count: 0,
      created_at: daysAgo(5),
      updated_at: daysAgo(3),
      status_changed_at: daysAgo(3),
    },
    {
      id: '70000000-0000-4000-8000-000000000004',
      number: 4,
      type: 'artikel',
      title: 'Rückblick auf die Oberstufe',
      body: '## Entwurf\n\nErster Textentwurf liegt vor, Quellen fehlen noch.',
      area_id: AREA_REDAKTION,
      area_name: 'Redaktion',
      assignees: [adminRef],
      created_by: managerRef,
      size: 'M',
      goal: 'Drei Seiten Rückblick, redaktionell abgenommen.',
      est_pages: 3,
      status: 'review',
      round: 1,
      version: 1,
      approved: false,
      reviews: [],
      comment_count: 0,
      created_at: daysAgo(10),
      updated_at: daysAgo(2),
      status_changed_at: daysAgo(2),
    },
    {
      id: '70000000-0000-4000-8000-000000000005',
      number: 5,
      type: 'aufgabe',
      title: 'Bildformat für den Druck festlegen',
      body: 'Auflösung und Farbprofil mit der Druckerei klären.',
      area_id: AREA_FOTOS,
      area_name: 'Fotos',
      assignees: [adminRef],
      created_by: managerRef,
      size: 'XS',
      goal: 'Das Bildformat ist dokumentiert und der Druckerei bestätigt.',
      est_pages: null,
      status: 'done',
      round: 1,
      version: 1,
      approved: true,
      reviews: [{ user: managerRef, verdict: 'approve', binding: true, self_confirmed: false, updated_at: daysAgo(9) }],
      comment_count: 0,
      created_at: daysAgo(12),
      updated_at: daysAgo(9),
      status_changed_at: daysAgo(9),
    },
    {
      id: '70000000-0000-4000-8000-000000000006',
      number: 6,
      type: 'aufgabe',
      title: 'Terminplan für das Redaktionstreffen',
      body: 'Treffen bis zum Abgabetermin planen.',
      area_id: AREA_ORGA,
      area_name: 'Orga',
      assignees: [managerRef],
      created_by: adminRef,
      size: 'XS',
      goal: 'Alle Treffen bis zur Abgabe sind eingetragen.',
      est_pages: null,
      status: 'done',
      round: 1,
      version: 1,
      approved: false,
      reviews: [{ user: adminRef, verdict: 'approve', binding: false, self_confirmed: false, updated_at: daysAgo(7) }],
      comment_count: 0,
      created_at: daysAgo(9),
      updated_at: daysAgo(7),
      status_changed_at: daysAgo(7),
    },
  ];

  const ticketEvents: Record<string, TicketEvent[]> = {
    '70000000-0000-4000-8000-000000000002': [
      {
        id: nextUUID(),
        kind: 'comment',
        actor: managerRef,
        body: 'Erste Auswahl steht, ich prüfe noch zwei Zitate aus dem Bio-LK.',
        detail: '',
        created_at: daysAgo(3),
      },
    ],
  };

  const documents: Document[] = [
    {
      id: '71000000-0000-4000-8000-000000000001',
      title: 'Treffen 18.11.',
      kind: 'meeting',
      body: '## Agenda\n\n- Stand der Bereiche\n- Terminplan bis zur Abgabe\n- Druckerei: Bildformat\n\n## Ergebnis\n\n- Fotos klären bis Freitag (Sam)\n- Rückblick-Entwurf in der Review (Alex)\n- Nächstes Treffen in zwei Wochen\n',
      created_by: adminRef,
      updated_by: adminRef,
      created_at: daysAgo(4),
      updated_at: daysAgo(4),
      version: 1,
      unread: false,
    },
    {
      id: '71000000-0000-4000-8000-000000000002',
      title: 'Hinweise zum Schreiben',
      kind: 'note',
      body: 'Kurze Sätze, kein Insiderwissen ohne Erklärung.\n\nNamen von Lehrkräften nur mit Einverständnis.',
      created_by: managerRef,
      updated_by: managerRef,
      created_at: daysAgo(1),
      updated_at: daysAgo(1),
      version: 1,
      unread: false,
    },
  ];

  const emailMessages: EmailMessage[] = [
    {
      id: '91000000-0000-4000-8000-000000000001',
      kind: 'login',
      status: 'delivered',
      recipient_masked: 'm***@example.test',
      user_id: MIA_ID,
      user_name: 'Mia Weber',
      attempts: 1,
      failure_code: null,
      provider_message_id: 'preview-msg-1',
      created_at: daysAgo(1),
    },
    {
      id: '91000000-0000-4000-8000-000000000002',
      kind: 'reminder',
      status: 'accepted',
      recipient_masked: 'l***@example.test',
      user_id: LEON_ID,
      user_name: 'Leon Fischer',
      attempts: 1,
      failure_code: null,
      provider_message_id: 'preview-msg-2',
      created_at: daysAgo(2),
    },
  ];

  return {
    currentUserId: initialAccountId,
    consentRequired: initialConsentRequired,
    users,
    categories,
    ballots,
    ballotAudit: {
      [POLL_MOTTO]: [
        {
          ballot_id: '80000000-0000-4000-8000-000000000001',
          user_id: LEON_ID,
          user_name: 'Leon Fischer',
          option_id: '40000000-0000-4000-8000-000000000101',
          option_label: 'Abizeitbetrug – 13 Jahre abgesessen',
          created_at: daysAgo(5),
        },
        {
          ballot_id: '80000000-0000-4000-8000-000000000002',
          user_id: MANAGER_ID,
          user_name: 'Sam (Redaktion)',
          option_id: '40000000-0000-4000-8000-000000000102',
          option_label: 'ABIversal – ein Jahrgang, viele Welten',
          created_at: daysAgo(4),
        },
      ],
    },
    words: { [POLL_WORDS]: wordEntries },
    submissions,
    revisions,
    corrections,
    areas,
    tickets,
    ticketEvents,
    nextTicketNumber: 7,
    documents,
    readDocs: {
      [ADMIN_ID]: new Set(['71000000-0000-4000-8000-000000000001']),
      [MANAGER_ID]: new Set(['71000000-0000-4000-8000-000000000002']),
    },
    auditEvents: [
      {
        id: nextUUID(),
        actor_name: 'Alex (Administration)',
        action: 'category.opened',
        entity_id: POLL_MOTTO,
        created_at: daysAgo(18),
      },
      {
        id: nextUUID(),
        actor_name: 'Sam (Redaktion)',
        action: 'submission.accepted',
        entity_id: '20000000-0000-4000-8000-000000000002',
        created_at: daysAgo(5),
      },
      {
        id: nextUUID(),
        actor_name: 'Alex (Administration)',
        action: 'user.updated',
        entity_id: MANAGER_ID,
        created_at: daysAgo(2),
      },
    ],
    reminderPrefs: {
      [ADMIN_ID]: true,
      [MANAGER_ID]: true,
      [MIA_ID]: true,
      [LEON_ID]: false,
      [GUEST_ID]: false,
      [PENDING_ID]: false,
    },
    passkeys: {
      [MIA_ID]: [{ id: 'pk-preview-1', name: 'iPhone', created_at: daysAgo(12) }],
      [MANAGER_ID]: [{ id: 'pk-preview-2', name: 'iPad', created_at: daysAgo(8) }],
      [ADMIN_ID]: [],
    },
    emailStatus: {
      health: { pending: 0, failed: 0, last_worker_run: daysAgo(0) },
      policy: {
        daily_limit: 300,
        reminder_limit: 150,
        login_reserve: 150,
        paused: false,
        pause_all: false,
        version: 1,
      },
      provider: { name: 'preview-mock', configured: false, credits: 284, observed_at: daysAgo(0), error: null },
      usage: {
        day: new Date().toISOString().slice(0, 10),
        used: 16,
        login: 12,
        reminder: 4,
        reserved: 150,
        remaining: 284,
      },
    },
    emailMessages,
  };
}

function readStoredAccount(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_ACCOUNT_KEY);
    if (raw === 'logged_out') return null;
    if (raw && PREVIEW_ACCOUNTS.some((a) => a.id === raw)) return raw;
  } catch {
    /* ignore */
  }
  return MIA_ID;
}

function readStoredConsent(): boolean {
  try {
    return localStorage.getItem(STORAGE_CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

let store = createInitialStore(readStoredAccount(), readStoredConsent());
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export function subscribePreviewState(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getPreviewState() {
  return {
    accountId: store.currentUserId,
    consentRequired: store.consentRequired,
  };
}

export function setPreviewAccount(id: string | null) {
  store.currentUserId = id;
  try {
    localStorage.setItem(STORAGE_ACCOUNT_KEY, id ?? 'logged_out');
  } catch {
    /* ignore */
  }
  notify();
}

export function setPreviewConsentRequired(value: boolean) {
  store.consentRequired = value;
  try {
    localStorage.setItem(STORAGE_CONSENT_KEY, value ? '1' : '0');
  } catch {
    /* ignore */
  }
  notify();
}

export function resetPreviewState() {
  store = createInitialStore(store.currentUserId ?? MIA_ID, false);
  try {
    localStorage.setItem(STORAGE_CONSENT_KEY, '0');
  } catch {
    /* ignore */
  }
  notify();
}

const isEditor = (u: User) => u.role === 'manager' || u.role === 'admin';
const isBallotKind = (kind: Category['kind']) => kind === 'person' || kind === 'proposal' || kind === 'words';
const clone = <T>(v: T): T => structuredClone(v);

function requireUser(): User {
  if (!store.currentUserId) throw new ApiError(401, 'unauthenticated', 'Bitte anmelden.');
  const u = store.users.find((x) => x.id === store.currentUserId);
  if (!u) throw new ApiError(401, 'unauthenticated', 'Bitte anmelden.');
  return u;
}

function parseJsonBody<T>(init: RequestInit): T {
  if (typeof init.body !== 'string' || !init.body) return {} as T;
  return JSON.parse(init.body) as T;
}

function projectCategory(c: Category, viewer: User): Category {
  const out = clone(c);
  if (out.status === 'open' && out.closes_at && new Date(out.closes_at).getTime() <= Date.now()) {
    out.status = 'closed';
  }
  if (!isBallotKind(out.kind)) return out;
  const mine = store.ballots
    .filter((b) => b.poll_id === out.id && b.user_id === viewer.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  out.my_option_ids = mine ? [...mine.option_ids] : [];
  out.my_option_id = out.my_option_ids[0] ?? null;
  out.my_words = out.kind === 'words' && mine ? [...mine.words] : [];
  if (isEditor(viewer)) {
    const voters = new Set(store.ballots.filter((b) => b.poll_id === out.id).map((b) => b.user_id));
    const eligibleUsers = store.users.filter((u) => u.admitted && u.cohort_member);
    const eligibleSet = new Set(eligibleUsers.map((u) => u.id));
    let votedEligible = 0;
    for (const id of voters) if (eligibleSet.has(id)) votedEligible += 1;
    out.ballot_count = voters.size;
    out.participation = { eligible: eligibleUsers.length, voted: votedEligible };
  } else {
    out.ballot_count = null;
    out.participation = null;
  }
  return out;
}

function recomputeTicketApproved(t: Ticket) {
  const validEditor = (uid: string) => {
    const u = store.users.find((x) => x.id === uid);
    return !!u && u.admitted && isEditor(u);
  };
  t.approved = t.reviews.some((r) => r.verdict === 'approve' && r.binding && validEditor(r.user.id));
}

function normalizeWord(raw: string): string {
  const cleaned = raw.trim().normalize('NFC').toLocaleLowerCase('de-DE');
  if (!cleaned || /\s/.test(cleaned))
    throw new ApiError(400, 'validation', 'Bitte nur einzelne Wörter ohne Leerzeichen eingeben.');
  return cleaned;
}

export async function previewApi<T>(rawPath: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const [pathname, search = ''] = rawPath.split('?');
  const params = new URLSearchParams(search);

  if (pathname === '/auth/logout' && method === 'POST') {
    setPreviewAccount(null);
    return undefined as T;
  }

  const user = requireUser();

  // Passkey routes
  if (pathname === '/api/auth/passkey/list-user-passkeys' && method === 'GET') {
    return clone(store.passkeys[user.id] ?? []) as T;
  }
  if (pathname === '/api/auth/passkey/delete-passkey' && method === 'POST') {
    const body = parseJsonBody<{ id: string }>(init);
    store.passkeys[user.id] = (store.passkeys[user.id] ?? []).filter((p) => p.id !== body.id);
    return {} as T;
  }
  if (pathname.startsWith('/api/auth/passkey/')) {
    throw new ApiError(400, 'preview_only', 'Passkeys sind nur mit echtem Auth-Backend verfügbar.');
  }

  if (pathname === '/me' && method === 'GET') {
    const me: Me = {
      user: clone(user),
      csrf_token: 'preview-csrf-token',
      consent_required: store.consentRequired,
      project_management: true,
    };
    return me as T;
  }

  if (pathname === '/me/consent') {
    if (method === 'POST') {
      setPreviewConsentRequired(false);
    }
    const consent: Consent = {
      version: CONSENT_VERSION,
      draft: true,
      text: CONSENT_TEXT,
      accepted_at: store.consentRequired ? null : new Date().toISOString(),
    };
    return consent as T;
  }

  if (!user.admitted) throw new ApiError(403, 'forbidden', 'Zugang noch nicht freigegeben.');

  if (pathname === '/me/email-reminders') {
    if (method === 'PATCH') {
      const body = parseJsonBody<{ enabled: boolean }>(init);
      store.reminderPrefs[user.id] = Boolean(body.enabled);
    }
    return { enabled: store.reminderPrefs[user.id] ?? false } as T;
  }

  if (pathname === '/me/ballots' && method === 'GET') {
    const out: MyBallot[] = store.ballots
      .filter((b) => b.user_id === user.id)
      .map((b) => {
        const cat = store.categories.find((c) => c.id === b.poll_id);
        return {
          id: b.id,
          category_id: b.poll_id,
          category_name: cat?.name ?? 'Abstimmung',
          category_kind: (cat?.kind ?? 'proposal') as MyBallot['category_kind'],
          category_status: cat?.status ?? 'open',
          created_at: b.created_at,
        };
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return out as T;
  }

  if (pathname === '/roster' && method === 'GET') {
    return store.users.filter((u) => u.admitted && u.cohort_member).map((u) => ({ id: u.id, name: u.name })) as T;
  }

  // Categories / Sammlungen
  if (pathname === '/categories' && method === 'GET') {
    const list = store.categories
      .filter((c) => isEditor(user) || c.status !== 'draft')
      .map((c) => projectCategory(c, user));
    return list as T;
  }
  if (pathname === '/categories' && method === 'POST') {
    if (!isEditor(user)) throw new ApiError(403, 'forbidden', 'Keine Berechtigung.');
    const body = parseJsonBody<CategoryInput>(init);
    const id = nextUUID();
    const isBallot = isBallotKind(body.kind);
    const options: PollOption[] =
      body.kind === 'person' && body.all_people
        ? store.users
            .filter((u) => u.admitted && u.cohort_member)
            .map((u) => ({ id: nextUUID(), label: u.name, user_id: u.id }))
        : (body.options ?? []).map((o) => ({
            id: nextUUID(),
            label: o.label,
            ...(o.user_id ? { user_id: o.user_id } : {}),
          }));
    const created: Category = {
      id,
      name: body.name,
      description: body.description,
      kind: body.kind,
      template: body.kind === 'steckbrief' ? body.template || 'standard' : '',
      repeatable: body.repeatable ?? !isBallot,
      ongoing: body.ongoing ?? true,
      closes_at: body.ongoing === false ? (body.closes_at ?? null) : null,
      status: isBallot ? 'draft' : 'open',
      allow_self_vote: body.allow_self_vote ?? false,
      all_people: body.kind === 'person' ? (body.all_people ?? true) : false,
      max_choices: body.max_choices ?? (body.kind === 'words' ? 3 : 1),
      version: 1,
      created_at: new Date().toISOString(),
      opened_at: isBallot ? null : new Date().toISOString(),
      options,
      my_option_id: null,
      my_option_ids: [],
      my_words: [],
      ballot_count: null,
      participation: null,
    };
    store.categories.unshift(created);
    if (user.role === 'manager' && !user.category_ids.includes(id)) user.category_ids.push(id);
    if (created.kind === 'words') store.words[id] = [];
    return projectCategory(created, user) as T;
  }

  let m: RegExpMatchArray | null;

  if ((m = pathname.match(/^\/categories\/([^/]+)$/)) && method === 'PATCH') {
    const cat = store.categories.find((c) => c.id === m![1]);
    if (!cat) throw new ApiError(404, 'not_found', 'Sammlung nicht gefunden.');
    const body = parseJsonBody<CategoryEdit>(init);
    if (body.name !== undefined) cat.name = body.name;
    if (body.description !== undefined) cat.description = body.description;
    if (body.closes_at !== undefined) cat.closes_at = body.closes_at;
    if (body.max_choices !== undefined) cat.max_choices = body.max_choices;
    if (body.allow_self_vote !== undefined) cat.allow_self_vote = body.allow_self_vote;
    if (body.all_people !== undefined) cat.all_people = body.all_people;
    if (body.options !== undefined) {
      cat.options = body.options.map((o) => ({
        id: nextUUID(),
        label: o.label,
        ...(o.user_id ? { user_id: o.user_id } : {}),
      }));
    }
    cat.version += 1;
    return projectCategory(cat, user) as T;
  }

  if ((m = pathname.match(/^\/categories\/([^/]+)$/)) && method === 'DELETE') {
    store.categories = store.categories.filter((c) => c.id !== m![1]);
    store.ballots = store.ballots.filter((b) => b.poll_id !== m![1]);
    return undefined as T;
  }

  if ((m = pathname.match(/^\/categories\/([^/]+)\/status$/)) && method === 'POST') {
    const cat = store.categories.find((c) => c.id === m![1]);
    if (!cat) throw new ApiError(404, 'not_found', 'Sammlung nicht gefunden.');
    const body = parseJsonBody<{ status: Category['status'] }>(init);
    cat.status = body.status;
    if (body.status === 'open' && !cat.opened_at) cat.opened_at = new Date().toISOString();
    cat.version += 1;
    return projectCategory(cat, user) as T;
  }

  if ((m = pathname.match(/^\/categories\/([^/]+)\/ballot$/)) && method === 'PUT') {
    const cat = store.categories.find((c) => c.id === m![1]);
    if (!cat) throw new ApiError(404, 'not_found', 'Abstimmung nicht gefunden.');
    const body = parseJsonBody<{ option_id?: string; option_ids?: string[]; words?: string[]; ballot_id?: string }>(
      init,
    );
    const ballotId = cat.repeatable && body.ballot_id ? body.ballot_id : nextUUID();
    const now = new Date().toISOString();

    if (cat.kind === 'words') {
      const words = (body.words ?? []).map(normalizeWord);
      if (!words.length) throw new ApiError(400, 'validation', 'Mindestens ein Wort eingeben.');
      const list = (store.words[cat.id] ??= []);
      const optionIds: string[] = [];
      for (const w of words) {
        let entry = list.find((e) => e.word === w);
        if (!entry) {
          entry = { option_id: nextUUID(), word: w, label: w, count: 0, excluded: false, version: 1 };
          list.push(entry);
        }
        optionIds.push(entry.option_id);
      }
      if (!cat.repeatable) {
        store.ballots = store.ballots.filter((b) => !(b.poll_id === cat.id && b.user_id === user.id));
      }
      store.ballots.push({
        id: ballotId,
        poll_id: cat.id,
        user_id: user.id,
        option_ids: optionIds,
        words,
        created_at: now,
      });
      for (const entry of list) {
        entry.count = store.ballots.filter(
          (b) => b.poll_id === cat.id && b.option_ids.includes(entry.option_id),
        ).length;
      }
      return {
        option_id: optionIds[0],
        option_ids: optionIds,
        words,
        ...(cat.repeatable ? { ballot_id: ballotId } : {}),
      } as T;
    }

    const optionIds = body.option_ids?.length ? body.option_ids : body.option_id ? [body.option_id] : [];
    if (!optionIds.length) throw new ApiError(400, 'validation', 'Mindestens eine Option auswählen.');
    if (!cat.repeatable) {
      store.ballots = store.ballots.filter((b) => !(b.poll_id === cat.id && b.user_id === user.id));
    }
    store.ballots.push({
      id: ballotId,
      poll_id: cat.id,
      user_id: user.id,
      option_ids: optionIds,
      words: [],
      created_at: now,
    });
    const auditList = (store.ballotAudit[cat.id] ??= []);
    for (const oid of optionIds) {
      const label = cat.options.find((o) => o.id === oid)?.label ?? oid;
      auditList.unshift({
        ballot_id: ballotId,
        user_id: user.id,
        user_name: user.name,
        option_id: oid,
        option_label: label,
        created_at: now,
      });
    }
    return { option_id: optionIds[0], option_ids: optionIds, ...(cat.repeatable ? { ballot_id: ballotId } : {}) } as T;
  }

  if ((m = pathname.match(/^\/categories\/([^/]+)\/results$/)) && method === 'GET') {
    const cat = store.categories.find((c) => c.id === m![1]);
    if (!cat) throw new ApiError(404, 'not_found', 'Abstimmung nicht gefunden.');
    if (cat.kind === 'words') {
      const entries = (store.words[cat.id] ?? []).filter((e) => !e.excluded);
      const merged = new Map<string, { option_id: string; label: string; voters: Set<string> }>();
      for (const e of entries) {
        const group = merged.get(e.label) ?? { option_id: e.option_id, label: e.label, voters: new Set<string>() };
        for (const b of store.ballots) {
          if (b.poll_id === cat.id && b.option_ids.includes(e.option_id)) group.voters.add(b.id);
        }
        merged.set(e.label, group);
      }
      const res: PollResult[] = [...merged.values()]
        .map((g) => ({ option_id: g.option_id, label: g.label, count: g.voters.size }))
        .filter((r) => r.count > 0)
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      return res as T;
    }
    const res: PollResult[] = cat.options
      .map((o) => ({
        option_id: o.id,
        label: o.label,
        count: store.ballots.filter((b) => b.poll_id === cat.id && b.option_ids.includes(o.id)).length,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return res as T;
  }

  if ((m = pathname.match(/^\/categories\/([^/]+)\/words$/)) && method === 'GET') {
    return clone(store.words[m[1]] ?? []) as T;
  }

  if ((m = pathname.match(/^\/categories\/([^/]+)\/words\/([^/]+)$/)) && method === 'PATCH') {
    const list = store.words[m[1]] ?? [];
    const entry = list.find((w) => w.option_id === m![2]);
    if (!entry) throw new ApiError(404, 'not_found', 'Wort nicht gefunden.');
    const body = parseJsonBody<{ label: string; excluded: boolean }>(init);
    entry.label = body.label.trim().toLocaleLowerCase('de-DE') || entry.word;
    entry.excluded = Boolean(body.excluded);
    entry.version += 1;
    return clone(entry) as T;
  }

  if ((m = pathname.match(/^\/categories\/([^/]+)\/audit$/)) && method === 'GET') {
    return clone(store.ballotAudit[m[1]] ?? []) as T;
  }

  // Submissions
  if (pathname === '/submissions' && method === 'GET') {
    const cat = params.get('category_id');
    const status = params.get('status');
    const q = (params.get('q') ?? '').trim().toLowerCase();
    const out = store.submissions
      .filter((s) => isEditor(user) || s.author_id === user.id)
      .filter((s) => !cat || s.category_id === cat)
      .filter((s) => !status || s.status === status)
      .filter((s) => !q || `${s.title} ${s.body} ${s.author_name}`.toLowerCase().includes(q))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return clone(out) as T;
  }

  if (pathname === '/submissions' && method === 'POST') {
    const now = new Date().toISOString();
    const id = nextUUID();
    let category_id: string;
    let title: string;
    let bodyText: string;
    let context: string;
    const attachments: Attachment[] = [];

    if (init.body instanceof FormData) {
      category_id = String(init.body.get('category_id') ?? '');
      title = String(init.body.get('title') ?? '');
      bodyText = String(init.body.get('body') ?? '');
      context = String(init.body.get('context') ?? '');
      const caption = String(init.body.get('caption') ?? '');
      const file = init.body.get('file');
      if (file instanceof File) {
        const blobUrl = URL.createObjectURL(file);
        if (!title) title = file.name;
        attachments.push({
          id: nextUUID(),
          filename: file.name,
          mime_type: file.type || 'image/jpeg',
          size_bytes: file.size,
          caption,
          url: blobUrl,
          preview_url: blobUrl,
        });
      }
    } else {
      const body = parseJsonBody<{ category_id: string; title: string; body: string; context: string }>(init);
      category_id = body.category_id;
      title = body.title;
      bodyText = body.body;
      context = body.context;
    }

    const created: Submission = {
      id,
      category_id,
      author_id: user.id,
      author_name: user.name,
      title,
      body: bodyText,
      context,
      status: 'pending',
      version: 1,
      attachments,
      created_at: now,
      updated_at: now,
    };
    store.submissions.unshift(created);
    store.revisions[id] = [
      {
        id: nextUUID(),
        version: 1,
        actor_name: user.name,
        title,
        body: bodyText,
        context,
        status: 'pending',
        attachments: clone(attachments),
        created_at: now,
      },
    ];
    return clone(created) as T;
  }

  if ((m = pathname.match(/^\/submissions\/([^/]+)$/)) && method === 'GET') {
    const s = store.submissions.find((x) => x.id === m![1]);
    if (!s) throw new ApiError(404, 'not_found', 'Beitrag nicht gefunden.');
    return clone(s) as T;
  }

  if ((m = pathname.match(/^\/submissions\/([^/]+)$/)) && method === 'PATCH') {
    const s = store.submissions.find((x) => x.id === m![1]);
    if (!s) throw new ApiError(404, 'not_found', 'Beitrag nicht gefunden.');
    const body = parseJsonBody<{ category_id?: string; title?: string; body?: string; context?: string }>(init);
    if (body.category_id !== undefined) s.category_id = body.category_id;
    if (body.title !== undefined) s.title = body.title;
    if (body.body !== undefined) s.body = body.body;
    if (body.context !== undefined) s.context = body.context;
    s.version += 1;
    s.updated_at = new Date().toISOString();
    (store.revisions[s.id] ??= []).unshift({
      id: nextUUID(),
      version: s.version,
      actor_name: user.name,
      title: s.title,
      body: s.body,
      context: s.context,
      status: s.status,
      attachments: clone(s.attachments),
      created_at: s.updated_at,
    });
    return clone(s) as T;
  }

  if ((m = pathname.match(/^\/submissions\/([^/]+)\/status$/)) && method === 'POST') {
    const s = store.submissions.find((x) => x.id === m![1]);
    if (!s) throw new ApiError(404, 'not_found', 'Beitrag nicht gefunden.');
    const body = parseJsonBody<{ status: Submission['status'] }>(init);
    s.status = body.status;
    s.version += 1;
    s.updated_at = new Date().toISOString();
    return clone(s) as T;
  }

  if ((m = pathname.match(/^\/submissions\/([^/]+)\/revisions$/)) && method === 'GET') {
    return clone(store.revisions[m[1]] ?? []) as T;
  }

  if ((m = pathname.match(/^\/submissions\/([^/]+)\/corrections$/)) && method === 'GET') {
    return clone(store.corrections[m[1]] ?? []) as T;
  }

  if ((m = pathname.match(/^\/submissions\/([^/]+)\/corrections$/)) && method === 'POST') {
    const body = parseJsonBody<{ body: string }>(init);
    const created: Correction = {
      id: nextUUID(),
      submission_id: m[1],
      author_name: user.name,
      body: body.body,
      resolved: false,
      created_at: new Date().toISOString(),
    };
    (store.corrections[m[1]] ??= []).unshift(created);
    return clone(created) as T;
  }

  if ((m = pathname.match(/^\/submissions\/([^/]+)\/corrections\/([^/]+)\/resolve$/)) && method === 'POST') {
    const c = (store.corrections[m[1]] ?? []).find((x) => x.id === m![2]);
    if (!c) throw new ApiError(404, 'not_found', 'Hinweis nicht gefunden.');
    c.resolved = true;
    return clone(c) as T;
  }

  if ((m = pathname.match(/^\/submissions\/([^/]+)\/attachments$/)) && method === 'POST') {
    const s = store.submissions.find((x) => x.id === m![1]);
    if (!s) throw new ApiError(404, 'not_found', 'Beitrag nicht gefunden.');
    if (init.body instanceof FormData) {
      const file = init.body.get('file');
      const caption = String(init.body.get('caption') ?? '');
      if (file instanceof File) {
        const cat = store.categories.find((c) => c.id === s.category_id);
        if (cat?.kind === 'steckbrief') {
          s.attachments = s.attachments.filter((a) => a.caption !== caption);
        }
        const blobUrl = URL.createObjectURL(file);
        s.attachments.push({
          id: nextUUID(),
          filename: file.name,
          mime_type: file.type || 'image/jpeg',
          size_bytes: file.size,
          caption,
          url: blobUrl,
          preview_url: blobUrl,
        });
      }
    }
    s.version += 1;
    s.updated_at = new Date().toISOString();
    return clone(s) as T;
  }

  if ((m = pathname.match(/^\/submissions\/([^/]+)\/attachments\/([^/]+)$/)) && method === 'PATCH') {
    const s = store.submissions.find((x) => x.id === m![1]);
    const a = s?.attachments.find((x) => x.id === m![2]);
    if (!s || !a) throw new ApiError(404, 'not_found', 'Bild nicht gefunden.');
    const body = parseJsonBody<{ caption: string }>(init);
    a.caption = body.caption;
    s.version += 1;
    s.updated_at = new Date().toISOString();
    return clone(s) as T;
  }

  if ((m = pathname.match(/^\/submissions\/([^/]+)\/attachments\/([^/]+)$/)) && method === 'DELETE') {
    const s = store.submissions.find((x) => x.id === m![1]);
    if (!s) throw new ApiError(404, 'not_found', 'Beitrag nicht gefunden.');
    s.attachments = s.attachments.filter((x) => x.id !== m![2]);
    s.version += 1;
    s.updated_at = new Date().toISOString();
    return clone(s) as T;
  }

  // Admin: Users, Audit, Status, Email
  if (pathname === '/admin/users' && method === 'GET') {
    return clone(store.users) as T;
  }
  if ((m = pathname.match(/^\/admin\/users\/([^/]+)$/)) && method === 'PATCH') {
    const target = store.users.find((x) => x.id === m![1]);
    if (!target) throw new ApiError(404, 'not_found', 'Person nicht gefunden.');
    const body = parseJsonBody<Partial<User>>(init);
    Object.assign(target, body);
    return clone(target) as T;
  }
  if ((m = pathname.match(/^\/admin\/users\/([^/]+)$/)) && method === 'DELETE') {
    store.users = store.users.filter((x) => x.id !== m![1]);
    return undefined as T;
  }
  if (pathname === '/admin/audit' && method === 'GET') {
    return clone(store.auditEvents) as T;
  }
  if (pathname === '/admin/status' && method === 'GET') {
    const st: SystemStatus = { backup_last_success: daysAgo(0), backup_stale: false, upload_bytes: 1_840_000 };
    return st as T;
  }

  if (pathname === '/admin/email/status' && method === 'GET') {
    return clone(store.emailStatus) as T;
  }
  if (pathname === '/admin/email/settings' && method === 'PATCH') {
    const body = parseJsonBody<EmailPolicy>(init);
    store.emailStatus.policy = { ...body, version: store.emailStatus.policy.version + 1 };
    return clone(store.emailStatus) as T;
  }
  if (pathname === '/admin/email/messages' && method === 'GET') {
    const kind = params.get('kind');
    const st = params.get('status');
    const items = store.emailMessages.filter((x) => (!kind || x.kind === kind) && (!st || x.status === st));
    return { items: clone(items), next_cursor: null } as T;
  }
  if ((m = pathname.match(/^\/admin\/email\/messages\/([^/]+)$/)) && method === 'GET') {
    const msg = store.emailMessages.find((x) => x.id === m![1]);
    if (!msg) throw new ApiError(404, 'not_found', 'Nachricht nicht gefunden.');
    const detail: EmailMessageDetail = {
      message: clone(msg),
      events: [{ id: nextUUID(), status: msg.status, failure_code: null, created_at: msg.created_at }],
    };
    return detail as T;
  }
  if (pathname === '/admin/email/reconcile' && method === 'POST') {
    store.emailStatus.provider.observed_at = new Date().toISOString();
    return clone(store.emailStatus) as T;
  }
  if (pathname === '/admin/email/reminders/preview' && method === 'POST') {
    return { eligible: 3 } as T;
  }

  // Areas & Tickets
  if (pathname === '/areas' && method === 'GET') {
    return clone(store.areas) as T;
  }
  if (pathname === '/admin/areas' && method === 'POST') {
    const body = parseJsonBody<{ name: string; reviewer_ids: string[] }>(init);
    const reviewers = store.users
      .filter((u) => body.reviewer_ids.includes(u.id))
      .map((u) => ({ id: u.id, name: u.name }));
    const area: Area = { id: nextUUID(), name: body.name, position: store.areas.length + 1, version: 1, reviewers };
    store.areas.push(area);
    return clone(area) as T;
  }
  if ((m = pathname.match(/^\/admin\/areas\/([^/]+)$/)) && method === 'PATCH') {
    const area = store.areas.find((a) => a.id === m![1]);
    if (!area) throw new ApiError(404, 'not_found', 'Bereich nicht gefunden.');
    const body = parseJsonBody<{ name: string; reviewer_ids: string[] }>(init);
    area.name = body.name;
    area.reviewers = store.users
      .filter((u) => body.reviewer_ids.includes(u.id))
      .map((u) => ({ id: u.id, name: u.name }));
    area.version += 1;
    return clone(area) as T;
  }

  if (pathname === '/tickets/people' && method === 'GET') {
    return store.users.filter((u) => u.admitted && isEditor(u)).map((u) => ({ id: u.id, name: u.name })) as T;
  }
  if (pathname === '/tickets' && method === 'GET') {
    const includeFinished = params.get('include_finished') === 'true';
    const areaId = params.get('area_id');
    const out = store.tickets.filter(
      (t) => (includeFinished || !(t.status === 'done' && t.approved)) && (!areaId || t.area_id === areaId),
    );
    return clone(out) as T;
  }
  if (pathname === '/tickets' && method === 'POST') {
    const body = parseJsonBody<TicketInput>(init);
    const area = store.areas.find((a) => a.id === body.area_id);
    const assignees = store.users
      .filter((u) => body.assignee_ids.includes(u.id))
      .map((u) => ({ id: u.id, name: u.name }));
    const now = new Date().toISOString();
    const ticket: Ticket = {
      id: nextUUID(),
      number: store.nextTicketNumber++,
      type: body.type,
      title: body.title,
      body: body.body,
      area_id: body.area_id,
      area_name: area?.name ?? 'Bereich',
      assignees,
      created_by: { id: user.id, name: user.name },
      size: body.size,
      goal: body.goal,
      est_pages: body.est_pages,
      status: 'todo',
      round: 1,
      version: 1,
      approved: false,
      reviews: [],
      comment_count: 0,
      created_at: now,
      updated_at: now,
      status_changed_at: now,
    };
    store.tickets.unshift(ticket);
    return clone(ticket) as T;
  }
  if ((m = pathname.match(/^\/tickets\/([^/]+)$/)) && method === 'GET') {
    const ticket = store.tickets.find((t) => t.id === m![1]);
    if (!ticket) throw new ApiError(404, 'not_found', 'Ticket nicht gefunden.');
    const detail: TicketDetail = { ticket: clone(ticket), events: clone(store.ticketEvents[ticket.id] ?? []) };
    return detail as T;
  }
  if ((m = pathname.match(/^\/tickets\/([^/]+)$/)) && method === 'PATCH') {
    const ticket = store.tickets.find((t) => t.id === m![1]);
    if (!ticket) throw new ApiError(404, 'not_found', 'Ticket nicht gefunden.');
    const body = parseJsonBody<TicketEdit>(init);
    ticket.title = body.title;
    ticket.body = body.body;
    ticket.goal = body.goal;
    ticket.size = body.size;
    ticket.est_pages = body.est_pages;
    ticket.area_id = body.area_id;
    ticket.area_name = store.areas.find((a) => a.id === body.area_id)?.name ?? ticket.area_name;
    ticket.assignees = store.users
      .filter((u) => body.assignee_ids.includes(u.id))
      .map((u) => ({ id: u.id, name: u.name }));
    ticket.version += 1;
    ticket.updated_at = new Date().toISOString();
    return clone(ticket) as T;
  }
  if ((m = pathname.match(/^\/tickets\/([^/]+)\/status$/)) && method === 'POST') {
    const ticket = store.tickets.find((t) => t.id === m![1]);
    if (!ticket) throw new ApiError(404, 'not_found', 'Ticket nicht gefunden.');
    const body = parseJsonBody<{ status: Ticket['status'] }>(init);
    const prev = ticket.status;
    ticket.status = body.status;
    if ((prev === 'review' || prev === 'done') && (body.status === 'todo' || body.status === 'in_progress')) {
      ticket.round += 1;
      ticket.reviews = [];
      ticket.approved = false;
    }
    ticket.version += 1;
    ticket.updated_at = new Date().toISOString();
    ticket.status_changed_at = ticket.updated_at;
    (store.ticketEvents[ticket.id] ??= []).push({
      id: nextUUID(),
      kind: 'status',
      actor: { id: user.id, name: user.name },
      body: '',
      detail: `${prev}->${body.status}`,
      created_at: ticket.updated_at,
    });
    return clone(ticket) as T;
  }
  if ((m = pathname.match(/^\/tickets\/([^/]+)\/claim$/)) && method === 'POST') {
    const ticket = store.tickets.find((t) => t.id === m![1]);
    if (!ticket) throw new ApiError(404, 'not_found', 'Ticket nicht gefunden.');
    if (!ticket.assignees.some((a) => a.id === user.id)) {
      ticket.assignees.push({ id: user.id, name: user.name });
    }
    ticket.status = 'in_progress';
    ticket.version += 1;
    ticket.updated_at = new Date().toISOString();
    return clone(ticket) as T;
  }
  if ((m = pathname.match(/^\/tickets\/([^/]+)\/comments$/)) && method === 'POST') {
    const ticket = store.tickets.find((t) => t.id === m![1]);
    if (!ticket) throw new ApiError(404, 'not_found', 'Ticket nicht gefunden.');
    const body = parseJsonBody<{ body: string }>(init);
    const ev: TicketEvent = {
      id: nextUUID(),
      kind: 'comment',
      actor: { id: user.id, name: user.name },
      body: body.body,
      detail: '',
      created_at: new Date().toISOString(),
    };
    (store.ticketEvents[ticket.id] ??= []).push(ev);
    ticket.comment_count += 1;
    return clone(ev) as T;
  }
  if ((m = pathname.match(/^\/tickets\/([^/]+)\/review$/)) && method === 'PUT') {
    const ticket = store.tickets.find((t) => t.id === m![1]);
    if (!ticket) throw new ApiError(404, 'not_found', 'Ticket nicht gefunden.');
    const body = parseJsonBody<{ verdict: TicketReview['verdict']; self_confirmed?: boolean }>(init);
    const area = store.areas.find((a) => a.id === ticket.area_id);
    const isReviewer = !!area?.reviewers.some((r) => r.id === user.id);
    const binding = isReviewer || Boolean(body.self_confirmed);
    ticket.reviews = ticket.reviews.filter((r) => r.user.id !== user.id);
    ticket.reviews.push({
      user: { id: user.id, name: user.name },
      verdict: body.verdict,
      binding,
      self_confirmed: Boolean(body.self_confirmed),
      updated_at: new Date().toISOString(),
    });
    recomputeTicketApproved(ticket);
    ticket.version += 1;
    return clone(ticket) as T;
  }

  // Documents
  if (pathname === '/documents' && method === 'GET') {
    const read = store.readDocs[user.id] ?? new Set<string>();
    return store.documents
      .map((d) => ({ ...clone(d), unread: d.updated_by.id !== user.id && !read.has(d.id) }))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at)) as T;
  }
  if (pathname === '/documents' && method === 'POST') {
    const body = parseJsonBody<DocumentInput>(init);
    const now = new Date().toISOString();
    const ref: UserRef = { id: user.id, name: user.name };
    const doc: Document = {
      id: nextUUID(),
      title: body.title,
      kind: body.kind,
      body: body.body,
      created_by: ref,
      updated_by: ref,
      created_at: now,
      updated_at: now,
      version: 1,
      unread: false,
    };
    store.documents.unshift(doc);
    (store.readDocs[user.id] ??= new Set()).add(doc.id);
    return clone(doc) as T;
  }
  if ((m = pathname.match(/^\/documents\/([^/]+)$/)) && method === 'GET') {
    const doc = store.documents.find((d) => d.id === m![1]);
    if (!doc) throw new ApiError(404, 'not_found', 'Dokument nicht gefunden.');
    (store.readDocs[user.id] ??= new Set()).add(doc.id);
    return { ...clone(doc), unread: false } as T;
  }
  if ((m = pathname.match(/^\/documents\/([^/]+)$/)) && method === 'PATCH') {
    const doc = store.documents.find((d) => d.id === m![1]);
    if (!doc) throw new ApiError(404, 'not_found', 'Dokument nicht gefunden.');
    const body = parseJsonBody<DocumentEdit>(init);
    doc.title = body.title;
    doc.kind = body.kind;
    doc.body = body.body;
    doc.version += 1;
    doc.updated_by = { id: user.id, name: user.name };
    doc.updated_at = new Date().toISOString();
    return { ...clone(doc), unread: false } as T;
  }
  if ((m = pathname.match(/^\/documents\/([^/]+)$/)) && method === 'DELETE') {
    store.documents = store.documents.filter((d) => d.id !== m![1]);
    return undefined as T;
  }

  throw new ApiError(404, 'not_found', `Vorschau-Endpunkt nicht implementiert: ${method} ${pathname}`);
}
