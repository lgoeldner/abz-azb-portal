package portal

import (
	"bytes"
	"context"
	"encoding/csv"
	"net/http"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

func normalizeWord(raw string) (string, error) {
	for _, r := range raw {
		if unicode.IsControl(r) {
			return "", bad("Wörter dürfen keine Leer- oder Steuerzeichen enthalten.")
		}
	}
	word := norm.NFC.String(strings.ToLower(norm.NFC.String(strings.TrimSpace(raw))))
	if word == "" || len([]rune(word)) > 64 {
		return "", bad("Wörter müssen 1 bis 64 Zeichen lang sein.")
	}
	for _, r := range word {
		if unicode.IsSpace(r) || unicode.IsControl(r) {
			return "", bad("Wörter dürfen keine Leer- oder Steuerzeichen enthalten.")
		}
	}
	return word, nil
}

func wordResults(ctx context.Context, db DB, categoryID string) ([]PollResult, error) {
	rows, err := db.Query(ctx, `SELECT (array_agg(o.id::text ORDER BY o.id))[1],COALESCE(o.word_label,o.label),count(DISTINCT b.user_id)::int
		FROM poll_options o JOIN ballots b ON b.poll_id=o.poll_id AND b.option_id=o.id
		WHERE o.poll_id=$1 AND NOT o.excluded
		GROUP BY COALESCE(o.word_label,o.label)
		HAVING count(DISTINCT b.user_id)>0
		ORDER BY COALESCE(o.word_label,o.label)`, categoryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PollResult{}
	for rows.Next() {
		var item PollResult
		if err = rows.Scan(&item.OptionID, &item.Label, &item.Count); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func wordEntries(ctx context.Context, db DB, categoryID string) ([]WordEntry, error) {
	rows, err := db.Query(ctx, `SELECT o.id::text,o.label,COALESCE(o.word_label,o.label),o.excluded,count(DISTINCT b.user_id)::int,o.moderation_version
		FROM poll_options o LEFT JOIN ballots b ON b.poll_id=o.poll_id AND b.option_id=o.id
		WHERE o.poll_id=$1
		GROUP BY o.id
		ORDER BY o.label,o.id`, categoryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []WordEntry{}
	for rows.Next() {
		var item WordEntry
		if err = rows.Scan(&item.OptionID, &item.Word, &item.Label, &item.Excluded, &item.Count, &item.Version); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func (a *App) listWords(w http.ResponseWriter, r *http.Request) error {
	u := current(r)
	if !editor(u) {
		return forbidden()
	}
	c, err := loadCategory(r.Context(), a.DB, r.PathValue("id"), u, false)
	if err != nil {
		return err
	}
	if c.Kind != "words" {
		return bad("Diese Sammlung hat keine Wortabstimmung.")
	}
	items, err := wordEntries(r.Context(), a.DB, c.ID)
	if err != nil {
		return err
	}
	jsonOut(w, http.StatusOK, items)
	return nil
}

func (a *App) moderateWord(w http.ResponseWriter, r *http.Request) error {
	u := current(r)
	var in struct {
		Version  *int    `json:"version"`
		Label    *string `json:"label"`
		Excluded *bool   `json:"excluded"`
	}
	if err := decode(w, r, &in); err != nil {
		return err
	}
	if in.Version == nil || in.Label == nil || in.Excluded == nil {
		return bad("Version, label und excluded sind erforderlich.")
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		return err
	}
	defer tx.Rollback(r.Context())
	c, err := loadCategory(r.Context(), tx, r.PathValue("id"), u, true)
	if err != nil {
		return err
	}
	if !canEdit(u, c.ID) {
		return forbidden()
	}
	if c.Kind != "words" {
		return bad("Diese Sammlung hat keine Wortabstimmung.")
	}
	optionID := r.PathValue("optionID")
	if !validID(optionID) {
		return missing()
	}
	var original string
	var version int
	err = tx.QueryRow(r.Context(), "SELECT label,moderation_version FROM poll_options WHERE poll_id=$1 AND id=$2 FOR UPDATE", c.ID, optionID).Scan(&original, &version)
	if err != nil {
		return err
	}
	if *in.Version != version {
		return conflict()
	}
	label, err := normalizeWord(*in.Label)
	if err != nil {
		return err
	}
	var effective *string
	if label != original {
		effective = &label
	}
	if _, err = tx.Exec(r.Context(), "UPDATE poll_options SET word_label=$3,excluded=$4,moderation_version=moderation_version+1 WHERE poll_id=$1 AND id=$2", c.ID, optionID, effective, *in.Excluded); err != nil {
		return err
	}
	var item WordEntry
	err = tx.QueryRow(r.Context(), `SELECT o.id::text,o.label,COALESCE(o.word_label,o.label),o.excluded,
		(SELECT count(DISTINCT b.user_id)::int FROM ballots b WHERE b.poll_id=o.poll_id AND b.option_id=o.id),o.moderation_version
		FROM poll_options o WHERE o.poll_id=$1 AND o.id=$2`, c.ID, optionID).Scan(&item.OptionID, &item.Word, &item.Label, &item.Excluded, &item.Count, &item.Version)
	if err != nil {
		return err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return err
	}
	jsonOut(w, http.StatusOK, item)
	return nil
}

func safeCSVWord(word string) string {
	for _, r := range word {
		if unicode.IsSpace(r) || unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			continue
		}
		if strings.ContainsRune("=+-@", r) {
			return "'" + word
		}
		return word
	}
	return word
}

func (a *App) exportWords(w http.ResponseWriter, r *http.Request) error {
	u := current(r)
	if !editor(u) {
		return forbidden()
	}
	c, err := loadCategory(r.Context(), a.DB, r.PathValue("id"), u, false)
	if err != nil {
		return err
	}
	if c.Kind != "words" {
		return bad("Diese Sammlung hat keine Wortabstimmung.")
	}
	results, err := wordResults(r.Context(), a.DB, c.ID)
	if err != nil {
		return err
	}
	var body bytes.Buffer
	writer := csv.NewWriter(&body)
	if err = writer.Write([]string{"word", "count"}); err != nil {
		return err
	}
	for _, result := range results {
		if err = writer.Write([]string{safeCSVWord(result.Label), strconv.Itoa(result.Count)}); err != nil {
			return err
		}
	}
	writer.Flush()
	if err = writer.Error(); err != nil {
		return err
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="words.csv"`)
	w.WriteHeader(http.StatusOK)
	_, err = w.Write(body.Bytes())
	return err
}
