package portal

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"strings"
)

const AdminID = "00000000-0000-4000-8000-000000000001"
const ManagerID = "00000000-0000-4000-8000-000000000002"
const MiaID = "00000000-0000-4000-8000-000000000003"
const LeonID = "00000000-0000-4000-8000-000000000004"
const GuestID = "00000000-0000-4000-8000-000000000005"
const PendingID = "00000000-0000-4000-8000-000000000006"

func categoryID(i int) string { return fmt.Sprintf("10000000-0000-4000-8000-%012d", i) }
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
	cats := []Category{{categoryID(1), "Ideen", "Vorschläge für unsere Abizeitung", "idea"}, {categoryID(2), "Zitate", "Sprüche, die bleiben", "quote"}, {categoryID(3), "Erinnerungen", "Unsere gemeinsame Schulzeit", "memory"}, {categoryID(4), "Fotos", "Eure schönsten Momente in Originalqualität", "photo"}}
	for _, c := range cats {
		if _, e = tx.Exec(ctx, "INSERT INTO categories(id,name,description,kind) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING", c.ID, c.Name, c.Description, c.Kind); e != nil {
			return e
		}
	}
	users := []User{{AdminID, "Alex · Administration", "admin", true, true, []string{}}, {ManagerID, "Sam · Redaktion", "manager", true, true, []string{categoryID(1), categoryID(4)}}, {MiaID, "Mia Weber", "student", true, true, []string{}}, {LeonID, "Leon Fischer", "student", true, true, []string{}}, {GuestID, "Kim · Gast", "student", true, false, []string{}}, {PendingID, "Pat · Freigabe ausstehend", "student", false, false, []string{}}}
	for _, u := range users {
		if _, e = tx.Exec(ctx, "INSERT INTO users(id,subject,name,role,admitted,cohort_member,category_ids) VALUES($1,$2,$3,$4,$5,$6,$7::uuid[]) ON CONFLICT(id) DO UPDATE SET subject=EXCLUDED.subject WHERE users.subject LIKE 'mock:%' OR users.subject ~ ('^https?://[^/]+/dev/oidc'||chr(31)||'[^'||chr(31)||']+$')", u.ID, issuer+"\x1f"+u.ID, u.Name, u.Role, u.Admitted, u.CohortMember, u.CategoryIDs); e != nil {
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
		id := fmt.Sprintf("30000000-0000-4000-8000-%012d", i)
		title, description, kind, status := "Unser Abimotto", "Welche Idee passt zu uns?", "proposal", "open"
		labels := []string{"Abizeitbetrug – 13 Jahre abgesessen", "ABIversal – ein Jahrgang, viele Welten", "Abikalypse – wir sind raus"}
		people := []*string{nil, nil, nil}
		if i == 2 {
			title = "Wer hat immer einen guten Spruch?"
			description = "Ein liebevolles Jahrgangsranking. Keine Selbstwahl."
			kind = "person"
			labels = []string{"Mia Weber", "Leon Fischer", "Sam · Redaktion"}
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
		tag, e := tx.Exec(ctx, "INSERT INTO polls(id,category_id,title,description,kind,status,version) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING", id, categoryID(1), title, description, kind, status, map[bool]int{true: 2, false: 1}[status == "open"])
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
	return tx.Commit(ctx)
}
