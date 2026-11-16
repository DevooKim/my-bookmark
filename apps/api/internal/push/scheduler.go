package push

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"strings"
	"time"
	_ "time/tzdata"

	"my-bookmark/api/internal/core"
)

// nextReminder advances in local calendar time and resolves offsets in the same
// two passes used by the original scheduler, including daylight-saving gaps.
func nextReminder(scheduled time.Time, recurrence string, loc *time.Location, now time.Time, day *int) (time.Time, error) {
	local := scheduled.In(loc)
	y, m, d := local.Date()
	h, min, sec := local.Clock()
	calendar := time.Date(y, m, d, h, min, sec, 0, time.UTC)
	for range 10000 {
		switch recurrence {
		case "daily":
			calendar = calendar.AddDate(0, 0, 1)
		case "weekly":
			calendar = calendar.AddDate(0, 0, 7)
		case "monthly":
			target := calendar.Day()
			if day != nil {
				target = *day
			}
			y, m, _ := calendar.Date()
			first := time.Date(y, m+1, 1, h, min, sec, 0, time.UTC)
			last := time.Date(first.Year(), first.Month()+1, 0, 0, 0, 0, 0, time.UTC).Day()
			if target > last {
				target = last
			}
			calendar = time.Date(first.Year(), first.Month(), target, h, min, sec, 0, time.UTC)
		default:
			return time.Time{}, errors.New("invalid recurrence")
		}
		offset := func(t time.Time) time.Duration {
			_, seconds := t.In(loc).Zone()
			return time.Duration(seconds) * time.Second
		}
		first := calendar.Add(-offset(calendar))
		candidate := calendar.Add(-offset(first))
		if candidate.After(now) {
			return candidate, nil
		}
	}
	return time.Time{}, errors.New("unable to calculate next reminder occurrence")
}

func Start(ctx context.Context, a *core.App) {
	if !configured() || ValidateConfig() != nil || os.Getenv("NODE_ENV") == "test" || ctx.Err() != nil {
		return
	}
	if a.CronStarted != nil {
		a.CronStarted()
	}
	go func() {
		timer := time.NewTimer(time.Until(time.Now().Truncate(time.Minute).Add(time.Minute)))
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				stats, err := processDue(ctx, a, time.Now())
				if a.CronFinished != nil {
					a.CronFinished(stats, err)
				}
				if err != nil {
					log.Printf("reminder cron failed: %v", err)
				}
				timer.Reset(time.Until(time.Now().Truncate(time.Minute).Add(time.Minute)))
			}
		}
	}()
}
func processDue(ctx context.Context, a *core.App, now time.Time) (core.CronStats, error) {
	var stats core.CronStats
	q := url.Values{"select": {"id,user_id,bookmark_id,remind_at,note,recurrence,recurrence_timezone,recurrence_day,bookmarks!inner(id,kind,url,title)"}, "status": {"eq.pending"}, "is_enabled": {"eq.true"}, "remind_at": {"lte." + iso(now)}, "order": {"remind_at.asc"}, "limit": {"20"}}
	b, e := db(ctx, a, "GET", "reminders", q, nil, "")
	if e != nil {
		return stats, e
	}
	rows, e := reminderRows(b)
	if e != nil {
		return stats, e
	}
	stats.Scanned = len(rows)
	for _, row := range rows {
		var bm bookmark
		if len(row.Bookmarks) == 0 || string(row.Bookmarks) == "null" {
			return stats, errors.New("reminder bookmark is missing")
		}
		if row.Bookmarks[0] == '[' {
			var list []bookmark
			if e = json.Unmarshal(row.Bookmarks, &list); e != nil {
				return stats, e
			}
			if len(list) == 0 {
				return stats, errors.New("reminder bookmark is missing")
			}
			bm = list[0]
		} else if e = json.Unmarshal(row.Bookmarks, &bm); e != nil {
			return stats, e
		}
		updates := map[string]any{"status": "sent", "sent_at": iso(now)}
		if row.Recurrence != "none" {
			loc, err := time.LoadLocation(row.Timezone)
			if err != nil {
				return stats, err
			}
			at, err := time.Parse(time.RFC3339Nano, row.RemindAt)
			if err != nil {
				return stats, err
			}
			next, err := nextReminder(at, row.Recurrence, loc, now, row.Day)
			if err != nil {
				return stats, err
			}
			updates["status"] = "pending"
			updates["remind_at"] = iso(next)
		}
		claim := url.Values{"id": {"eq." + row.ID}, "status": {"eq.pending"}, "is_enabled": {"eq.true"}, "remind_at": {"eq." + row.RemindAt}, "select": {"id"}}
		b, e = db(ctx, a, "PATCH", "reminders", claim, updates, "return=representation")
		if e != nil {
			return stats, e
		}
		var claimed []json.RawMessage
		if e = json.Unmarshal(b, &claimed); e != nil {
			return stats, e
		}
		if len(claimed) == 0 {
			continue
		}
		stats.Claimed++
		subs, err := subscriptions(ctx, a, row.UserID)
		if err != nil {
			return stats, err
		}
		var fallback, target string
		if bm.Kind == "image" {
			fallback = "이미지"
			target = origin() + "/images/" + bm.ID
		} else {
			if bm.URL == nil {
				return stats, errors.New("link reminder bookmark is missing its URL")
			}
			u, err := url.Parse(*bm.URL)
			if err != nil || u.Hostname() == "" {
				return stats, fmt.Errorf("invalid bookmark URL: %q", *bm.URL)
			}
			fallback = strings.TrimPrefix(u.Hostname(), "www.")
			target = *bm.URL
		}
		title := fallback
		if bm.Title != nil {
			title = *bm.Title
		}
		body := fallback
		if row.Note != nil {
			body = *row.Note
		}
		for _, s := range subs {
			ok, expired, err := send(ctx, a, s, payload{Title: "🔖 " + title, Body: body, URL: target})
			if err != nil {
				return stats, err
			}
			if ok {
				stats.Sent++
			} else if expired {
				stats.Expired++
			} else {
				stats.Failed++
			}
		}
	}
	return stats, nil
}
