package core

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestJWKSRefreshCooldownAndConcurrentRequests(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			close(started)
			<-release
		}
		JSON(w, 200, map[string]any{"keys": []any{map[string]any{"kid": "valid"}}})
	}))
	defer server.Close()
	t.Setenv("SUPABASE_URL", server.URL)
	remoteKeys.Lock()
	remoteKeys.keys = []jwk{{Kid: "valid"}}
	remoteKeys.fetched = time.Now()
	remoteKeys.lastAttempt = time.Now().Add(-time.Minute)
	remoteKeys.refreshing = nil
	remoteKeys.Unlock()
	t.Cleanup(func() {
		remoteKeys.Lock()
		remoteKeys.keys = nil
		remoteKeys.fetched = time.Time{}
		remoteKeys.lastAttempt = time.Time{}
		remoteKeys.refreshing = nil
		remoteKeys.Unlock()
	})
	app := &App{Client: server.Client()}
	var wg sync.WaitGroup
	for i := range 20 {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if _, err := app.jwk(context.Background(), fmt.Sprintf("unknown-%d", i)); err == nil {
				t.Errorf("unknown key %d unexpectedly accepted", i)
			}
		}(i)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("JWKS refresh did not start")
	}
	done := make(chan error, 1)
	go func() { _, err := app.jwk(context.Background(), "valid"); done <- err }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("cached key: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("cached key blocked behind remote refresh")
	}
	close(release)
	wg.Wait()
	for i := range 20 {
		if _, err := app.jwk(context.Background(), fmt.Sprintf("another-%d", i)); err == nil {
			t.Fatal("unknown key unexpectedly accepted")
		}
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("JWKS calls = %d, want one refresh", got)
	}
}
