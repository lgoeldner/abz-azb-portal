package portal

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const maxImageBytes = 20 << 20

func imagePreview(data []byte) ([]byte, string, error) {
	cfg, format, e := image.DecodeConfig(bytes.NewReader(data))
	if e != nil {
		return nil, "", bad("Nur gültige JPEG-, PNG- und WebP-Bilder sind erlaubt.")
	}
	if format != "jpeg" && format != "png" && format != "webp" {
		return nil, "", bad("Ungültiges Bildformat.")
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > 24000000 || cfg.Width > 20000 || cfg.Height > 20000 {
		return nil, "", bad("Bild überschreitet 24 Megapixel oder maximale Abmessungen.")
	}
	img, decoded, e := image.Decode(bytes.NewReader(data))
	if e != nil || decoded != format {
		return nil, "", bad("Beschädigte Bilddatei.")
	}
	width, height := cfg.Width, cfg.Height
	if width > 1600 || height > 1600 {
		if width >= height {
			height = max(1, height*1600/width)
			width = 1600
		} else {
			width = max(1, width*1600/height)
			height = 1600
		}
	}
	preview := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(preview, preview.Bounds(), image.White, image.Point{}, draw.Src)
	draw.ApproxBiLinear.Scale(preview, preview.Bounds(), img, img.Bounds(), draw.Over, nil)
	var out bytes.Buffer
	if e = jpeg.Encode(&out, preview, &jpeg.Options{Quality: 85}); e != nil {
		return nil, "", e
	}
	return out.Bytes(), "image/" + format, nil
}
func safeFilename(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, name)
	if name == "" || name == "." || name == "/" {
		return "image"
	}
	runes := []rune(name)
	if len(runes) > 180 {
		name = string(runes[:180])
	}
	return name
}
func immutableWrite(path string, data []byte) error {
	f, e := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return e
	}
	if _, e = f.Write(data); e != nil {
		f.Close()
		return e
	}
	if e = f.Sync(); e != nil {
		f.Close()
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	d, e := os.Open(filepath.Dir(path))
	if e != nil {
		return e
	}
	defer d.Close()
	return d.Sync()
}

type imageUpload struct {
	Filename, Caption, MimeType string
	Data, Preview               []byte
}

func validateCaption(caption string) error {
	if !utf8.ValidString(caption) || utf8.RuneCountInString(caption) > 2000 {
		return bad("Bildunterschrift darf maximal 2000 Zeichen enthalten.")
	}
	return nil
}

func readImageUpload(w http.ResponseWriter, r *http.Request, allowedFields ...string) (imageUpload, error) {
	var upload imageUpload
	r.Body = http.MaxBytesReader(w, r.Body, maxImageBytes+(1<<20))
	if e := r.ParseMultipartForm(1 << 20); e != nil {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
		var large *http.MaxBytesError
		if errors.As(e, &large) {
			return upload, fail(413, "too_large", "Bild darf maximal 20 MiB groß sein.")
		}
		return upload, bad("Ungültiger Bildupload.")
	}
	defer r.MultipartForm.RemoveAll()
	for field, values := range r.MultipartForm.Value {
		allowed := false
		for _, name := range allowedFields {
			if field == name {
				allowed = true
			}
		}
		if !allowed || len(values) != 1 {
			return upload, bad("Ungültiges Uploadfeld.")
		}
	}
	if len(r.MultipartForm.File) != 1 || len(r.MultipartForm.File["file"]) != 1 {
		return upload, bad("Genau eine Bilddatei erforderlich.")
	}
	upload.Caption = r.FormValue("caption")
	if e := validateCaption(upload.Caption); e != nil {
		return upload, e
	}
	f, header, e := r.FormFile("file")
	if e != nil {
		return upload, bad("Bilddatei erforderlich.")
	}
	defer f.Close()
	upload.Filename = safeFilename(header.Filename)
	upload.Data, e = io.ReadAll(io.LimitReader(f, maxImageBytes+1))
	if e != nil {
		return upload, e
	}
	if len(upload.Data) > maxImageBytes {
		return upload, fail(413, "too_large", "Bild darf maximal 20 MiB groß sein.")
	}
	upload.Preview, upload.MimeType, e = imagePreview(upload.Data)
	return upload, e
}

func (a *App) storeImage(ctx context.Context, tx pgx.Tx, submissionID string, upload imageUpload) error {
	id := ID()
	originalKey, previewKey := id+".original", id+".preview.jpg"
	if e := immutableWrite(filepath.Join(a.Config.UploadDir, originalKey), upload.Data); e != nil {
		return e
	}
	if e := immutableWrite(filepath.Join(a.Config.UploadDir, previewKey), upload.Preview); e != nil {
		return e
	}
	_, e := tx.Exec(ctx, "INSERT INTO attachments(id,submission_id,filename,mime_type,size_bytes,sha256,storage_key,preview_key,caption) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", id, submissionID, upload.Filename, upload.MimeType, len(upload.Data), digest(string(upload.Data)), originalKey, previewKey, upload.Caption)
	return e
}

func (a *App) upload(w http.ResponseWriter, r *http.Request) error {
	select {
	case a.imageSlots <- struct{}{}:
		defer func() { <-a.imageSlots }()
	case <-r.Context().Done():
		return r.Context().Err()
	}
	upload, e := readImageUpload(w, r, "version", "caption")
	if e != nil {
		return e
	}
	version, e := strconv.Atoi(r.FormValue("version"))
	if e != nil || version < 1 {
		return bad("Version erforderlich.")
	}
	u := current(r)
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	s, e := loadSubmission(r.Context(), tx, r.PathValue("id"), true)
	if e != nil {
		return e
	}
	if !canRead(u, s) {
		return missing()
	}
	if !canMutate(u, s) {
		return forbidden()
	}
	if s.Version != version {
		return conflict()
	}
	if len(s.Attachments) >= 10 {
		return bad("Maximal 10 Bilder je Beitrag.")
	}
	if e = a.storeImage(r.Context(), tx, s.ID, upload); e != nil {
		return e
	}
	if _, e = tx.Exec(r.Context(), "UPDATE submissions SET version=version+1,updated_at=now() WHERE id=$1", s.ID); e != nil {
		return e
	}
	return a.finishSubmission(w, r, tx, u, s.ID, "attachment.added")
}
func (a *App) deleteAttachment(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Version int `json:"version"`
	}
	if e := decode(w, r, &in); e != nil {
		return e
	}
	u := current(r)
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	s, e := loadSubmission(r.Context(), tx, r.PathValue("id"), true)
	if e != nil {
		return e
	}
	if !canRead(u, s) {
		return missing()
	}
	if !canMutate(u, s) {
		return forbidden()
	}
	if s.Version != in.Version {
		return conflict()
	}
	id := r.PathValue("attachmentID")
	if !validID(id) {
		return missing()
	}
	tag, e := tx.Exec(r.Context(), "UPDATE attachments SET deleted=true WHERE id=$1 AND submission_id=$2 AND NOT deleted", id, s.ID)
	if e != nil {
		return e
	}
	if tag.RowsAffected() == 0 {
		return missing()
	}
	var kind string
	if e = tx.QueryRow(r.Context(), "SELECT kind FROM categories WHERE id=$1 FOR SHARE", s.CategoryID).Scan(&kind); e != nil {
		return e
	}
	if kind == "photo" && len(s.Attachments) <= 1 {
		return bad("Ein Fotobeitrag muss mindestens ein Bild behalten.")
	}
	if _, e = tx.Exec(r.Context(), "UPDATE submissions SET version=version+1,updated_at=now() WHERE id=$1", s.ID); e != nil {
		return e
	}
	return a.finishSubmission(w, r, tx, u, s.ID, "attachment.removed")
}
func (a *App) editAttachment(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Version int     `json:"version"`
		Caption *string `json:"caption"`
	}
	if e := decode(w, r, &in); e != nil {
		return e
	}
	if in.Caption == nil {
		return bad("Bildunterschrift erforderlich.")
	}
	if e := validateCaption(*in.Caption); e != nil {
		return e
	}
	u := current(r)
	tx, e := a.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	s, e := loadSubmission(r.Context(), tx, r.PathValue("id"), true)
	if e != nil {
		return e
	}
	if !canRead(u, s) {
		return missing()
	}
	if !canMutate(u, s) {
		return forbidden()
	}
	if s.Version != in.Version {
		return conflict()
	}
	id := r.PathValue("attachmentID")
	if !validID(id) {
		return missing()
	}
	tag, e := tx.Exec(r.Context(), "UPDATE attachments SET caption=$3 WHERE id=$1 AND submission_id=$2 AND NOT deleted", id, s.ID, *in.Caption)
	if e != nil {
		return e
	}
	if tag.RowsAffected() == 0 {
		return missing()
	}
	if _, e = tx.Exec(r.Context(), "UPDATE submissions SET version=version+1,updated_at=now() WHERE id=$1", s.ID); e != nil {
		return e
	}
	return a.finishSubmission(w, r, tx, u, s.ID, "attachment.caption.edited")
}

func (a *App) download(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("id")
	if !validID(id) {
		return missing()
	}
	var sid, key, preview, filename, mimeType string
	e := a.DB.QueryRow(r.Context(), "SELECT submission_id::text,storage_key,preview_key,filename,mime_type FROM attachments WHERE id=$1 AND NOT deleted", id).Scan(&sid, &key, &preview, &filename, &mimeType)
	if e != nil {
		return e
	}
	if _, e = readable(r.Context(), a.DB, sid, current(r)); e != nil {
		return e
	}
	disposition := "attachment"
	if strings.HasSuffix(r.URL.Path, "/preview") {
		key = preview
		mimeType = "image/jpeg"
		filename = "preview.jpg"
		disposition = "inline"
	}
	f, e := os.Open(filepath.Join(a.Config.UploadDir, key))
	if e != nil {
		return e
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil {
		return e
	}
	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": filename}))
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, filename, st.ModTime(), f)
	return nil
}
func csvCell(s string) string {
	v := strings.TrimLeft(s, " \t\r\n")
	if len(v) > 0 && strings.ContainsAny(v[:1], "=+-@\t\r\n") {
		return "'" + s
	}
	return s
}
func (a *App) exportCategory(w http.ResponseWriter, r *http.Request) error {
	u := current(r)
	if !editor(u) {
		return forbidden()
	}
	id := r.PathValue("id")
	if !validID(id) {
		return missing()
	}
	status := r.URL.Query().Get("status")
	if status == "" {
		status = "all"
	}
	if status != "all" && !validSubmissionStatus(status) {
		return bad("Ungültiger Exportstatus.")
	}
	tx, e := a.DB.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	var name, kind string
	if e = tx.QueryRow(r.Context(), "SELECT name,kind FROM categories WHERE id=$1", id).Scan(&name, &kind); e != nil {
		return e
	}
	if !contributionKind(kind) {
		return bad("Abstimmungen können nicht exportiert werden.")
	}
	rows, e := tx.Query(r.Context(), "SELECT id::text FROM submissions WHERE category_id=$1 AND ($2='all' OR status=$2) ORDER BY created_at,id", id, status)
	if e != nil {
		return e
	}
	ids := []string{}
	for rows.Next() {
		var sid string
		if e = rows.Scan(&sid); e != nil {
			rows.Close()
			return e
		}
		ids = append(ids, sid)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	f, e := os.CreateTemp("", "portal-export-*.zip")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	defer f.Close()
	zw := zip.NewWriter(f)
	csvFile, e := zw.Create("submissions.csv")
	if e != nil {
		return e
	}
	cw := csv.NewWriter(csvFile)
	if e = cw.Write([]string{"id", "category", "author", "title", "body", "context", "status", "version", "created_at", "updated_at"}); e != nil {
		return e
	}
	submissions := []Submission{}
	for _, sid := range ids {
		s, e := loadSubmission(r.Context(), tx, sid, false)
		if e != nil {
			return e
		}
		submissions = append(submissions, s)
		values := []string{s.ID, name, s.AuthorName, s.Title, s.Body, s.Context, s.Status, strconv.Itoa(s.Version), s.CreatedAt.UTC().Format(time.RFC3339), s.UpdatedAt.UTC().Format(time.RFC3339)}
		for i := range values {
			values[i] = csvCell(values[i])
		}
		if e = cw.Write(values); e != nil {
			return e
		}
	}
	cw.Flush()
	if e = cw.Error(); e != nil {
		return e
	}
	type manifestFile struct {
		ID           string `json:"id"`
		SubmissionID string `json:"submission_id"`
		Path         string `json:"path"`
		SHA256       string `json:"sha256"`
		SizeBytes    int64  `json:"size_bytes"`
		Caption      string `json:"caption"`
	}
	files := []manifestFile{}
	for _, s := range submissions {
		for _, att := range s.Attachments {
			var key, hash string
			if e = tx.QueryRow(r.Context(), "SELECT storage_key,sha256 FROM attachments WHERE id=$1", att.ID).Scan(&key, &hash); e != nil {
				return e
			}
			path := "originals/" + s.ID + "/" + att.ID + "-" + safeFilename(att.Filename)
			entry, e := zw.Create(path)
			if e != nil {
				return e
			}
			original, e := os.Open(filepath.Join(a.Config.UploadDir, key))
			if e != nil {
				return e
			}
			_, e = io.Copy(entry, original)
			original.Close()
			if e != nil {
				return e
			}
			files = append(files, manifestFile{att.ID, s.ID, path, hash, att.SizeBytes, att.Caption})
		}
	}
	manifest, e := zw.Create("manifest.json")
	if e != nil {
		return e
	}
	if e = json.NewEncoder(manifest).Encode(map[string]any{"schema_version": 1, "exported_at": time.Now().UTC(), "category_id": id, "category_name": name, "status_filter": status, "submissions": submissions, "files": files}); e != nil {
		return e
	}
	if e = zw.Close(); e != nil {
		return e
	}
	if e = audit(r.Context(), tx, u, "category.exported", id); e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	st, e := f.Stat()
	if e != nil {
		return e
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"export-%s.zip\"", id))
	http.ServeContent(w, r, "export.zip", st.ModTime(), f)
	return nil
}
func diskBytes(root string) (int64, error) {
	var size int64
	e := filepath.WalkDir(root, func(path string, d fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if !d.IsDir() {
			st, e := d.Info()
			if e != nil {
				return e
			}
			size += st.Size()
		}
		return nil
	})
	return size, e
}
