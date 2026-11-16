package data

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"my-bookmark/api/internal/core"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// The resolver switches from a public address to the shared address range after the initial
// lookup, simulating a DNS rebind between validation and actual connection.
func TestMetadataRejectsDNSRebinding(t *testing.T) {
	listener, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	var rebound atomic.Bool
	done := make(chan struct{})
	go func() {
		defer close(done)
		buf := make([]byte, 1500)
		for {
			n, addr, err := listener.ReadFrom(buf)
			if err != nil {
				return
			}
			if n < 17 {
				continue
			}
			q := append([]byte(nil), buf[:n]...)
			end := 12
			for end < n && q[end] != 0 {
				end += int(q[end]) + 1
			}
			if end+5 > n {
				continue
			}
			end++
			typ := binary.BigEndian.Uint16(q[end : end+2])
			end += 4
			response := append([]byte(nil), q[:end]...)
			response[2] = 0x81
			response[3] = 0x80
			binary.BigEndian.PutUint16(response[6:8], 0)
			binary.BigEndian.PutUint16(response[8:10], 0)
			binary.BigEndian.PutUint16(response[10:12], 0)
			if typ == 1 {
				binary.BigEndian.PutUint16(response[6:8], 1)
				ip := []byte{93, 184, 216, 34}
				if rebound.Load() {
					ip = []byte{100, 64, 0, 1}
				}
				response = append(response, 0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 1, 0, 4)
				response = append(response, ip...)
			}
			_, _ = listener.WriteTo(response, addr)
		}
	}()
	old := net.DefaultResolver
	net.DefaultResolver = &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, "udp", listener.LocalAddr().String())
	}}
	defer func() { net.DefaultResolver = old; listener.Close(); <-done }()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if !safeHost(ctx, "rebind.example") {
		t.Fatal("initial public DNS answer rejected")
	}
	rebound.Store(true)
	var used atomic.Bool
	app := &core.App{Client: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		used.Store(true)
		return nil, errors.New("unsafe shared client used")
	})}}
	req, _ := http.NewRequestWithContext(ctx, "GET", "http://rebind.example/", nil)
	resp, err := metadataClient(app).Do(req)
	if resp != nil {
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}
	if err == nil || !strings.Contains(err.Error(), "private target") {
		t.Fatalf("expected blocked rebinding, got %v", err)
	}
	if used.Load() {
		t.Fatal("metadata used the application's shared transport")
	}
	redirect, _ := http.NewRequestWithContext(ctx, "GET", "http://rebind.example/private", nil)
	if err := metadataClient(app).CheckRedirect(redirect, []*http.Request{req}); !errors.Is(err, http.ErrUseLastResponse) {
		t.Fatalf("private DNS redirect accepted: %v", err)
	}
}

func TestMetadataRedirectRestrictions(t *testing.T) {
	client := metadataClient(&core.App{})
	initial, _ := http.NewRequest("GET", "https://example.com/", nil)
	for _, target := range []string{"http://127.0.0.1/private", "http://100.64.0.1/private", "http://100.127.255.255/private", "http://localhost/private", "ftp://example.com/file"} {
		req, _ := http.NewRequest("GET", target, nil)
		if err := client.CheckRedirect(req, []*http.Request{initial}); !errors.Is(err, http.ErrUseLastResponse) {
			t.Errorf("redirect to %s accepted: %v", target, err)
		}
	}
	req, _ := http.NewRequest("GET", "https://example.com/", nil)
	if err := client.CheckRedirect(req, []*http.Request{initial, initial, initial, initial}); !errors.Is(err, http.ErrUseLastResponse) {
		t.Fatalf("redirect limit not enforced: %v", err)
	}
}

func TestPublicIPSharedAddressSpace(t *testing.T) {
	for _, tc := range []struct {
		address string
		allowed bool
	}{{"100.63.255.255", true}, {"100.64.0.0", false}, {"100.100.100.100", false}, {"100.127.255.255", false}, {"100.128.0.0", true}, {"::ffff:100.64.0.1", false}} {
		if got := publicIP(netip.MustParseAddr(tc.address)); got != tc.allowed {
			t.Errorf("publicIP(%s) = %v, want %v", tc.address, got, tc.allowed)
		}
	}
}
