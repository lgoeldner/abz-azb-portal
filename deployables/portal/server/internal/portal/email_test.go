package portal

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMailConfigAndPrivacyHelpers(t *testing.T) {
	for _, key := range []string{"MAIL_PROVIDER", "BREVO_API_KEY", "MAIL_FROM", "MAIL_REPLY_TO", "BREVO_API_URL", "BREVO_TRACKING_DISABLED", "MAIL_DAILY_LIMIT", "REMINDER_DAILY_LIMIT", "MAIL_LOGIN_RESERVE", "REMINDERS_ENABLED"} {
		t.Setenv(key, "")
	}
	c, err := LoadMailConfig("development")
	if err != nil || c.Provider != "capture" || c.DailyLimit != 300 || c.ReminderLimit != 150 || c.LoginReserve != 150 {
		t.Fatalf("development defaults: config=%+v err=%v", c, err)
	}
	if got := maskEmail("mia.weber@example.test"); got != "m•••@example.test" {
		t.Fatalf("masked address = %q", got)
	}
	if validMailAddress("<script>@example.test") || validMailAddress("student@example.test\r\nBcc:other@example.test") {
		t.Fatal("invalid address accepted")
	}
	c.PublicURL = "https://portal.example.test"
	service := NewMailService(nil, c)
	if !service.validateLoginURL("https://portal.example.test/auth/confirm#token=secret") {
		t.Fatal("canonical auth URL rejected")
	}
	for _, raw := range []string{"https://evil.example/auth/confirm?token=x", "https://portal.example.test/help?next=x", "https://user@portal.example.test/auth/confirm"} {
		if service.validateLoginURL(raw) {
			t.Errorf("unsafe login URL accepted: %q", raw)
		}
	}
	t.Setenv("MAIL_DAILY_LIMIT", "600")
	t.Setenv("REMINDER_DAILY_LIMIT", "200")
	t.Setenv("MAIL_LOGIN_RESERVE", "400")
	c, err = LoadMailConfig("development")
	if err != nil || c.DailyLimit != 600 || c.ReminderLimit != 200 || c.LoginReserve != 400 {
		t.Fatalf("upgraded-plan ceilings: config=%+v err=%v", c, err)
	}
	t.Setenv("MAIL_DAILY_LIMIT", "")
	t.Setenv("REMINDER_DAILY_LIMIT", "")
	t.Setenv("MAIL_LOGIN_RESERVE", "")
	if _, err = LoadMailConfig("production"); err == nil {
		t.Fatal("production accepted a missing Brevo key and sender")
	}
	t.Setenv("MAIL_PROVIDER", "brevo")
	t.Setenv("BREVO_API_KEY", "synthetic")
	t.Setenv("MAIL_FROM", "Sender <sender@example.test>")
	if _, err = LoadMailConfig("development"); err == nil {
		t.Fatal("Brevo delivery was enabled without the tracking-disabled attestation")
	}
	t.Setenv("BREVO_TRACKING_DISABLED", "true")
	c, err = LoadMailConfig("development")
	if err != nil || !c.TrackingDisabled {
		t.Fatalf("Brevo tracking attestation was not honored: config=%+v err=%v", c, err)
	}
}

func mailTestService(t *testing.T, reminders bool) (*pgxpool.Pool, *MailService) {
	t.Helper()
	pool := integrationPool(t)
	if err := Seed(context.Background(), pool, "development"); err != nil {
		t.Fatalf("seed synthetic test users: %v", err)
	}
	config := MailConfig{Provider: "capture", PublicURL: "https://portal.example.test", DailyLimit: 300, ReminderLimit: 150, LoginReserve: 150, RemindersEnabled: reminders}
	return pool, NewMailService(pool, config)
}

func TestConcurrentMailReservationsDoNotOverspend(t *testing.T) {
	pool := integrationPool(t)
	ctx := context.Background()
	if err := Seed(ctx, pool, "development"); err != nil {
		t.Fatal(err)
	}
	cfg := MailConfig{Provider: "capture", DailyLimit: 2, ReminderLimit: 1, LoginReserve: 0}
	service := NewMailService(pool, cfg)
	var email string
	if err := pool.QueryRow(ctx, `SELECT login_email FROM users WHERE id=$1`, MiaID).Scan(&email); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	accepted, limited := 0, 0
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := service.send(ctx, mailSendRequest{UserID: MiaID, Kind: "login", Recipient: email, Subject: "Synthetic", Text: "Synthetic test", HTML: "<p>Synthetic test</p>"})
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				accepted++
				return
			}
			var failure *mailSendFailure
			if errors.As(err, &failure) && failure.code == "quota_exhausted" {
				limited++
				return
			}
			t.Errorf("send failed outside quota: %v", err)
		}()
	}
	wg.Wait()
	if accepted != 2 || limited != 10 {
		t.Fatalf("accepted=%d quota-limited=%d; want 2 and 10", accepted, limited)
	}
	var used, reserved int
	if err := pool.QueryRow(ctx, `SELECT count(*) FILTER(WHERE state='consumed'),count(*) FILTER(WHERE state IN ('reserved','uncertain')) FROM mail_reservations WHERE quota_day=(now() AT TIME ZONE 'UTC')::date`).Scan(&used, &reserved); err != nil {
		t.Fatal(err)
	}
	if used != 2 || reserved != 0 {
		t.Fatalf("stored quota used=%d reserved=%d", used, reserved)
	}
}

func TestReminderEligibilityDedupAndOptOut(t *testing.T) {
	pool, service := mailTestService(t, true)
	ctx := context.Background()
	categoryID := ID()
	deadline := time.Now().UTC().Add(48 * time.Hour).Truncate(time.Second)
	if _, err := pool.Exec(ctx, `UPDATE users SET cohort_member=(id=$1),admitted=true,login_enabled=true,email_reminders_enabled=true`, MiaID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO categories(id,name,description,kind,status,repeatable,ongoing,closes_at,email_reminders_enabled)
VALUES($1,'Erinnerungstest','','idea','open',false,false,$2,true)`, categoryID, deadline); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO submissions(id,category_id,author_id,title,idempotency_key,request_hash)
VALUES($1,$2,$3,'already complete','email-reminder-test-1','test')`, ID(), categoryID, MiaID); err != nil {
		t.Fatal(err)
	}
	count, err := service.previewReminders(ctx)
	if err != nil || count != 0 {
		t.Fatalf("nonwithdrawn contribution did not suppress reminder: count=%d err=%v", count, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE submissions SET status='withdrawn' WHERE category_id=$1 AND author_id=$2`, categoryID, MiaID); err != nil {
		t.Fatal(err)
	}
	count, err = service.previewReminders(ctx)
	if err != nil || count != 1 {
		t.Fatalf("withdrawn-only contribution should be incomplete: count=%d err=%v", count, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET email_reminders_enabled=false WHERE id=$1`, MiaID); err != nil {
		t.Fatal(err)
	}
	count, err = service.previewReminders(ctx)
	if err != nil || count != 0 {
		t.Fatalf("opt-out did not suppress reminder: count=%d err=%v", count, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET email_reminders_enabled=true WHERE id=$1`, MiaID); err != nil {
		t.Fatal(err)
	}
	if err := service.RunReminders(ctx, true); err != nil {
		t.Fatal(err)
	}
	var jobs, messages int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM mail_reminder_jobs WHERE user_id=$1 AND category_id=$2 AND status='sent'`, MiaID, categoryID).Scan(&jobs); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM mail_messages WHERE user_id=$1 AND category_id=$2 AND status='accepted'`, MiaID, categoryID).Scan(&messages); err != nil {
		t.Fatal(err)
	}
	if jobs != 1 || messages != 1 {
		t.Fatalf("initial worker result jobs=%d messages=%d", jobs, messages)
	}
	if err := service.RunReminders(ctx, true); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM mail_messages WHERE user_id=$1 AND category_id=$2`, MiaID, categoryID).Scan(&messages); err != nil {
		t.Fatal(err)
	}
	if messages != 1 {
		t.Fatalf("duplicate scan resent accepted reminder: messages=%d", messages)
	}
}

func TestEmailAdminSettingsVersionAndInternalLoginRedaction(t *testing.T) {
	pool, service := mailTestService(t, false)
	ctx := context.Background()
	app := &App{DB: pool, Mail: service, Config: Config{AuthServiceSecret: strings.Repeat("s", 32)}}
	studentReq := httptest.NewRequest(http.MethodGet, "/api/v1/admin/email/status", nil)
	studentReq = studentReq.WithContext(context.WithValue(studentReq.Context(), contextKey{}, requestUser{User: User{ID: MiaID, Role: "student", Admitted: true}}))
	studentResponse := httptest.NewRecorder()
	app.endpoint(app.emailStatus).ServeHTTP(studentResponse, studentReq)
	if studentResponse.Code != http.StatusForbidden {
		t.Fatalf("student email status returned %d", studentResponse.Code)
	}
	admin := User{ID: AdminID, Role: "admin", Admitted: true}
	settings := `{"version":1,"paused":true,"pause_all":false,"daily_limit":300,"reminder_limit":150,"login_reserve":150}`
	request := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/email/settings", strings.NewReader(settings))
	request = request.WithContext(context.WithValue(request.Context(), contextKey{}, requestUser{User: admin}))
	response := httptest.NewRecorder()
	app.endpoint(app.emailSettings).ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"policy":{"version":2`) || !strings.Contains(response.Body.String(), `"usage":`) {
		t.Fatalf("settings update: %d %s", response.Code, response.Body)
	}
	stale := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/email/settings", strings.NewReader(settings))
	stale = stale.WithContext(context.WithValue(stale.Context(), contextKey{}, requestUser{User: admin}))
	staleResponse := httptest.NewRecorder()
	app.endpoint(app.emailSettings).ServeHTTP(staleResponse, stale)
	if staleResponse.Code != http.StatusConflict {
		t.Fatalf("stale settings version returned %d", staleResponse.Code)
	}
	body, _ := json.Marshal(map[string]string{"user_id": MiaID, "email": "mia_weber@example.test", "url": "https://portal.example.test/auth/confirm#token=credential-never-store"})
	unauthorized := httptest.NewRequest(http.MethodPost, "/internal/email/login", bytes.NewReader(body))
	unauthorized.Header.Set("Authorization", "Bearer wrong")
	unauthorizedResponse := httptest.NewRecorder()
	app.endpoint(app.internalEmailLogin).ServeHTTP(unauthorizedResponse, unauthorized)
	if unauthorizedResponse.Code != http.StatusForbidden {
		t.Fatalf("unauthorized internal send returned %d", unauthorizedResponse.Code)
	}
	request = httptest.NewRequest(http.MethodPost, "/internal/email/login", bytes.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+strings.Repeat("s", 32))
	response = httptest.NewRecorder()
	app.endpoint(app.internalEmailLogin).ServeHTTP(response, request)
	if response.Code != http.StatusAccepted || !strings.Contains(response.Body.String(), `"ok":true`) {
		t.Fatalf("internal send response: %d %s", response.Code, response.Body)
	}
	var messages int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM mail_messages WHERE kind='login'`).Scan(&messages); err != nil || messages != 1 {
		t.Fatalf("login audit count=%d err=%v", messages, err)
	}
	var leaked int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM mail_messages m JOIN mail_destinations d ON d.message_id=m.id
WHERE concat_ws(' ',m.kind,m.status,coalesce(m.provider_message_id,''),coalesce(m.failure_code,''),d.recipient_snapshot) LIKE '%credential-never-store%'`).Scan(&leaked); err != nil || leaked != 0 {
		t.Fatalf("login URL token persisted: count=%d err=%v", leaked, err)
	}
}

func TestBrevoReconcileUsesOnlyUniqueEmailSendLimit(t *testing.T) {
	pool, _ := mailTestService(t, false)
	ctx := context.Background()
	var paths []string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("api-key") != "test-api-key" {
			t.Errorf("missing provider API authentication")
		}
		paths = append(paths, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v3/account":
			_, _ = w.Write([]byte(`{"email":"account@example.test","marketingAutomation":{"key":"must-not-persist"},"plan":[{"credits":250,"creditsType":"sendLimit","type":"free"},{"credits":15,"creditsType":"sendLimit","type":"sms"}]}`))
		case "/v3/smtp/statistics/events":
			_, _ = w.Write([]byte(`{"events":[]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()
	service := NewMailService(pool, MailConfig{Provider: "brevo", APIKey: "test-api-key", From: "Sender <sender@example.test>", BaseURL: provider.URL + "/v3", DailyLimit: 300, ReminderLimit: 150, LoginReserve: 150})
	if err := service.reconcile(ctx, AdminID); err != nil {
		t.Fatal(err)
	}
	var credits *int
	if err := pool.QueryRow(ctx, `SELECT provider_credits FROM mail_policy WHERE id=1`).Scan(&credits); err != nil {
		t.Fatal(err)
	}
	if credits == nil || *credits != 250 {
		t.Fatalf("provider credits = %v", credits)
	}
	var persisted int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM mail_admin_events WHERE details::text LIKE '%must-not-persist%'`).Scan(&persisted); err != nil || persisted != 0 {
		t.Fatalf("provider payload was persisted: count=%d err=%v", persisted, err)
	}
	if strings.Join(paths, ",") != "/v3/account,/v3/smtp/statistics/events" {
		t.Fatalf("provider request paths = %v", paths)
	}
	if parseBrevoEmailCredits([]byte(`{"plan":[{"credits":10,"creditsType":"sendLimit","type":"free"},{"credits":20,"creditsType":"sendLimit","type":"subscription"}]}`)) != nil {
		t.Fatal("ambiguous email credit plans were reported as a single balance")
	}
}

func TestBrevoReconcilePaginatesDeliveryEvents(t *testing.T) {
	pool, _ := mailTestService(t, false)
	ctx := context.Background()
	messageID := ID()
	if _, err := pool.Exec(ctx, `INSERT INTO mail_messages(id,user_id,kind,status,provider_message_id)
VALUES($1,$2,'login','accepted','message-to-bounce')`, messageID, MiaID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO mail_destinations(message_id,recipient_snapshot) VALUES($1,'mia_weber@example.test')`, messageID); err != nil {
		t.Fatal(err)
	}
	var offsets []string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v3/account" {
			_, _ = w.Write([]byte(`{"plan":[{"credits":300,"creditsType":"sendLimit","type":"free"}]}`))
			return
		}
		offsets = append(offsets, r.URL.Query().Get("offset"))
		type event struct {
			MessageID string `json:"messageId"`
			Event     string `json:"event"`
			Date      string `json:"date"`
		}
		events := make([]event, 500)
		for i := range events {
			events[i] = event{MessageID: fmt.Sprintf("unknown-%d", i), Event: "delivered", Date: time.Now().UTC().Add(-time.Minute).Format(time.RFC3339Nano)}
		}
		if r.URL.Query().Get("offset") == "500" {
			events = events[:1]
			events[0] = event{MessageID: "message-to-bounce", Event: "hardBounce", Date: time.Now().UTC().Add(-time.Minute).Format(time.RFC3339Nano)}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"events": events})
	}))
	defer provider.Close()
	service := NewMailService(pool, MailConfig{Provider: "brevo", APIKey: "test-api-key", From: "Sender <sender@example.test>", BaseURL: provider.URL + "/v3", DailyLimit: 300, ReminderLimit: 150, LoginReserve: 150})
	if err := service.reconcileDeliveryEvents(ctx, time.Now().UTC().Add(-48*time.Hour), time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if strings.Join(offsets, ",") != "0,500" {
		t.Fatalf("delivery event offsets = %v", offsets)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM mail_messages WHERE id=$1`, messageID).Scan(&status); err != nil || status != "bounced" {
		t.Fatalf("last-page bounce status=%q err=%v", status, err)
	}
}

func TestBrevoEventReconcileFailsClosedAtPaginationCap(t *testing.T) {
	pool, _ := mailTestService(t, false)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		events := make([]map[string]string, 500)
		for i := range events {
			events[i] = map[string]string{"event": "delivered"}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"events": events})
	}))
	defer provider.Close()
	service := NewMailService(pool, MailConfig{Provider: "brevo", APIKey: "test-api-key", BaseURL: provider.URL, DailyLimit: 300, ReminderLimit: 150, LoginReserve: 150})
	err := service.reconcileDeliveryEvents(context.Background(), time.Now().UTC().Add(-48*time.Hour), time.Now().UTC())
	var failure *mailSendFailure
	if !errors.As(err, &failure) || failure.code != "provider_unavailable" {
		t.Fatalf("truncated provider report returned %v", err)
	}
}

func TestDeliveredComplaintSuppressesAddressAcrossCategories(t *testing.T) {
	pool, service := mailTestService(t, false)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `UPDATE users SET cohort_member=(id=$1),admitted=true,login_enabled=true,email_reminders_enabled=true`, MiaID); err != nil {
		t.Fatal(err)
	}
	categoryID := ID()
	oldCategoryID := ID()
	deadline := time.Now().UTC().Add(12 * time.Hour)
	for _, category := range []string{categoryID, oldCategoryID} {
		if _, err := pool.Exec(ctx, `INSERT INTO categories(id,name,description,kind,status,repeatable,ongoing,closes_at,email_reminders_enabled)
VALUES($1,'Reminder suppression','','idea','open',false,false,$2,true)`, category, deadline); err != nil {
			t.Fatal(err)
		}
	}
	var email string
	if err := pool.QueryRow(ctx, `SELECT login_email FROM users WHERE id=$1`, MiaID).Scan(&email); err != nil {
		t.Fatal(err)
	}
	messageID := ID()
	hardBounceID := ID()
	for id, providerID := range map[string]string{messageID: "message-delivered", hardBounceID: "message-hardbounce"} {
		if _, err := pool.Exec(ctx, `INSERT INTO mail_messages(id,user_id,category_id,kind,status,provider_message_id,created_at)
VALUES($1,$2,$3,'login','delivered',$4,now()-interval '30 hours')`, id, MiaID, oldCategoryID, providerID); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO mail_destinations(message_id,recipient_snapshot) VALUES($1,$2)`, id, email); err != nil {
			t.Fatal(err)
		}
	}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"events": []map[string]string{
			{"messageId": "message-delivered", "event": "spam", "date": time.Now().UTC().Format(time.RFC3339Nano)},
			{"messageId": "message-hardbounce", "event": "hardBounce", "date": time.Now().UTC().Format(time.RFC3339Nano)},
		}})
	}))
	defer provider.Close()
	service.config.Provider = "brevo"
	service.config.APIKey = "synthetic"
	service.config.BaseURL = provider.URL
	if err := service.reconcileDeliveryEvents(ctx, time.Now().UTC().Add(-48*time.Hour), time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM mail_messages WHERE id=$1`, messageID).Scan(&status); err != nil || status != "delivered" {
		t.Fatalf("later complaint regressed delivery fact: status=%q err=%v", status, err)
	}
	var suppressions int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM mail_delivery_events WHERE message_id IN ($1,$2) AND status IN ('bounced','suppressed')`, messageID, hardBounceID).Scan(&suppressions); err != nil || suppressions != 2 {
		t.Fatalf("suppression event missing: count=%d err=%v", suppressions, err)
	}
	count, err := service.previewReminders(ctx)
	if err != nil || count != 0 {
		t.Fatalf("address-wide suppression did not prevent a different category reminder: count=%d err=%v", count, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET login_email='mia.new@example.test' WHERE id=$1`, MiaID); err != nil {
		t.Fatal(err)
	}
	count, err = service.previewReminders(ctx)
	if err != nil || count != 2 {
		t.Fatalf("address change did not clear old-address suppression: count=%d err=%v", count, err)
	}
}

func TestAdminMessageFiltersMaskAndPageStable(t *testing.T) {
	pool, service := mailTestService(t, false)
	ctx := context.Background()
	now := time.Now().UTC()
	for i, age := range []time.Duration{time.Hour, 2 * time.Hour, 100 * 24 * time.Hour} {
		id := ID()
		created := now.Add(-age)
		if _, err := pool.Exec(ctx, `INSERT INTO mail_messages(id,user_id,kind,status,provider_message_id,created_at,updated_at)
VALUES($1,$2,'login','accepted',$3,$4,$4)`, id, MiaID, fmt.Sprintf("page-%d", i), created); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO mail_destinations(message_id,recipient_snapshot) VALUES($1,'mia.weber@example.test')`, id); err != nil {
			t.Fatal(err)
		}
	}
	app := &App{DB: pool, Mail: service}
	admin := User{ID: AdminID, Role: "admin", Admitted: true}
	from := now.Add(-7 * 24 * time.Hour).Format(time.RFC3339)
	to := now.Add(time.Minute).Format(time.RFC3339)
	path := "/api/v1/admin/email/messages?kind=login&from=" + url.QueryEscape(from) + "&to=" + url.QueryEscape(to) + "&limit=1"
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request = request.WithContext(context.WithValue(request.Context(), contextKey{}, requestUser{User: admin}))
	response := httptest.NewRecorder()
	app.endpoint(app.emailMessages).ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("filtered message list: %d %s", response.Code, response.Body)
	}
	var first struct {
		Items      []emailMessageItem `json:"items"`
		NextCursor *string            `json:"next_cursor"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	if len(first.Items) != 1 || first.NextCursor == nil || first.Items[0].RecipientMasked != "m•••@example.test" || strings.Contains(response.Body.String(), "mia.weber@example.test") {
		t.Fatalf("message response did not mask/page as expected: %s", response.Body)
	}
	path = "/api/v1/admin/email/messages?kind=login&from=" + url.QueryEscape(from) + "&to=" + url.QueryEscape(to) + "&limit=1&cursor=" + url.QueryEscape(*first.NextCursor)
	request = httptest.NewRequest(http.MethodGet, path, nil)
	request = request.WithContext(context.WithValue(request.Context(), contextKey{}, requestUser{User: admin}))
	response = httptest.NewRecorder()
	app.endpoint(app.emailMessages).ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("second message page: %d %s", response.Code, response.Body)
	}
	var second struct {
		Items []emailMessageItem `json:"items"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &second); err != nil || len(second.Items) != 1 || second.Items[0].ID == first.Items[0].ID {
		t.Fatalf("unstable second page: %s err=%v", response.Body, err)
	}
	badRange := httptest.NewRequest(http.MethodGet, "/api/v1/admin/email/messages?from=2026-01-01T00:00:00Z&to=2026-05-01T00:00:00Z", nil)
	badRange = badRange.WithContext(context.WithValue(badRange.Context(), contextKey{}, requestUser{User: admin}))
	response = httptest.NewRecorder()
	app.endpoint(app.emailMessages).ServeHTTP(response, badRange)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("oversized date range returned %d", response.Code)
	}
}

func TestReminderConfigureCLIRequiresApply(t *testing.T) {
	pool := integrationPool(t)
	ctx := context.Background()
	if err := Seed(ctx, pool, "development"); err != nil {
		t.Fatal(err)
	}
	categoryID := ID()
	if _, err := pool.Exec(ctx, `INSERT INTO categories(id,name,description,kind,status,repeatable,ongoing,closes_at)
VALUES($1,'CLI reminder','','idea','open',false,false,now()+interval '1 day')`, categoryID); err != nil {
		t.Fatal(err)
	}
	config := MailConfig{Provider: "capture", DailyLimit: 300, ReminderLimit: 150, LoginReserve: 150}
	var out bytes.Buffer
	args := []string{"--category", categoryID, "--enabled=true"}
	if err := RunReminderCommand(ctx, pool, config, args, &out); err != nil {
		t.Fatal(err)
	}
	var enabled bool
	if err := pool.QueryRow(ctx, `SELECT email_reminders_enabled FROM categories WHERE id=$1`, categoryID).Scan(&enabled); err != nil || enabled {
		t.Fatalf("dry-run changed category setting: %v err=%v", enabled, err)
	}
	if err := RunReminderCommand(ctx, pool, config, append(args, "--apply"), &out); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT email_reminders_enabled FROM categories WHERE id=$1`, categoryID).Scan(&enabled); err != nil || !enabled {
		t.Fatalf("apply did not enable category reminders: %v err=%v", enabled, err)
	}
}
