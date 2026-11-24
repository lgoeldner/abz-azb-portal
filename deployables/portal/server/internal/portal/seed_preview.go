package portal

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Fixtures for pull-request previews only (SEED_PREVIEW=true next to SEED_DEVELOPMENT). They sit on top of Seed and
// complete it so every collection kind, submission status, poll status, ballots, corrections and photos exist.
// A separate layer keeps the shared development fixtures, and the tests that count them, unchanged.
func previewID(group, i int) string { return fmt.Sprintf("%d0000000-0000-4000-8000-%012d", group, i) }

// previewImage is a small gradient, enough for the preview JPEG, thumbnails and the lightbox.
func previewImage(hue int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, 640, 400))
	for y := range 400 {
		for x := range 640 {
			img.Set(x, y, color.RGBA{uint8((x*255/640 + hue) % 256), uint8(y * 255 / 400), uint8((hue * 3) % 256), 255})
		}
	}
	var out bytes.Buffer
	_ = png.Encode(&out, img)
	return out.Bytes()
}

func SeedPreview(ctx context.Context, pool *pgxpool.Pool, blobs BlobStore, environment string) error {
	if environment != "development" {
		return errors.New("preview seed is only allowed in development")
	}
	tx, e := pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(74120986)"); e != nil {
		return e
	}
	var done bool
	if e = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM submissions WHERE id=$1)", previewID(8, 1)).Scan(&done); e != nil || done {
		return e
	}

	// Collections: a closed proposal poll and a word poll next to the Seed ones (open proposal, person, draft).
	for _, c := range []struct{ ID, Name, Description, Kind, Status string }{
		{pollID(4), "Unser Abimotto: Stichwahl", "Die Abstimmung ist abgeschlossen.", "proposal", "closed"},
		{pollID(5), "Ein Wort für unseren Jahrgang", "Freie Wörter, die Redaktion fasst zusammen.", "words", "open"},
	} {
		if _, e = tx.Exec(ctx, "INSERT INTO categories(id,name,description,kind,status,version,created_at,opened_at) VALUES($1,$2,$3,$4,$5,2,now()-interval '14 days',now()-interval '13 days')", c.ID, c.Name, c.Description, c.Kind, c.Status); e != nil {
			return e
		}
	}
	options := func(poll string, labels ...string) ([]string, error) {
		ids := make([]string, len(labels))
		for i, label := range labels {
			ids[i] = ID()
			if _, e := tx.Exec(ctx, "INSERT INTO poll_options(id,poll_id,label,position) VALUES($1,$2,$3,$4)", ids[i], poll, label, i); e != nil {
				return nil, e
			}
		}
		return ids, nil
	}
	closed, e := options(pollID(4), "Abitopia", "Abikalypse")
	if e != nil {
		return e
	}
	words, e := options(pollID(5), "kaffee", "deadline", "pausenbrot", "mist")
	if e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, "UPDATE poll_options SET word_label='Kaffee' WHERE id=$1", words[0]); e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, "UPDATE poll_options SET excluded=true WHERE id=$1", words[3]); e != nil {
		return e
	}
	// Ballots (and their admin-visible audit rows) on the open proposal poll, the person poll, the closed poll and the word poll.
	vote := func(poll, user, option string) error {
		ballot := ID()
		if _, e := tx.Exec(ctx, "INSERT INTO ballots(poll_id,user_id,ballot_id,option_id) VALUES($1,$2,$3,$4)", poll, user, ballot, option); e != nil {
			return e
		}
		_, e := tx.Exec(ctx, "INSERT INTO ballot_audit(id,poll_id,user_id,option_id,ballot_id) VALUES($1,$2,$3,$4,$5)", ID(), poll, user, option, ballot)
		return e
	}
	var first, second string
	if e = tx.QueryRow(ctx, "SELECT (SELECT id::text FROM poll_options WHERE poll_id=$1 ORDER BY position LIMIT 1),(SELECT id::text FROM poll_options WHERE poll_id=$2 ORDER BY position LIMIT 1)", pollID(1), pollID(2)).Scan(&first, &second); e != nil {
		return e
	}
	for _, v := range [][3]string{{pollID(1), MiaID, first}, {pollID(2), MiaID, second}, {pollID(2), LeonID, second}, {pollID(4), MiaID, closed[0]}, {pollID(4), LeonID, closed[1]}, {pollID(4), ManagerID, closed[1]}, {pollID(5), MiaID, words[0]}, {pollID(5), LeonID, words[1]}, {pollID(5), LeonID, words[2]}} {
		if e = vote(v[0], v[1], v[2]); e != nil {
			return e
		}
	}

	type attachment struct{ Name, Caption string }
	subs := []struct {
		ID, Author, Category, Title, Body, Context, Status string
		Attachments                                        []attachment
	}{
		{previewID(8, 1), LeonID, categoryID(2), "Ein Zitat, das abgelehnt wurde", "Zu persönlich für die Zeitung.", "Sportunterricht", "rejected", nil},
		{previewID(8, 2), MiaID, categoryID(1), "Eine Idee, die zurückgezogen wurde", "Doch lieber nicht.", "", "withdrawn", nil},
		{previewID(8, 3), LeonID, categoryID(1), "Ein Abiball-Fotoautomat", "Mit Requisiten aus der Fundkiste.", "Idee für den Abiball", "accepted", nil},
		{previewID(8, 4), MiaID, categoryID(4), "Kursfahrt in Bildern", "Drei Tage, ein Bus.", "Kursfahrt 2025", "accepted", []attachment{{"bus.png", "Abfahrt um sechs"}, {"strand.png", "Pause am Strand"}}},
		{previewID(8, 5), MiaID, categoryID(5), "Steckbrief Mia", steckbriefAnswers, "", "accepted", []attachment{{"foto.png", "foto"}, {"kinderfoto.png", "kinderfoto"}}},
	}
	for i, s := range subs {
		if _, e = tx.Exec(ctx, "INSERT INTO submissions(id,category_id,author_id,title,body,context,status,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'seed')", s.ID, s.Category, s.Author, s.Title, s.Body, s.Context, s.Status, "seed-"+s.ID); e != nil {
			return e
		}
		for j, a := range s.Attachments {
			if e = seedAttachment(ctx, tx, blobs, s.ID, a.Name, a.Caption, i*10+j); e != nil {
				return e
			}
		}
		sub, e := loadSubmission(ctx, tx, s.ID, false)
		if e != nil {
			return e
		}
		if e = snapshot(ctx, tx, User{ID: s.Author}, sub); e != nil {
			return e
		}
		if e = audit(ctx, tx, User{ID: AdminID}, "submission.seeded", s.ID); e != nil {
			return e
		}
	}
	// One open and one resolved correction from the Redaktion.
	for i, c := range []struct {
		Submission, Body string
		Resolved         bool
	}{
		{"20000000-0000-4000-8000-000000000001", "Bitte den Titel kürzer fassen.", false},
		{"20000000-0000-4000-8000-000000000002", "Tippfehler im zweiten Satz.", true},
	} {
		if _, e = tx.Exec(ctx, "INSERT INTO corrections(id,submission_id,author_id,body,resolved) VALUES($1,$2,$3,$4,$5)", previewID(9, i+1), c.Submission, ManagerID, c.Body, c.Resolved); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}

const steckbriefAnswers = `{"name":"Mia Weber","spitzname":"Mimi","geburtstag":"14.03.","lieblingsfach":"Kunst","hassfach":"Sport","lieblingsort":"Die Bank vor der Aula","typ_reihe":"goldene Mitte","ausrede":"Der Bus war es natürlich nie","letzte_worte":"Danke für die Zeit.","unterschrift":"Mia"}`

func seedAttachment(ctx context.Context, tx pgx.Tx, blobs BlobStore, submissionID, name, caption string, hue int) error {
	data := previewImage(hue * 37)
	preview, mimeType, e := imagePreview(data)
	if e != nil {
		return e
	}
	id := ID()
	originalKey, previewKey := id+".original", id+".preview.jpg"
	if e = blobs.Put(ctx, originalKey, data); e != nil {
		return e
	}
	if e = blobs.Put(ctx, previewKey, preview); e != nil {
		return e
	}
	_, e = tx.Exec(ctx, "INSERT INTO attachments(id,submission_id,filename,mime_type,size_bytes,sha256,storage_key,preview_key,caption) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", id, submissionID, name, mimeType, len(data), digest(string(data)), originalKey, previewKey, caption)
	return e
}
