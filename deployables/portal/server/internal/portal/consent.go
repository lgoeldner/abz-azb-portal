package portal

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

// ConsentVersion names the consent text below. Changing the text requires a new version; every user then consents again.
// ponytail: draft text, replace with the reviewed final text and a non-draft version before go-live (see PRIVACY.md).
const ConsentVersion = "entwurf-2026-11-16"
const consentDraft = true

var consentText = []string{
	"Entwurf: Dieser Text ist noch nicht final und wird vor dem Start geprüft.",
	"Ich willige ein, dass meine Beiträge, Fotos und Bildunterschriften in diesem Portal gespeichert werden und dass die Redaktion sie für die gedruckte Abizeitung des Jahrgangs 2027 auswählen, kürzen und veröffentlichen darf.",
	"Ich weiß, dass meine Stimmen in Abstimmungen mit meinem Namen gespeichert werden. Die Redaktion sieht nur Ergebnisse. Nur die Administration kann einsehen, wer wie abgestimmt hat.",
	"Ich lade nur Fotos hoch, die ich selbst gemacht habe oder verwenden darf, und nur, wenn die abgebildeten Personen einverstanden sind. Ich schreibe nichts Beleidigendes oder Unwahres über andere.",
	"Ich kann diese Einwilligung jederzeit widerrufen und die Löschung meiner Daten verlangen. Bereits gedruckte Ausgaben bleiben davon unberührt. Einzelheiten stehen in der Datenschutzerklärung.",
}

func consented(ctx context.Context, db DB, userID string) (bool, error) {
	var ok bool
	e := db.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM consents WHERE user_id=$1 AND version=$2)", userID, ConsentVersion).Scan(&ok)
	return ok, e
}

// consentGate blocks every API route except reading the session and the consent itself until the current version is accepted.
func (a *App) consentGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/me" || r.URL.Path == "/api/v1/me/consent" {
			next.ServeHTTP(w, r)
			return
		}
		ok, e := consented(r.Context(), a.DB, current(r).ID)
		if e != nil {
			respondError(w, e)
			return
		}
		if !ok {
			respondError(w, fail(403, "consent_required", "Bitte bestätige zuerst die Einwilligung."))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *App) consent(w http.ResponseWriter, r *http.Request) error {
	u := current(r)
	if r.Method == http.MethodPost {
		var in ConsentInput
		if e := decode(w, r, &in); e != nil {
			return e
		}
		if in.Version != ConsentVersion {
			return fail(409, "consent_outdated", "Der Einwilligungstext wurde geändert. Bitte lies ihn erneut.")
		}
		if _, e := a.DB.Exec(r.Context(), "INSERT INTO consents(user_id,version) VALUES($1,$2) ON CONFLICT DO NOTHING", u.ID, ConsentVersion); e != nil {
			return e
		}
	}
	out := Consent{Version: ConsentVersion, Draft: consentDraft, Text: consentText}
	var at time.Time
	if e := a.DB.QueryRow(r.Context(), "SELECT accepted_at FROM consents WHERE user_id=$1 AND version=$2", u.ID, ConsentVersion).Scan(&at); e == nil {
		out.AcceptedAt = &at
	} else if !errors.Is(e, pgx.ErrNoRows) {
		return e
	}
	jsonOut(w, 200, out)
	return nil
}
