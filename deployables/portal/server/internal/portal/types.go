package portal

import "time"

type User struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Role         string    `json:"role" enum:"student,manager,admin"`
	Admitted     bool      `json:"admitted"`
	CohortMember bool      `json:"cohort_member"`
	CategoryIDs  []string  `json:"category_ids"`
	CreatedAt    time.Time `json:"created_at"`
}
type Category struct {
	ID            string               `json:"id"`
	Name          string               `json:"name"`
	Description   string               `json:"description"`
	Kind          string               `json:"kind" enum:"idea,quote,memory,photo,steckbrief,person,proposal,words"`
	Template      string               `json:"template" required:"false" enum:",standard" description:"Steckbrief collections only: which hardcoded Steckbrief form this collection uses, fixed after creation. Empty for every other kind."`
	Repeatable    bool                 `json:"repeatable" description:"Allow multiple contributions or independent ballot entries per person, independently of kind. False ballots retain one changeable current selection."`
	Ongoing       bool                 `json:"ongoing" description:"No scheduled closing when true (default); false requires a future closes_at. Stored independently of content kind and repeatability."`
	ClosesAt      *time.Time           `json:"closes_at" description:"Automatic closing instant for bounded collections; null when ongoing. Open collections are effectively closed at this instant."`
	Status        string               `json:"status" enum:"draft,open,closed" description:"All kinds support draft, open and closed; the closing deadline also makes open collections effectively closed. Draft means hidden from students, including previously opened polls; opened_at distinguishes editable new drafts from locked hidden polls."`
	AllowSelfVote bool                 `json:"allow_self_vote"`
	AllPeople     bool                 `json:"all_people" description:"Person polls only: all admitted cohort members, refreshed when opening and fixed thereafter. Existing polls retain explicit candidates."`
	MaxChoices    int                  `json:"max_choices" minimum:"1" maximum:"500" description:"Maximum selections for person/proposal polls or words per voter for word portraits (1–500). Word portraits default to 3, other polls to 1; contribution kinds require 1."`
	Options       []PollOption         `json:"options" description:"Empty for contribution kinds, word portraits, and all_people person poll input; otherwise explicit voting options. Word portrait responses never expose other voters’ words."`
	MyWords       []string             `json:"my_words" required:"false" description:"Only the viewer’s current original normalized words, empty for other kinds or before voting. Originals are unchanged by editorial moderation."`
	MyOptionID    *string              `json:"my_option_id" description:"First current selection in canonical ID order (legacy compatibility), or null."`
	MyOptionIDs   []string             `json:"my_option_ids" description:"Viewer’s complete current selection; empty for contribution categories or before voting."`
	Version       int                  `json:"version"`
	CreatedAt     time.Time            `json:"created_at"`
	OpenedAt      *time.Time           `json:"opened_at" description:"Set once when a single-answer category moves from draft to open; creation time for repeatable ones."`
	BallotCount   *int                 `json:"ballot_count" description:"Number of distinct current voters. Editors only; null for students and contribution categories."`
	Participation *VotingParticipation `json:"participation" description:"Current voting participation among admitted cohort members, regardless of role. Both counts use the same population and database snapshot. Editors only; null for students and contribution categories. Preserved ballots from people no longer eligible are excluded here but remain in ballot_count."`
}
type VotingParticipation struct {
	Voted    int `json:"voted" minimum:"0" description:"Currently eligible people with a current ballot in this collection."`
	Eligible int `json:"eligible" minimum:"0" description:"All currently admitted cohort members."`
}
type Attachment struct {
	ID         string `json:"id"`
	Filename   string `json:"filename"`
	Caption    string `json:"caption" maxLength:"2000"`
	MimeType   string `json:"mime_type"`
	SizeBytes  int64  `json:"size_bytes"`
	URL        string `json:"url"`
	PreviewURL string `json:"preview_url"`
}
type Submission struct {
	ID          string       `json:"id"`
	CategoryID  string       `json:"category_id"`
	AuthorID    string       `json:"author_id"`
	AuthorName  string       `json:"author_name"`
	Title       string       `json:"title"`
	Body        string       `json:"body"`
	Context     string       `json:"context"`
	Status      string       `json:"status" enum:"pending,accepted,rejected,withdrawn"`
	Version     int          `json:"version"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
	Attachments []Attachment `json:"attachments"`
}
type Revision struct {
	Attachments []Attachment `json:"attachments"`
	ID          string       `json:"id"`
	Version     int          `json:"version"`
	ActorName   string       `json:"actor_name"`
	Title       string       `json:"title"`
	Body        string       `json:"body"`
	Context     string       `json:"context"`
	Status      string       `json:"status" enum:"pending,accepted,rejected,withdrawn"`
	CreatedAt   time.Time    `json:"created_at"`
}
type Correction struct {
	ID           string    `json:"id"`
	SubmissionID string    `json:"submission_id"`
	AuthorName   string    `json:"author_name"`
	Body         string    `json:"body"`
	CreatedAt    time.Time `json:"created_at"`
	Resolved     bool      `json:"resolved"`
}
type PollOption struct {
	ID     string  `json:"id"`
	Label  string  `json:"label"`
	UserID *string `json:"user_id,omitempty" required:"false" nullable:"false"`
}
type PollResult struct {
	OptionID string `json:"option_id"`
	Label    string `json:"label"`
	Count    int    `json:"count"`
}
type WordEntry struct {
	_        struct{} `description:"Editorial anonymous original-word tally and reversible moderation; contains no voter identity. Equal effective labels merge, counting each current voter once in results."`
	OptionID string   `json:"option_id"`
	Word     string   `json:"word" minLength:"1" maxLength:"64" description:"One Unicode NFC lowercase word without whitespace or control characters; normalized on input."`
	Label    string   `json:"label" minLength:"1" maxLength:"64" description:"One Unicode NFC lowercase word without whitespace or control characters; normalized on input."`
	Excluded bool     `json:"excluded"`
	Count    int      `json:"count" minimum:"0"`
	Version  int      `json:"version" minimum:"1"`
}
type BallotAudit struct {
	BallotID    *string   `json:"ballot_id" description:"Groups the complete selection from one ballot change. Null for legacy single-choice history."`
	UserID      string    `json:"user_id"`
	UserName    string    `json:"user_name"`
	OptionID    string    `json:"option_id"`
	OptionLabel string    `json:"option_label"`
	CreatedAt   time.Time `json:"created_at"`
}
type MyBallot struct {
	ID             string    `json:"id" description:"Ballot entry key, grouped across all selected options or words."`
	CategoryID     string    `json:"category_id"`
	CategoryName   string    `json:"category_name"`
	CategoryKind   string    `json:"category_kind" enum:"person,proposal,words"`
	CategoryStatus string    `json:"category_status" enum:"draft,open,closed" description:"Effective collection status; draft entries are displayed without a collection link."`
	CreatedAt      time.Time `json:"created_at" description:"Latest timestamp of this current ballot entry."`
}
type AuditEvent struct {
	ID        string    `json:"id"`
	ActorName string    `json:"actor_name"`
	Action    string    `json:"action"`
	EntityID  string    `json:"entity_id"`
	CreatedAt time.Time `json:"created_at"`
}
