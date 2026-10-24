package portal

import "time"

type User struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Role         string    `json:"role"`
	Admitted     bool      `json:"admitted"`
	CohortMember bool      `json:"cohort_member"`
	CategoryIDs  []string  `json:"category_ids"`
	CreatedAt    time.Time `json:"created_at"`
}
type Category struct {
	ID            string       `json:"id"`
	Name          string       `json:"name"`
	Description   string       `json:"description"`
	Kind          string       `json:"kind"`
	Repeatable    bool         `json:"repeatable"`
	Status        string       `json:"status"`
	AllowSelfVote bool         `json:"allow_self_vote"`
	Options       []PollOption `json:"options"`
	MyOptionID    *string      `json:"my_option_id"`
	Version       int          `json:"version"`
	CreatedAt     time.Time    `json:"created_at"`
	OpenedAt      *time.Time   `json:"opened_at"`
	BallotCount   *int         `json:"ballot_count"`
}
type Attachment struct {
	ID         string `json:"id"`
	Filename   string `json:"filename"`
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
	Status      string       `json:"status"`
	Version     int          `json:"version"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
	Attachments []Attachment `json:"attachments"`
}
type Revision struct {
	ID        string    `json:"id"`
	Version   int       `json:"version"`
	ActorName string    `json:"actor_name"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	Context   string    `json:"context"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
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
	UserID *string `json:"user_id,omitempty"`
}
type PollResult struct {
	OptionID string `json:"option_id"`
	Label    string `json:"label"`
	Count    int    `json:"count"`
}
type BallotAudit struct {
	UserID      string    `json:"user_id"`
	UserName    string    `json:"user_name"`
	OptionID    string    `json:"option_id"`
	OptionLabel string    `json:"option_label"`
	CreatedAt   time.Time `json:"created_at"`
}
type AuditEvent struct {
	ID        string    `json:"id"`
	ActorName string    `json:"actor_name"`
	Action    string    `json:"action"`
	EntityID  string    `json:"entity_id"`
	CreatedAt time.Time `json:"created_at"`
}
