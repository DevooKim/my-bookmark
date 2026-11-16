package core

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Monitor struct {
	mu                                        sync.Mutex
	cronAt                                    time.Time
	cronFailed                                bool
	pushConfigured                            bool
	cronFailureAlert                          bool
	fullScans, partialFailures, consecutiveAI int
	partialStarted, lastAI                    time.Time
	windows                                   map[string][]time.Time
	alerts                                    map[string]time.Time
}

func NewMonitor(a *App) *Monitor {
	m := &Monitor{windows: make(map[string][]time.Time), alerts: make(map[string]time.Time)}
	m.pushConfigured = os.Getenv("VAPID_PUBLIC_KEY") != "" && os.Getenv("VAPID_PRIVATE_KEY") != "" && os.Getenv("VAPID_SUBJECT") != ""
	a.CronStarted = func() { m.mu.Lock(); m.cronAt = time.Now(); m.cronFailed = false; m.mu.Unlock() }
	a.CronFinished = m.cronFinished
	a.AIUsage = m.aiUsage
	return m
}
func (m *Monitor) Ready(ctx context.Context, a *App) (bool, map[string]string) {
	m.mu.Lock()
	push := m.pushConfigured
	cron := !m.cronAt.IsZero() && !m.cronFailed && time.Since(m.cronAt) <= 3*time.Minute
	m.mu.Unlock()
	_, status, err := a.DB(ctx, "GET", "bookmarks", url.Values{"select": {"id"}, "limit": {"1"}}, nil, nil)
	state := func(ok bool) string {
		if ok {
			return "ok"
		}
		return "failed"
	}
	db := err == nil && status >= 200 && status < 300
	return db && push && cron, map[string]string{"database": state(db), "push": state(push), "reminderCron": state(cron)}
}
func (m *Monitor) record(key string, window time.Duration, threshold int) (int, bool) {
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	values := m.windows[key]
	start := 0
	for start < len(values) && now.Sub(values[start]) > window {
		start++
	}
	values = append(values[start:], now)
	m.windows[key] = values
	return len(values), len(values) == threshold
}
func (m *Monitor) aiUsage(success bool) {
	m.mu.Lock()
	if success {
		m.consecutiveAI = 0
		m.mu.Unlock()
		return
	}
	if time.Since(m.lastAI) > 15*time.Minute {
		m.consecutiveAI = 0
	}
	m.lastAI = time.Now()
	m.consecutiveAI++
	consecutive := m.consecutiveAI
	m.mu.Unlock()
	count, crossed := m.record("ai", 15*time.Minute, 5)
	if consecutive == 3 {
		m.notify("ai:consecutive-failures", "warning", "AI 분석 연속 실패", "ai", "AI 분석이 3회 연속 실패했습니다", map[string]string{"발생량": "최근 15분 3회"})
	} else if crossed {
		m.notify("ai:failure-volume", "warning", "AI 분석 실패 증가", "ai", "AI 분석 실패량이 임계치를 넘었습니다", map[string]string{"발생량": fmt.Sprintf("최근 15분 %d회", count)})
	}
}
func (m *Monitor) cronFinished(s CronStats, err error) {
	m.mu.Lock()
	now := time.Now()
	if err != nil {
		m.cronFailed = true
		first := !m.cronFailureAlert
		m.cronFailureAlert = true
		m.mu.Unlock()
		if first {
			m.notify("reminder:cron-failure", "critical", "리마인더 cron 실패", "reminder-cron", "리마인더 cron 실행 중 예외가 발생했습니다", nil)
		}
		return
	}
	recovered := m.cronFailureAlert
	m.cronFailureAlert = false
	m.cronFailed = false
	m.cronAt = now
	if s.Scanned == 20 {
		m.fullScans++
	} else {
		m.fullScans = 0
	}
	backlog := m.fullScans == 3
	if s.Sent > 0 && s.Failed > 0 {
		if m.partialFailures == 0 {
			m.partialStarted = now
		}
		m.partialFailures += s.Failed
	}
	partial := 0
	if m.partialFailures > 0 && now.Sub(m.partialStarted) >= 15*time.Minute {
		partial = m.partialFailures
		m.partialFailures = 0
	}
	m.mu.Unlock()
	if recovered {
		m.notify("reminder:cron-recovered", "recovered", "리마인더 cron 복구", "reminder-cron", "리마인더 cron이 다시 정상 실행되었습니다", nil)
	}
	if backlog {
		m.notify("reminder:backlog", "warning", "리마인더 backlog 감지", "reminder-cron", "리마인더 조회 한도가 3회 연속 가득 찼습니다", map[string]string{"발생량": "최근 3분 3회"})
	}
	if s.Claimed > 0 && s.Sent == 0 && s.Failed > 0 {
		m.notify("push:all-deliveries-failed", "warning", "리마인더 Push 전송 실패", "push", "클레임한 리마인더의 모든 유효 Push 전송이 실패했습니다", map[string]string{"발생량": fmt.Sprintf("%d회", s.Failed)})
	}
	if partial > 0 {
		m.notify("push:partial-failures", "warning", "Push 일부 전송 실패", "push", "일부 Push 전송 실패가 누적되었습니다", map[string]string{"발생량": fmt.Sprintf("최근 15분 %d회", partial)})
	}
}
func (m *Monitor) notify(fingerprint, severity, title, component, summary string, extra map[string]string) {
	webhook := os.Getenv("DISCORD_ALERT_WEBHOOK_URL")
	if webhook == "" {
		return
	}
	m.mu.Lock()
	if time.Since(m.alerts[fingerprint]) < 10*time.Minute {
		m.mu.Unlock()
		return
	}
	m.alerts[fingerprint] = time.Now()
	m.mu.Unlock()
	go func() {
		env := os.Getenv("ALERT_ENV")
		if env == "" {
			env = "home-production"
		}
		color := 0xf59e0b
		label := "WARNING"
		symbol := "🟡"
		if severity == "critical" {
			color = 0xdc2626
			label = "CRITICAL"
			symbol = "🔴"
		} else if severity == "recovered" {
			color = 0x16a34a
			label = "RECOVERED"
			symbol = "🟢"
		}
		fields := []map[string]any{{"name": "환경", "value": env, "inline": true}, {"name": "컴포넌트", "value": component, "inline": true}}
		for k, v := range extra {
			fields = append(fields, map[string]any{"name": k, "value": v, "inline": true})
		}
		fields = append(fields, map[string]any{"name": "오류 ID", "value": fingerprint, "inline": false})
		payload, _ := json.Marshal(map[string]any{"embeds": []any{map[string]any{"title": symbol + " [" + label + "] " + title, "description": summary, "color": color, "fields": fields, "timestamp": time.Now().UTC().Format(time.RFC3339)}}})
		client := &http.Client{Timeout: 3 * time.Second}
		for attempt := 0; attempt < 2; attempt++ {
			resp, err := client.Post(webhook, "application/json", bytes.NewReader(payload))
			if err == nil {
				_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
				resp.Body.Close()
				if resp.StatusCode >= 200 && resp.StatusCode < 300 {
					return
				}
				if resp.StatusCode != 429 && resp.StatusCode < 500 {
					break
				}
				if resp.StatusCode == 429 {
					seconds, _ := strconv.ParseFloat(resp.Header.Get("Retry-After"), 64)
					if seconds > 3 {
						seconds = 3
					}
					if seconds > 0 {
						time.Sleep(time.Duration(seconds * float64(time.Second)))
						continue
					}
				}
			}
			time.Sleep(250 * time.Millisecond)
		}
		log.Print("Discord alert delivery failed")
	}()
}

var sensitivePath = regexp.MustCompile(`(?i)(?:^|/)\.(?:env|git)(?:/|$)|(?:^|/)wp-admin(?:/|$)|\.\.[/\\]`)

func sourceIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	trust := os.Getenv("TRUST_PROXY")
	hops, _ := strconv.Atoi(trust)
	if trust == "true" {
		hops = 1 << 20
	}
	if hops <= 0 {
		return host
	}
	forwarded := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	if len(forwarded) == 1 && strings.TrimSpace(forwarded[0]) == "" {
		return host
	}
	chain := append(forwarded, host)
	i := len(chain) - 1 - hops
	if i < 0 {
		i = 0
	}
	return strings.TrimSpace(chain[i])
}
func SourceIP(r *http.Request) string { return sourceIP(r) }

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	if w.status != 0 {
		return
	}
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}
func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(200)
	}
	return w.ResponseWriter.Write(b)
}
func (m *Monitor) HTTP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := sourceIP(r)
		p := r.URL.Path
		extra := map[string]string{"출처 IP": ip, "Method": r.Method, "경로": p}
		if sensitivePath.MatchString(p) {
			m.notify("security:sensitive-path:"+ip, "warning", "민감 경로 탐색", "security", "민감한 서버 경로에 대한 접근이 감지되었습니다", extra)
		}
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		code := sw.status
		if code == 0 {
			code = 200
		}
		kind, title, windowLabel := "", "", ""
		window := time.Minute
		threshold := 5
		switch {
		case code == 401:
			kind, title, windowLabel = "authentication", "반복 인증 실패", "1분"
		case code == 404 || code == 405:
			kind, title, windowLabel = "route-scan", "반복 경로 탐색", "5분"
			window = 5 * time.Minute
			threshold = 20
		case code == 413:
			kind, title, windowLabel = "malformed", "반복 비정상 요청", "10분"
			window = 10 * time.Minute
		case code == 429:
			kind, title, windowLabel = "rate-limit", "Rate limit 반복 도달", "10분"
			window = 10 * time.Minute
			threshold = 20
		}
		if kind != "" {
			if count, crossed := m.record("security:"+kind+":"+ip, window, threshold); crossed {
				extra["상태"] = strconv.Itoa(code)
				extra["발생량"] = fmt.Sprintf("최근 %s %d회", windowLabel, count)
				m.notify("security:"+kind+":"+ip, "warning", title, "security", "동일 출처의 비정상 접근이 임계치를 넘었습니다", extra)
			}
		}
		if code >= 500 {
			m.notify("http:unexpected:"+strconv.Itoa(code), "critical", "예상하지 못한 API 오류", "api", "API가 서버 오류를 반환했습니다", map[string]string{"Method": r.Method, "경로": p, "상태": strconv.Itoa(code)})
		}
	})
}
