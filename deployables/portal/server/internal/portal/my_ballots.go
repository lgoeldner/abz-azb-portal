package portal

import (
	"net/http"
)

func (a *App) myBallots(w http.ResponseWriter, r *http.Request) error {
	rows, err := a.DB.Query(r.Context(), `
		SELECT b.ballot_id::text,c.id::text,c.name,c.kind,
			CASE
				WHEN c.status='open' AND c.closes_at IS NOT NULL AND c.closes_at<=now() THEN 'closed'
				ELSE c.status
			END,
			max(b.created_at)
		FROM ballots b
		JOIN categories c ON c.id=b.poll_id
		WHERE b.user_id=$1 AND c.kind IN ('person','proposal','words')
		GROUP BY b.poll_id,b.ballot_id,c.id,c.name,c.kind,c.status,c.closes_at
		ORDER BY max(b.created_at) DESC,c.id,b.ballot_id`, current(r).ID)
	if err != nil {
		return err
	}
	defer rows.Close()

	out := []MyBallot{}
	for rows.Next() {
		var ballot MyBallot
		if err := rows.Scan(&ballot.ID, &ballot.CategoryID, &ballot.CategoryName, &ballot.CategoryKind, &ballot.CategoryStatus, &ballot.CreatedAt); err != nil {
			return err
		}
		out = append(out, ballot)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	jsonOut(w, http.StatusOK, out)
	return nil
}
