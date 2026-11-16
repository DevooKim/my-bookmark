package ai

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/html"
)

type metadata struct{ Title, Description, SiteName, Favicon, Image *string }

func strptr(s string) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return &s
}
func domain(raw string) string {
	u, e := url.Parse(raw)
	if e != nil {
		return ""
	}
	return strings.TrimPrefix(u.Hostname(), "www.")
}
func safeIP(ip net.IP) bool {
	if ip == nil || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast() {
		return false
	}
	if v4 := ip.To4(); v4 != nil && v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
		return false
	}
	return true
}
func metadataTransport(resolve func(context.Context, string) ([]net.IPAddr, error), dial func(context.Context, string, string) (net.Conn, error)) *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := resolve(ctx, host)
		if err != nil {
			return nil, err
		}
		for _, ip := range ips {
			if !safeIP(ip.IP) {
				return nil, &net.AddrError{Err: "private address", Addr: host}
			}
		}
		if len(ips) == 0 {
			return nil, &net.AddrError{Err: "no address", Addr: host}
		}
		return dial(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
	}
	return transport
}
func metadataFetch(ctx context.Context, raw string) metadata {
	host := domain(raw)
	title := host
	fav := "https://www.google.com/s2/favicons?domain=" + url.QueryEscape(host) + "&sz=64"
	fallback := metadata{Title: &title, Favicon: &fav}
	u, e := url.Parse(raw)
	if e != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return fallback
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	transport := metadataTransport(net.DefaultResolver.LookupIPAddr, (&net.Dialer{}).DialContext)
	defer transport.CloseIdleConnections()
	c := &http.Client{Transport: transport, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 3 || req.URL.Scheme != "http" && req.URL.Scheme != "https" {
			return http.ErrUseLastResponse
		}
		return nil
	}}
	req, e := http.NewRequestWithContext(ctx, "GET", raw, nil)
	if e != nil {
		return fallback
	}
	req.Header.Set("User-Agent", "MyBookmarkBot/1.0")
	resp, e := c.Do(req)
	if e != nil {
		return fallback
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || !strings.Contains(resp.Header.Get("Content-Type"), "text/html") {
		return fallback
	}
	b, e := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if e != nil || len(b) > 1<<20 {
		return fallback
	}
	doc, e := html.Parse(strings.NewReader(string(b)))
	if e != nil {
		return fallback
	}
	var ogTitle, htmlTitle, ogDesc, desc, site, icon, image string
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			attrs := map[string]string{}
			for _, a := range n.Attr {
				attrs[strings.ToLower(a.Key)] = strings.TrimSpace(a.Val)
			}
			switch n.Data {
			case "title":
				if htmlTitle == "" && n.FirstChild != nil {
					htmlTitle = strings.TrimSpace(n.FirstChild.Data)
				}
			case "meta":
				switch {
				case attrs["property"] == "og:title" && ogTitle == "":
					ogTitle = attrs["content"]
				case attrs["property"] == "og:description" && ogDesc == "":
					ogDesc = attrs["content"]
				case attrs["name"] == "description" && desc == "":
					desc = attrs["content"]
				case attrs["property"] == "og:site_name" && site == "":
					site = attrs["content"]
				case attrs["property"] == "og:image" && image == "":
					image = attrs["content"]
				}
			case "link":
				for _, v := range strings.Fields(attrs["rel"]) {
					if v == "icon" && icon == "" {
						icon = attrs["href"]
					}
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	abs := func(s string) *string {
		if s == "" {
			return nil
		}
		v, e := resp.Request.URL.Parse(s)
		if e != nil {
			return nil
		}
		return strptr(v.String())
	}
	if ogTitle != "" {
		fallback.Title = strptr(ogTitle)
	} else if htmlTitle != "" {
		fallback.Title = strptr(htmlTitle)
	}
	if ogDesc != "" {
		fallback.Description = strptr(ogDesc)
	} else {
		fallback.Description = strptr(desc)
	}
	fallback.SiteName = strptr(site)
	if v := abs(icon); v != nil {
		fallback.Favicon = v
	}
	fallback.Image = abs(image)
	return fallback
}
