package portal

// Request and response bodies of the JSON API. The OpenAPI document is generated from these types and from the
// route table in apiRoutes (see openapi.go); change them here and run `node scripts/check-contract.mjs --write`.

import (
	"encoding/json"
	"time"

	"github.com/swaggest/jsonschema-go"
)

type CategoryInput struct {
	Name          string           `json:"name"`
	Description   string           `json:"description"`
	Kind          string           `json:"kind" enum:"idea,quote,memory,photo,steckbrief,person,proposal,words"`
	Template      string           `json:"template" required:"false" enum:",standard" description:"Steckbrief collections only; defaults to standard on creation and is fixed afterwards. Other kinds require it empty or omitted."`
	Ongoing       bool             `json:"ongoing" required:"false" description:"No scheduled closing when true (default); false requires a future closes_at. Stored independently of content kind and repeatability."`
	ClosesAt      *time.Time       `json:"closes_at" required:"false" description:"Automatic closing instant for bounded collections; null when ongoing. Open collections are effectively closed at this instant."`
	Repeatable    bool             `json:"repeatable" required:"false" description:"Allow multiple contributions per person independently of kind. Omission defaults from kind on create and preserves the stored flag on edit."`
	AllowSelfVote bool             `json:"allow_self_vote" required:"false"`
	Options       []CategoryOption `json:"options" required:"false" description:"Empty for contribution kinds, word portraits, and all_people person poll input; otherwise explicit voting options. Word portrait responses never expose other voters’ words."`
	AllPeople     bool             `json:"all_people" required:"false" description:"Person polls: all admitted cohort members instead of explicit options. Defaults true on creation; omission preserves mode on edit. Other kinds require false."`
	MaxChoices    int              `json:"max_choices" required:"false" minimum:"1" maximum:"500" description:"Maximum selections for person/proposal polls or words per voter for word portraits (1–500). Word portraits default to 3, other polls to 1; contribution kinds require 1."`
}

type SubmissionInput struct {
	IdempotencyKey string `json:"idempotency_key"`
	CategoryID     string `json:"category_id"`
	Title          string `json:"title"`
	Body           string `json:"body"`
	Context        string `json:"context"`
}

type SubmissionEdit struct {
	Version    int    `json:"version"`
	CategoryID string `json:"category_id"`
	Title      string `json:"title"`
	Body       string `json:"body"`
	Context    string `json:"context"`
}

type UserEdit struct {
	Name         string   `json:"name"`
	Role         string   `json:"role" enum:"student,manager,admin"`
	Admitted     bool     `json:"admitted"`
	CohortMember bool     `json:"cohort_member"`
	CategoryIDs  []string `json:"category_ids"`
}

type CategoryEdit struct {
	Name          string           `json:"name" required:"false"`
	Description   string           `json:"description" required:"false"`
	Kind          string           `json:"kind" required:"false" enum:"idea,quote,memory,photo,steckbrief,person,proposal,words"`
	Template      string           `json:"template" required:"false" enum:",standard" description:"Fixed after creation: omitted preserves the stored value, a different value is rejected."`
	Ongoing       bool             `json:"ongoing" required:"false" description:"No scheduled closing when true (default); false requires a future closes_at. Stored independently of content kind and repeatability."`
	ClosesAt      *time.Time       `json:"closes_at" required:"false" description:"Future closing instant. For existing bounded polls, a sparse request containing only version and closes_at changes the deadline in any lifecycle state without changing definitions, votes, history or stored status. Omitted deadlines are preserved exactly; contribution deadlines remain fixed. Extending an expired stored-open poll makes it open again; manually closed or hidden polls stay closed or hidden."`
	Repeatable    bool             `json:"repeatable" required:"false" description:"Allow multiple contributions per person independently of kind. Omission defaults from kind on create and preserves the stored flag on edit."`
	AllowSelfVote bool             `json:"allow_self_vote" required:"false"`
	Options       []CategoryOption `json:"options" required:"false" description:"Empty for contribution kinds, word portraits, and all_people person poll input; otherwise explicit voting options. Word portrait responses never expose other voters’ words."`
	Version       int              `json:"version"`
	AllPeople     bool             `json:"all_people" required:"false" description:"Person polls: all admitted cohort members instead of explicit options. Defaults true on creation; omission preserves mode on edit. Other kinds require false."`
	MaxChoices    int              `json:"max_choices" required:"false" minimum:"1" maximum:"500" description:"Maximum selections for person/proposal polls or words per voter for word portraits (1–500). Word portraits default to 3, other polls to 1; contribution kinds require 1."`
}

type WordModerationInput struct {
	Version  int    `json:"version" minimum:"1"`
	Label    string `json:"label" minLength:"1" maxLength:"64" description:"One Unicode NFC lowercase word without whitespace or control characters; normalized on input."`
	Excluded bool   `json:"excluded"`
}

type AreaInput struct {
	Name        string   `json:"name"`
	ReviewerIDs []string `json:"reviewer_ids" items.format:"uuid"`
}

type AreaEdit struct {
	Name        string   `json:"name"`
	ReviewerIDs []string `json:"reviewer_ids" items.format:"uuid"`
	Version     int      `json:"version"`
}

type TicketInput struct {
	Type       string  `json:"type" enum:"aufgabe,artikel"`
	Title      string  `json:"title"`
	Body       string  `json:"body"`
	AreaID     string  `json:"area_id" format:"uuid"`
	AssigneeID *string `json:"assignee_id" format:"uuid"`
	Size       string  `json:"size" enum:"XS,S,M,L,XL"`
	Goal       string  `json:"goal"`
	EstPages   *int    `json:"est_pages"`
}

type TicketEdit struct {
	Title      string  `json:"title"`
	Body       string  `json:"body"`
	AreaID     string  `json:"area_id" format:"uuid"`
	AssigneeID *string `json:"assignee_id" format:"uuid"`
	Size       string  `json:"size" enum:"XS,S,M,L,XL"`
	Goal       string  `json:"goal"`
	EstPages   *int    `json:"est_pages"`
	Version    int     `json:"version"`
}

type TicketStatusInput struct {
	Version int    `json:"version"`
	Status  string `json:"status" enum:"todo,in_progress,review,done"`
}

type CommentInput struct {
	Body string `json:"body"`
}

type ReviewInput struct {
	Verdict       string `json:"verdict" enum:"approve,changes"`
	Round         int    `json:"round" description:"The ticket round the voter saw; a different current round returns 409 so stale votes never count in a new round."`
	SelfConfirmed bool   `json:"self_confirmed" required:"false"`
}

type StatusInput struct {
	Version int    `json:"version"`
	Status  string `json:"status" enum:"pending,accepted,rejected,withdrawn"`
}

type Me struct {
	User      User   `json:"user"`
	CSRFToken string `json:"csrf_token"`
	// ConsentRequired is true until the user accepted the current consent version; other API routes return 403 consent_required meanwhile.
	ConsentRequired bool `json:"consent_required"`
	// ProjectManagement mirrors the global PROJECT_MANAGEMENT flag; when false the ticket, Bereich and document routes answer 404.
	ProjectManagement bool `json:"project_management,omitempty"`
}

type Consent struct {
	Version    string     `json:"version"`
	Draft      bool       `json:"draft"`
	Text       []string   `json:"text"`
	AcceptedAt *time.Time `json:"accepted_at"`
}

type ConsentInput struct {
	Version string `json:"version"`
}

type SystemStatus struct {
	BackupLastSuccess *time.Time `json:"backup_last_success"`
	BackupStale       bool       `json:"backup_stale"`
	UploadBytes       int        `json:"upload_bytes"`
}

type RosterEntry struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type ReminderPreference struct {
	Enabled bool `json:"enabled"`
}

type ReminderPreview struct {
	Eligible int `json:"eligible" minimum:"0"`
}

type EmailMessageEvent struct {
	ID          string    `json:"id" format:"uuid"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	FailureCode *string   `json:"failure_code"`
}

type EmailMessages struct {
	Items      []EmailMessage `json:"items"`
	NextCursor *string        `json:"next_cursor"`
}

type EmailMessageDetail struct {
	Message EmailMessage        `json:"message"`
	Events  []EmailMessageEvent `json:"events"`
}

type CategoryOption struct {
	Label  string `json:"label"`
	UserID string `json:"user_id" required:"false"`
}

// VersionInput is the body of DELETE routes guarded by optimistic concurrency.
type VersionInput struct {
	Version int `json:"version"`
}

type AttachmentEdit struct {
	Version int    `json:"version" minimum:"1"`
	Caption string `json:"caption" maxLength:"2000"`
}

type CategoryStatusInput struct {
	Version int    `json:"version"`
	Status  string `json:"status" enum:"draft,open,closed"`
}

// BallotInput documents the vote body; the handler decodes the same keys into raw messages to reject mixed shapes.
type BallotInput struct {
	BallotID  string   `json:"ballot_id" required:"false" format:"uuid" description:"Client-generated key required for repeatable ballots; replay with the same selection returns success without an extra entry, changed selection conflicts."`
	OptionID  string   `json:"option_id" required:"false"`
	OptionIDs []string `json:"option_ids" required:"false" minItems:"1" maxItems:"500" uniqueItems:"true"`
	Words     []string `json:"words" required:"false" minItems:"1" maxItems:"500" uniqueItems:"true" items.minLength:"1" items.maxLength:"64" items.description:"One Unicode NFC lowercase word without whitespace or control characters; normalized on input."`
}

// PrepareJSONSchema requires exactly one of the three selection shapes.
func (BallotInput) PrepareJSONSchema(s *jsonschema.Schema) error {
	return oneOf(s, `[{"required":["option_id"],"not":{"anyOf":[{"required":["option_ids"]},{"required":["words"]}]}},{"required":["option_ids"],"not":{"anyOf":[{"required":["option_id"]},{"required":["words"]}]}},{"required":["words"],"not":{"anyOf":[{"required":["option_id"]},{"required":["option_ids"]}]}}]`)
}

// PrepareJSONSchema accepts either a full edit or a sparse deadline change.
func (CategoryEdit) PrepareJSONSchema(s *jsonschema.Schema) error {
	return oneOf(s, `[{"required":["name","description","kind"]},{"required":["closes_at"],"maxProperties":2}]`)
}

func oneOf(s *jsonschema.Schema, raw string) error {
	var alt struct {
		OneOf []jsonschema.SchemaOrBool `json:"oneOf"`
	}
	if e := json.Unmarshal([]byte(`{"oneOf":`+raw+`}`), &alt); e != nil {
		return e
	}
	s.OneOf = alt.OneOf
	return nil
}

type BallotReceipt struct {
	BallotID  string   `json:"ballot_id" required:"false" format:"uuid" description:"Client-generated key required for repeatable ballots; replay with the same selection returns success without an extra entry, changed selection conflicts."`
	OptionID  string   `json:"option_id"`
	OptionIDs []string `json:"option_ids"`
	Words     []string `json:"words" required:"false"`
}

// SubmissionUpload documents the multipart form of POST /submissions (image collections).
type SubmissionUpload struct {
	CategoryID     string `json:"category_id"`
	IdempotencyKey string `json:"idempotency_key" minLength:"8" maxLength:"200"`
	Title          string `json:"title" required:"false" maxLength:"300" description:"Defaults to filename when omitted"`
	Body           string `json:"body" required:"false" maxLength:"0"`
	Context        string `json:"context" required:"false" maxLength:"10000"`
	File           string `json:"file" format:"binary"`
	Caption        string `json:"caption" required:"false" maxLength:"2000"`
}

// AttachmentUpload documents the multipart form of POST /submissions/{id}/attachments.
type AttachmentUpload struct {
	File    string `json:"file" format:"binary"`
	Version int    `json:"version"`
	Caption string `json:"caption" required:"false" maxLength:"2000"`
}

// Error is the body of every failed request.
type Error struct {
	Error ErrorBody `json:"error"`
}

type ErrorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type SubmissionQuery struct {
	CategoryID string `query:"category_id"`
	Status     string `query:"status"`
	Q          string `query:"q"`
}

type CategoryExportQuery struct {
	Status string `query:"status" default:"all"`
}

type EmailMessagesQuery struct {
	Kind   string    `query:"kind" enum:"login,reminder"`
	Status string    `query:"status"`
	Cursor string    `query:"cursor"`
	UserID string    `query:"user_id" format:"uuid"`
	From   time.Time `query:"from"`
	To     time.Time `query:"to"`
}

type TicketQuery struct {
	Area            string `query:"area"`
	Assignee        string `query:"assignee"`
	Type            string `query:"type"`
	Q               string `query:"q"`
	IncludeFinished string `query:"include_finished"`
}

// Document is a shared Redaktion note (meeting minutes or a general note). Every admitted manager and admin reads and edits all documents.
type Document struct {
	ID        string    `json:"id" format:"uuid"`
	Title     string    `json:"title"`
	Kind      string    `json:"kind" enum:"meeting,note"`
	Body      string    `json:"body" description:"Markdown."`
	CreatedBy UserRef   `json:"created_by"`
	UpdatedBy UserRef   `json:"updated_by"`
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	Unread    bool      `json:"unread" description:"Someone else changed the document after the caller last opened it (or the caller never opened it)."`
}
type DocumentInput struct {
	Title string `json:"title"`
	Kind  string `json:"kind" enum:"meeting,note"`
	Body  string `json:"body"`
}
type DocumentEdit struct {
	Title   string `json:"title"`
	Kind    string `json:"kind" enum:"meeting,note"`
	Body    string `json:"body"`
	Version int    `json:"version"`
}
