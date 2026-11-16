package portal

import (
	"context"
	"crypto/sha1"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"strings"
	"time"
)

const AdminID = "00000000-0000-4000-8000-000000000001"
const ManagerID = "00000000-0000-4000-8000-000000000002"
const MiaID = "00000000-0000-4000-8000-000000000003"
const LeonID = "00000000-0000-4000-8000-000000000004"
const GuestID = "00000000-0000-4000-8000-000000000005"
const PendingID = "00000000-0000-4000-8000-000000000006"

// fixtureSlugs maps seeded accounts to display_slug entries in deployables/auth-mock/users.yaml.
var fixtureSlugs = map[string]string{AdminID: "alex_admin", ManagerID: "sam_redaktion", MiaID: "mia_weber", LeonID: "leon_fischer", GuestID: "kim_gast", PendingID: "pat_ausstehend"}

// FixtureSubject is the OIDC subject the auth mock issues for a seeded account.
func FixtureSubject(id string) string { return subjectForSlug(fixtureSlugs[id]) }

// fixtureNamespace and subjectForSlug copy the auth-mock UUIDv5 derivation so production code
// never imports the auth-mock module; seed_subject_test.go asserts both stay identical.
var fixtureNamespace = [16]byte{0x6b, 0x1d, 0x3c, 0x0a, 0x7e, 0x42, 0x4f, 0x8b, 0x9a, 0x51, 0xc3, 0x2d, 0x84, 0xe7, 0x10, 0xaf}

func subjectForSlug(slug string) string {
	h := sha1.New()
	h.Write(fixtureNamespace[:])
	h.Write([]byte(slug))
	b := h.Sum(nil)[:16]
	b[6] = b[6]&0x0f | 0x50
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func pollID(i int) string     { return fmt.Sprintf("30000000-0000-4000-8000-%012d", i) }
func categoryID(i int) string { return fmt.Sprintf("10000000-0000-4000-8000-%012d", i) }

// areaID addresses the Bereiche created by migration 013 (1 Redaktion ... 8 Orga); ticketID the seeded fixtures.
func areaID(i int) string   { return fmt.Sprintf("60000000-0000-4000-8000-%012d", i) }
func ticketID(i int) string { return fmt.Sprintf("70000000-0000-4000-8000-%012d", i) }
func Seed(ctx context.Context, pool *pgxpool.Pool, environment string) error {
	return SeedWithIssuer(ctx, pool, environment, "http://localhost:9090")
}
func SeedWithIssuer(ctx context.Context, pool *pgxpool.Pool, environment, issuer string) error {
	if environment != "development" {
		return errors.New("seed is only allowed in development")
	}
	issuer = strings.TrimRight(issuer, "/")
	tx, e := pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(74120985)"); e != nil {
		return e
	}
	cats := []struct{ ID, Name, Description, Kind string }{{categoryID(1), "Ideen", "Vorschläge für unsere Abizeitung", "idea"}, {categoryID(2), "Zitate", "Sprüche, die bleiben", "quote"}, {categoryID(3), "Erinnerungen", "Unsere gemeinsame Schulzeit", "memory"}, {categoryID(4), "Fotos", "Eure schönsten Momente in Originalqualität", "photo"}}
	for _, c := range cats {
		if _, e = tx.Exec(ctx, "INSERT INTO categories(id,name,description,kind,opened_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(id) DO NOTHING", c.ID, c.Name, c.Description, c.Kind); e != nil {
			return e
		}
	}
	users := []User{{AdminID, "Alex (Administration)", "admin", true, true, []string{}, time.Time{}}, {ManagerID, "Sam (Redaktion)", "manager", true, true, []string{categoryID(1), categoryID(4), pollID(1), pollID(2), pollID(3)}, time.Time{}}, {MiaID, "Mia Weber", "student", true, true, []string{}, time.Time{}}, {LeonID, "Leon Fischer", "student", true, true, []string{}, time.Time{}}, {GuestID, "Kim (Gast)", "student", true, false, []string{}, time.Time{}}, {PendingID, "Pat (Freigabe ausstehend)", "student", false, false, []string{}, time.Time{}}}
	for _, u := range users {
		if _, e = tx.Exec(ctx, "INSERT INTO users(id,subject,name,role,admitted,cohort_member,category_ids) VALUES($1,$2,$3,$4,$5,$6,$7::uuid[]) ON CONFLICT(id) DO UPDATE SET subject=EXCLUDED.subject WHERE users.subject LIKE 'mock:%' OR starts_with(users.subject, $8) OR users.subject ~ ('^https?://[^/]+/dev/oidc'||chr(31)||'[^'||chr(31)||']+$')", u.ID, issuer+"\x1f"+FixtureSubject(u.ID), u.Name, u.Role, u.Admitted, u.CohortMember, u.CategoryIDs, issuer+"\x1f"); e != nil {
			return e
		}
	}
	// Fixtures start consented so dev and e2e land in the app; delete a consents row to see the consent step.
	for _, u := range users {
		if _, e = tx.Exec(ctx, "INSERT INTO consents(user_id,version) SELECT id,$2 FROM users WHERE id=$1 AND erased_at IS NULL ON CONFLICT DO NOTHING", u.ID, ConsentVersion); e != nil {
			return e
		}
	}
	// Synthetic development mailbox addresses are derived once from the shared roster.
	for id, slug := range fixtureSlugs {
		if _, e = tx.Exec(ctx, "UPDATE users SET login_email=$2 WHERE id=$1 AND login_email IS NULL AND erased_at IS NULL", id, slug+"@example.test"); e != nil {
			return e
		}
	}
	texts := []struct{ Author, Category, Title, Body, Context, Status string }{{MiaID, categoryID(1), "Eine Playlist für unseren Jahrgang", "Jede Person wählt einen Song, der an die Schulzeit erinnert.", "Idee für die letzte Seite", "pending"}, {LeonID, categoryID(2), "Das kommt nicht in der Klausur dran.", "… und natürlich kam es doch dran.", "Mathe, kurz vor den Ferien", "accepted"}, {MiaID, categoryID(3), "Die Nacht vor der Kursfahrt", "Niemand hatte gepackt. Im Gruppenchat wurde es trotzdem eine gute Nacht.", "Kursfahrt 2025", "accepted"}, {LeonID, categoryID(4), "Unser letzter Wandertag", "Die Fotos werden hier gesammelt.", "Gemeinsam unterwegs", "pending"}}
	for i, t := range texts {
		id := fmt.Sprintf("20000000-0000-4000-8000-%012d", i+1)
		tag, e := tx.Exec(ctx, "INSERT INTO submissions(id,category_id,author_id,title,body,context,status,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'seed') ON CONFLICT(id) DO NOTHING", id, t.Category, t.Author, t.Title, t.Body, t.Context, t.Status, "seed-"+id)
		if e != nil {
			return e
		}
		if tag.RowsAffected() > 0 {
			s, e := loadSubmission(ctx, tx, id, false)
			if e != nil {
				return e
			}
			if e = snapshot(ctx, tx, User{ID: t.Author}, s); e != nil {
				return e
			}
			if e = audit(ctx, tx, User{ID: AdminID}, "submission.seeded", id); e != nil {
				return e
			}
		}
	}
	for i := 1; i <= 3; i++ {
		id := pollID(i)
		title, description, kind, status := "Unser Abimotto", "Welche Idee passt zu uns?", "proposal", "open"
		labels := []string{"Abizeitbetrug – 13 Jahre abgesessen", "ABIversal – ein Jahrgang, viele Welten", "Abikalypse – wir sind raus"}
		people := []*string{nil, nil, nil}
		if i == 2 {
			title = "Wer hat immer einen guten Spruch?"
			description = "Ein liebevolles Jahrgangsranking. Keine Selbstwahl."
			kind = "person"
			labels = []string{"Mia Weber", "Leon Fischer", "Sam (Redaktion)"}
			mia, leon, sam := MiaID, LeonID, ManagerID
			people = []*string{&mia, &leon, &sam}
		}
		if i == 3 {
			title = "Die Farbe unseres Covers"
			description = "Redaktionsentwurf"
			status = "draft"
			labels = []string{"Mitternachtsblau", "Sonnengelb"}
			people = []*string{nil, nil}
		}
		// Stagger the timeline so the frontend shows a meaningful order.
		createdDays, openedDays := []int{0, 20, 12, 3}[i], []int{0, 18, 9, 0}[i]
		tag, e := tx.Exec(ctx, "INSERT INTO categories(id,name,description,kind,status,version,created_at,opened_at) VALUES($1,$2,$3,$4,$5,$6,now()-$7*interval '1 day',CASE WHEN $5<>'draft' THEN now()-$8*interval '1 day' END) ON CONFLICT(id) DO NOTHING", id, title, description, kind, status, map[bool]int{true: 2, false: 1}[status == "open"], createdDays, openedDays)
		if e != nil {
			return e
		}
		if tag.RowsAffected() > 0 {
			for j, label := range labels {
				oid := fmt.Sprintf("40000000-0000-4000-8000-%012d", i*100+j+1)
				if _, e = tx.Exec(ctx, "INSERT INTO poll_options(id,poll_id,label,user_id,position) VALUES($1,$2,$3,$4,$5)", oid, id, label, people[j], j); e != nil {
					return e
				}
			}
			if e = audit(ctx, tx, User{ID: AdminID}, "poll.seeded", id); e != nil {
				return e
			}
		}
	}
	if e = seedTickets(ctx, tx); e != nil {
		return e
	}
	return tx.Commit(ctx)
}

// seedTickets adds development fixtures covering all four columns, both types, an approved done ticket and a done
// ticket still waiting for approval. Existing fixtures are never rewritten; reviewer grants are only added together
// with the first fixture so later admin changes survive a re-seed.
func seedTickets(ctx context.Context, tx pgx.Tx) error {
	for _, area := range []int{1, 4} {
		if _, e := tx.Exec(ctx, "INSERT INTO area_reviewers(area_id,user_id) SELECT $1::uuid,$2::uuid WHERE NOT EXISTS(SELECT 1 FROM tickets WHERE id=$3::uuid) ON CONFLICT DO NOTHING", areaID(area), ManagerID, ticketID(1)); e != nil {
			return e
		}
	}
	two, three := 2, 3
	admin, manager := AdminID, ManagerID
	fixtures := []struct {
		Type, Title, Body string
		Area              int
		Assignee          *string
		Creator, Size     string
		Goal              string
		Pages             *int
		Status            string
		CreatedDays       int
		ChangedDays       int
	}{
		{"aufgabe", "Ideenwand für die Aula auswerten", "Alle Zettel abfotografieren und nach Themen gruppieren.", 2, nil, ManagerID, "S", "Alle Vorschläge sind gesichtet und nach Machbarkeit sortiert.", nil, "todo", 6, 6},
		{"artikel", "Lehrerzitate: Auswahl und Kürzung", "Aus den eingesendeten Zitaten eine Doppelseite zusammenstellen.", 3, &manager, AdminID, "M", "Zwei Seiten mit den besten Zitaten, geprüft und ohne Namen von Schüler:innen.", &two, "in_progress", 8, 4},
		{"aufgabe", "Fototermin für die Kursfahrt abstimmen", "Termin mit Kursleitung und Fotograf:in klären.", 4, &admin, ManagerID, "S", "Ein Termin steht fest und alle Beteiligten haben bestätigt.", nil, "in_progress", 5, 3},
		{"artikel", "Rückblick auf die Oberstufe", "## Entwurf\n\nErster Textentwurf liegt vor, Quellen fehlen noch.", 1, &admin, ManagerID, "M", "Drei Seiten Rückblick, redaktionell abgenommen.", &three, "review", 10, 2},
		{"aufgabe", "Bildformat für den Druck festlegen", "Auflösung und Farbprofil mit der Druckerei klären.", 4, &admin, ManagerID, "XS", "Das Bildformat ist dokumentiert und der Druckerei bestätigt.", nil, "done", 12, 9},
		{"aufgabe", "Terminplan für das Redaktionstreffen", "Treffen bis zum Abgabetermin planen.", 8, &manager, AdminID, "XS", "Alle Treffen bis zur Abgabe sind eingetragen.", nil, "done", 9, 7},
	}
	// Fotos has Sam as default reviewer, so his vote is binding; Orga has none, so Alex's vote is only advisory.
	votes := map[int]struct {
		User    string
		Binding bool
	}{5: {ManagerID, true}, 6: {AdminID, false}}
	for i, f := range fixtures {
		id := ticketID(i + 1)
		tag, e := tx.Exec(ctx, `INSERT INTO tickets(id,type,title,body,area_id,assignee_id,created_by,size,goal,est_pages,status,created_at,updated_at,status_changed_at)
 SELECT $1::uuid,$2::text,$3::text,$4::text,$5::uuid,$6::uuid,$7::uuid,$8::text,$9::text,$10::int,$11::text,now()-$12::int*interval '1 day',now()-$13::int*interval '1 day',now()-$13::int*interval '1 day'
 WHERE NOT EXISTS(SELECT 1 FROM tickets WHERE id=$1::uuid)`, id, f.Type, f.Title, f.Body, areaID(f.Area), f.Assignee, f.Creator, f.Size, f.Goal, f.Pages, f.Status, f.CreatedDays, f.ChangedDays)
		if e != nil {
			return e
		}
		if tag.RowsAffected() == 0 {
			continue
		}
		event := func(actor, kind, body, detail string, days, minute int) error {
			_, e := tx.Exec(ctx, "INSERT INTO ticket_events(id,ticket_id,actor_id,kind,body,detail,created_at) VALUES($1,$2,$3,$4,$5,$6,now()-$7::int*interval '1 day'+$8::int*interval '1 minute')", ID(), id, actor, kind, body, detail, days, minute)
			return e
		}
		if f.Assignee != nil {
			name := map[string]string{AdminID: "Alex (Administration)", ManagerID: "Sam (Redaktion)"}[*f.Assignee]
			if e = event(f.Creator, "assign", "", "niemand -> "+name, f.CreatedDays, 1); e != nil {
				return e
			}
		}
		path := map[string][]string{"in_progress": {"todo->in_progress"}, "review": {"todo->in_progress", "in_progress->review"}, "done": {"todo->in_progress", "in_progress->review", "review->done"}}[f.Status]
		for j, step := range path {
			actor := f.Creator
			if f.Assignee != nil {
				actor = *f.Assignee
			}
			if e = event(actor, "status", "", step, f.ChangedDays, j); e != nil {
				return e
			}
		}
		if v, ok := votes[i+1]; ok {
			if _, e = tx.Exec(ctx, "INSERT INTO ticket_reviews(ticket_id,user_id,round,verdict,binding,self_confirmed,updated_at) VALUES($1,$2,1,'approve',$3,false,now()-$4::int*interval '1 day')", id, v.User, v.Binding, f.ChangedDays); e != nil {
				return e
			}
		}
	}
	return nil
}
