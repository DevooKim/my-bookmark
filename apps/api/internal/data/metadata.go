package data

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/html"
	"my-bookmark/api/internal/core"
)

func safeHost(ctx context.Context, host string) bool {
	if strings.EqualFold(host, "localhost") {
		return false
	}
	ips, e := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if e != nil || len(ips) == 0 {
		return false
	}
	for _, ip := range ips {
		if !publicIP(ip.Unmap()) {
			return false
		}
	}
	return true
}
func metadataClient(_ *core.App) *http.Client {
	transport := &http.Transport{ForceAttemptHTTP2: true}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, err
		}
		if len(ips) == 0 {
			return nil, fmt.Errorf("no addresses")
		}
		for _, ip := range ips {
			if !publicIP(ip.Unmap()) {
				return nil, fmt.Errorf("private target")
			}
		}
		var dialer net.Dialer
		var conn net.Conn
		for _, ip := range ips {
			conn, err = dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			if err == nil {
				return conn, nil
			}
		}
		return nil, err
	}
	return &http.Client{Transport: transport, Timeout: 5 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 3 || !safeHost(req.Context(), req.URL.Hostname()) || (req.URL.Scheme != "http" && req.URL.Scheme != "https") {
			return http.ErrUseLastResponse
		}
		return nil
	}}
}
func updateMetadata(a *core.App, user, id, page string, title *string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	host := domain(page)
	metadata := map[string]any{"title": host, "description": nil, "site_name": nil, "favicon_url": "https://www.google.com/s2/favicons?domain=" + url.QueryEscape(host) + "&sz=64", "og_image_url": nil}
	u, e := url.Parse(page)
	if e == nil && safeHost(ctx, u.Hostname()) {
		req, e := http.NewRequestWithContext(ctx, "GET", page, nil)
		if e == nil {
			req.Header.Set("User-Agent", "MyBookmarkBot/1.0")
			resp, e := metadataClient(a).Do(req)
			if e == nil {
				defer resp.Body.Close()
				if resp.StatusCode >= 200 && resp.StatusCode < 300 && strings.Contains(resp.Header.Get("Content-Type"), "text/html") {
					raw, e := io.ReadAll(io.LimitReader(resp.Body, 1024*1024+1))
					if e == nil && len(raw) <= 1024*1024 {
						extractMetadata(string(raw), resp.Request.URL, metadata)
					}
				}
			}
		}
	}
	if title != nil {
		metadata["title"] = *title
	}
	_, _ = db(context.Background(), a, "PATCH", "bookmarks", oneQuery(user, id), metadata, nil)
}
func extractMetadata(src string, base *url.URL, out map[string]any) {
	z := html.NewTokenizer(strings.NewReader(src))
	meta := map[string]string{}
	var title string
	inTitle := false
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			break
		}
		if tt == html.TextToken && inTitle && title == "" {
			title = strings.TrimSpace(string(z.Text()))
		}
		if tt == html.EndTagToken {
			name, _ := z.TagName()
			if string(name) == "title" {
				inTitle = false
			}
			continue
		}
		if tt != html.StartTagToken && tt != html.SelfClosingTagToken {
			continue
		}
		name, more := z.TagName()
		tag := string(name)
		attrs := map[string]string{}
		for more {
			k, v, m := z.TagAttr()
			attrs[string(k)] = strings.TrimSpace(string(v))
			more = m
		}
		if tag == "title" {
			inTitle = true
		}
		if tag == "meta" {
			key := attrs["property"]
			if key == "" {
				key = attrs["name"]
			}
			if meta[key] == "" {
				meta[key] = attrs["content"]
			}
		}
		if tag == "link" && meta["icon"] == "" {
			for _, rel := range strings.Fields(attrs["rel"]) {
				if rel == "icon" {
					meta["icon"] = attrs["href"]
				}
			}
		}
	}
	if meta["og:title"] != "" {
		out["title"] = meta["og:title"]
	} else if title != "" {
		out["title"] = title
	}
	description := meta["og:description"]
	if description == "" {
		description = meta["description"]
	}
	if description != "" {
		out["description"] = description
	}
	if meta["og:site_name"] != "" {
		out["site_name"] = meta["og:site_name"]
	}
	for source, target := range map[string]string{"icon": "favicon_url", "og:image": "og_image_url"} {
		if meta[source] != "" {
			u, e := url.Parse(meta[source])
			if e == nil {
				out[target] = base.ResolveReference(u).String()
			}
		}
	}
}
