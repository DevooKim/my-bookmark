package ai

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestSharedAddressRanges(t *testing.T) {
	for _, tc := range []struct {
		address string
		allowed bool
	}{
		{"100.63.255.255", true}, {"100.64.0.0", false}, {"100.100.100.100", false}, {"100.127.255.255", false}, {"100.128.0.0", true}, {"::ffff:100.100.100.100", false},
	} {
		t.Run(tc.address, func(t *testing.T) {
			if got := safeIP(net.ParseIP(tc.address)); got != tc.allowed {
				t.Fatalf("safeIP(%s) = %v, want %v", tc.address, got, tc.allowed)
			}
		})
	}
}

func TestMetadataTransportRejectsSharedDNSAnswers(t *testing.T) {
	for _, answers := range [][]net.IPAddr{
		{{IP: net.ParseIP("100.100.100.100")}},
		{{IP: net.ParseIP("8.8.8.8")}, {IP: net.ParseIP("100.64.0.1")}},
		{{IP: net.ParseIP("::ffff:100.127.255.255")}},
	} {
		t.Run(fmt.Sprint(answers), func(t *testing.T) {
			var dials atomic.Int32
			tr := metadataTransport(func(context.Context, string) ([]net.IPAddr, error) { return answers, nil }, func(context.Context, string, string) (net.Conn, error) {
				dials.Add(1)
				return nil, fmt.Errorf("unexpected dial")
			})
			defer tr.CloseIdleConnections()
			_, err := (&http.Client{Transport: tr}).Get("http://attacker.example/")
			if err == nil || !strings.Contains(err.Error(), "private address") {
				t.Fatalf("expected private address error, got %v", err)
			}
			if dials.Load() != 0 {
				t.Fatal("dialed a host with a shared address in its DNS answers")
			}
		})
	}
}

func TestMetadataTransportRejectsRedirectToSharedDNSAddress(t *testing.T) {
	var received atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received.Add(1)
		http.Redirect(w, r, "http://private.example/secret", http.StatusFound)
	}))
	defer server.Close()
	var dials atomic.Int32
	resolve := func(_ context.Context, host string) ([]net.IPAddr, error) {
		switch host {
		case "public.example":
			return []net.IPAddr{{IP: net.ParseIP("8.8.8.8")}}, nil
		case "private.example":
			return []net.IPAddr{{IP: net.ParseIP("100.100.100.100")}}, nil
		default:
			return nil, fmt.Errorf("unexpected host %s", host)
		}
	}
	dial := func(ctx context.Context, network, address string) (net.Conn, error) {
		dials.Add(1)
		if address != "8.8.8.8:80" {
			return nil, fmt.Errorf("unexpected dial %s", address)
		}
		return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
	}
	tr := metadataTransport(resolve, dial)
	defer tr.CloseIdleConnections()
	_, err := (&http.Client{Transport: tr}).Get("http://public.example/")
	if err == nil || !strings.Contains(err.Error(), "private address") {
		t.Fatalf("expected redirect to be blocked, got %v", err)
	}
	if received.Load() != 1 || dials.Load() != 1 {
		t.Fatalf("redirect reached a private host: received=%d dials=%d", received.Load(), dials.Load())
	}
}
