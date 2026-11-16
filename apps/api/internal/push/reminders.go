package push

import (
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"

	"my-bookmark/api/internal/core"
)

type bookmark struct {
	ID    string  `json:"id"`
	Kind  string  `json:"kind"`
	URL   *string `json:"url"`
	Title *string `json:"title"`
}
type reminder struct {
	ID         string          `json:"id"`
	UserID     string          `json:"user_id"`
	BookmarkID string          `json:"bookmark_id"`
	RemindAt   string          `json:"remind_at"`
	Note       *string         `json:"note"`
	Status     string          `json:"status"`
	SentAt     *string         `json:"sent_at"`
	Recurrence string          `json:"recurrence"`
	Timezone   string          `json:"recurrence_timezone"`
	Day        *int            `json:"recurrence_day"`
	Enabled    bool            `json:"is_enabled"`
	CreatedAt  string          `json:"created_at"`
	Bookmarks  json.RawMessage `json:"bookmarks"`
}

func (r reminder) mapped() map[string]any {
	var raw map[string]any
	_ = json.Unmarshal(r.Bookmarks, &raw)
	var bookmark any
	if raw != nil {
		kind, _ := raw["kind"].(string)
		var page any
		if kind == "link" {
			page = raw["url"]
		}
		bookmark = map[string]any{"id": raw["id"], "kind": kind, "title": raw["title"], "url": page}
	}
	return map[string]any{"id": r.ID, "userId": r.UserID, "bookmarkId": r.BookmarkID, "remindAt": r.RemindAt, "note": r.Note, "status": r.Status, "sentAt": r.SentAt, "recurrence": r.Recurrence, "recurrenceTimezone": r.Timezone, "isEnabled": r.Enabled, "createdAt": r.CreatedAt, "bookmark": bookmark}
}

var uuidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
var datePattern = regexp.MustCompile(`^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$`)

const selection = "*,bookmarks(id,kind,url,title)"

func reminderRows(b []byte) ([]reminder, error) {
	var rows []reminder
	e := json.Unmarshal(b, &rows)
	return rows, e
}

type inputError struct {
	message string
	fields  map[string][]string
	form    []string
}

func (e *inputError) write(w http.ResponseWriter) {
	if e.fields != nil || e.form != nil {
		if e.fields == nil {
			e.fields = map[string][]string{}
		}
		if e.form == nil {
			e.form = []string{}
		}
		core.JSON(w, 400, map[string]any{"error": map[string]any{"code": "VALIDATION_ERROR", "message": "Validation failed", "details": map[string]any{"fieldErrors": e.fields, "formErrors": e.form}}})
		return
	}
	validation(w, e.message)
}
func jsonKind(v json.RawMessage) string {
	var x any
	if json.Unmarshal(v, &x) != nil {
		return "undefined"
	}
	switch x.(type) {
	case nil:
		return "null"
	case bool:
		return "boolean"
	case float64:
		return "number"
	case string:
		return "string"
	case []any:
		return "array"
	default:
		return "object"
	}
}
func readInput(r *http.Request, update bool, needsBookmark bool) (map[string]any, *inputError) {
	var raw map[string]json.RawMessage
	if core.Decode(r, &raw) != nil || raw == nil {
		return nil, &inputError{message: "Invalid request body"}
	}
	fields := map[string][]string{}
	add := func(k, msg string) { fields[k] = append(fields[k], msg) }
	required := !update
	if required {
		for _, k := range []string{"remindAt", "recurrenceTimezone", "bookmarkId"} {
			if k == "bookmarkId" && !needsBookmark {
				continue
			}
			if _, ok := raw[k]; !ok {
				add(k, "Invalid input: expected string, received undefined")
			}
		}
		if _, ok := raw["recurrence"]; !ok {
			add("recurrence", `Invalid option: expected one of "none"|"daily"|"weekly"|"monthly"`)
		}
	}
	result := map[string]any{}
	keys := []string{"remindAt", "note", "recurrence", "recurrenceTimezone"}
	if update {
		keys = append(keys, "isEnabled")
	}
	if needsBookmark {
		keys = append(keys, "bookmarkId")
	}
	for _, k := range keys {
		v, ok := raw[k]
		if !ok {
			continue
		}
		if k == "isEnabled" {
			var x bool
			if string(v) == "null" || json.Unmarshal(v, &x) != nil {
				add(k, "Invalid input: expected boolean, received "+jsonKind(v))
				continue
			}
			result[k] = x
			continue
		}
		if k == "note" && string(v) == "null" {
			result[k] = nil
			continue
		}
		var s string
		if string(v) == "null" || json.Unmarshal(v, &s) != nil {
			if k == "recurrence" {
				add(k, `Invalid option: expected one of "none"|"daily"|"weekly"|"monthly"`)
			} else {
				add(k, "Invalid input: expected string, received "+jsonKind(v))
			}
			continue
		}
		switch k {
		case "bookmarkId":
			if !uuidPattern.MatchString(s) {
				add(k, "Invalid UUID")
			}
		case "remindAt":
			if _, e := time.Parse(time.RFC3339Nano, s); e != nil || !datePattern.MatchString(s) {
				add(k, "Invalid ISO datetime")
			}
		case "note":
			s = strings.TrimSpace(s)
			if len(utf16.Encode([]rune(s))) > 500 {
				add(k, "Too big: expected string to have <=500 characters")
			}
		case "recurrence":
			if s != "none" && s != "daily" && s != "weekly" && s != "monthly" {
				add(k, `Invalid option: expected one of "none"|"daily"|"weekly"|"monthly"`)
			}
		case "recurrenceTimezone":
			s = strings.TrimSpace(s)
			n := len(utf16.Encode([]rune(s)))
			if n == 0 {
				add(k, "Too small: expected string to have >=1 characters")
			}
			if n > 100 {
				add(k, "Too big: expected string to have <=100 characters")
			}
		}
		result[k] = s
	}
	if len(fields) > 0 {
		return nil, &inputError{fields: fields, form: []string{}}
	}
	if update && len(result) == 0 {
		return nil, &inputError{fields: map[string][]string{}, form: []string{"At least one field is required"}}
	}
	if s, ok := result["remindAt"].(string); ok {
		t, _ := time.Parse(time.RFC3339Nano, s)
		if !t.After(time.Now()) {
			return nil, &inputError{message: "remindAt must be in the future"}
		}
	}
	if s, ok := result["recurrenceTimezone"].(string); ok {
		if _, e := time.LoadLocation(s); e != nil {
			return nil, &inputError{message: "recurrenceTimezone must be a valid IANA timezone"}
		}
	}
	return result, nil
}
func rowQuery(user, id string) url.Values {
	return url.Values{"user_id": {"eq." + user}, "id": {"eq." + id}}
}
func fetchReminder(r *http.Request, a *core.App, id string) (*reminder, error) {
	q := rowQuery(core.UserID(r), id)
	q.Set("status", "neq.cancelled")
	q.Set("select", selection)
	b, e := db(r.Context(), a, "GET", "reminders", q, nil, "")
	if e != nil {
		return nil, e
	}
	rows, e := reminderRows(b)
	if e != nil || len(rows) == 0 {
		return nil, e
	}
	return &rows[0], nil
}
func dayFor(at, rec, tz string) any {
	if rec != "monthly" {
		return nil
	}
	t, _ := time.Parse(time.RFC3339Nano, at)
	loc, _ := time.LoadLocation(tz)
	return t.In(loc).Day()
}
func registerReminders(mux *http.ServeMux, a *core.App) {
	mux.HandleFunc("GET /api/reminders", func(w http.ResponseWriter, r *http.Request) {
		q := url.Values{"select": {selection}, "user_id": {"eq." + core.UserID(r)}, "status": {"neq.cancelled"}, "order": {"remind_at.asc"}}
		b, e := db(r.Context(), a, "GET", "reminders", q, nil, "")
		if e != nil {
			dbError(w, e)
			return
		}
		rows, e := reminderRows(b)
		if e != nil {
			dbError(w, e)
			return
		}
		items := make([]any, 0, len(rows))
		for _, row := range rows {
			items = append(items, row.mapped())
		}
		core.JSON(w, 200, map[string]any{"items": items})
	})
	mux.HandleFunc("POST /api/reminders", func(w http.ResponseWriter, r *http.Request) {
		in, err := readInput(r, false, true)
		if err != nil {
			err.write(w)
			return
		}
		user := core.UserID(r)
		q := rowQuery(user, in["bookmarkId"].(string))
		q.Set("select", "id")
		b, e := db(r.Context(), a, "GET", "bookmarks", q, nil, "")
		if e != nil {
			dbError(w, e)
			return
		}
		var found []json.RawMessage
		if e = json.Unmarshal(b, &found); e != nil {
			dbError(w, e)
			return
		}
		if len(found) == 0 {
			validation(w, "bookmarkId must reference one of your bookmarks")
			return
		}
		body := map[string]any{"user_id": user, "bookmark_id": in["bookmarkId"], "remind_at": in["remindAt"], "note": in["note"], "status": "pending", "recurrence": in["recurrence"], "recurrence_timezone": in["recurrenceTimezone"], "recurrence_day": dayFor(in["remindAt"].(string), in["recurrence"].(string), in["recurrenceTimezone"].(string)), "is_enabled": true}
		b, e = db(r.Context(), a, "POST", "reminders", url.Values{"select": {selection}}, body, "return=representation")
		if e != nil {
			dbError(w, e)
			return
		}
		rows, e := reminderRows(b)
		if e != nil || len(rows) == 0 {
			dbError(w, e)
			return
		}
		core.JSON(w, 201, map[string]any{"reminder": rows[0].mapped()})
	})
	mux.HandleFunc("PATCH /api/reminders/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !uuidPattern.MatchString(id) {
			(&inputError{form: []string{"Invalid UUID"}}).write(w)
			return
		}
		in, err := readInput(r, true, false)
		if err != nil {
			err.write(w)
			return
		}
		current, e := fetchReminder(r, a, id)
		if e != nil {
			dbError(w, e)
			return
		}
		if current == nil || current.Status != "pending" {
			core.Error(w, 404, "NOT_FOUND", "Reminder not found")
			return
		}
		at, rec, tz, enabled := current.RemindAt, current.Recurrence, current.Timezone, current.Enabled
		note := any(current.Note)
		if v, ok := in["remindAt"]; ok {
			at = v.(string)
		}
		if v, ok := in["recurrence"]; ok {
			rec = v.(string)
		}
		if v, ok := in["recurrenceTimezone"]; ok {
			tz = v.(string)
		}
		if v, ok := in["isEnabled"]; ok {
			enabled = v.(bool)
		}
		if v, ok := in["note"]; ok {
			note = v
		}
		loc, locErr := time.LoadLocation(tz)
		if locErr != nil {
			validation(w, "recurrenceTimezone must be a valid IANA timezone")
			return
		}
		if rec == "none" && !enabled {
			validation(w, "Only recurring reminders can be disabled")
			return
		}
		var day any
		if rec == "monthly" {
			_, a1 := in["remindAt"]
			_, a2 := in["recurrence"]
			_, a3 := in["recurrenceTimezone"]
			if !a1 && !a2 && !a3 && current.Day != nil {
				day = *current.Day
			} else {
				day = dayFor(at, rec, tz)
			}
		}
		if v, ok := in["isEnabled"]; ok && v.(bool) && !current.Enabled && rec != "none" {
			t, _ := time.Parse(time.RFC3339Nano, at)
			if !t.After(time.Now()) {
				var d *int
				if day != nil {
					x := day.(int)
					d = &x
				}
				next, err := nextReminder(t, rec, loc, time.Now(), d)
				if err != nil {
					dbError(w, err)
					return
				}
				at = iso(next)
			}
		}
		q := rowQuery(core.UserID(r), id)
		q.Set("status", "eq.pending")
		q.Set("remind_at", "eq."+current.RemindAt)
		if current.Enabled {
			q.Set("is_enabled", "eq.true")
		} else {
			q.Set("is_enabled", "eq.false")
		}
		q.Set("select", selection)
		body := map[string]any{"remind_at": at, "note": note, "recurrence": rec, "recurrence_timezone": tz, "recurrence_day": day, "is_enabled": enabled}
		b, e := db(r.Context(), a, "PATCH", "reminders", q, body, "return=representation")
		if e != nil {
			dbError(w, e)
			return
		}
		rows, e := reminderRows(b)
		if e != nil {
			dbError(w, e)
			return
		}
		if len(rows) == 0 {
			core.Error(w, 409, "CONFLICT", "Reminder changed while it was being updated")
			return
		}
		core.JSON(w, 200, map[string]any{"reminder": rows[0].mapped()})
	})
	mux.HandleFunc("POST /api/reminders/{id}/reschedule", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !uuidPattern.MatchString(id) {
			(&inputError{form: []string{"Invalid UUID"}}).write(w)
			return
		}
		in, err := readInput(r, false, false)
		if err != nil {
			err.write(w)
			return
		}
		q := rowQuery(core.UserID(r), id)
		q.Set("status", "eq.sent")
		q.Set("select", selection)
		body := map[string]any{"remind_at": in["remindAt"], "note": in["note"], "status": "pending", "sent_at": nil, "recurrence": in["recurrence"], "recurrence_timezone": in["recurrenceTimezone"], "recurrence_day": dayFor(in["remindAt"].(string), in["recurrence"].(string), in["recurrenceTimezone"].(string)), "is_enabled": true}
		b, e := db(r.Context(), a, "PATCH", "reminders", q, body, "return=representation")
		if e != nil {
			dbError(w, e)
			return
		}
		rows, e := reminderRows(b)
		if e != nil {
			dbError(w, e)
			return
		}
		if len(rows) == 0 {
			core.Error(w, 404, "NOT_FOUND", "Reminder not found")
			return
		}
		core.JSON(w, 200, map[string]any{"reminder": rows[0].mapped()})
	})
	mux.HandleFunc("DELETE /api/reminders/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !uuidPattern.MatchString(id) {
			(&inputError{form: []string{"Invalid UUID"}}).write(w)
			return
		}
		q := rowQuery(core.UserID(r), id)
		q.Set("status", "neq.cancelled")
		_, e := db(r.Context(), a, "PATCH", "reminders", q, map[string]any{"status": "cancelled"}, "")
		if e != nil {
			dbError(w, e)
			return
		}
		w.WriteHeader(204)
	})
}
