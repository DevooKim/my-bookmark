package ai

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf16"

	"github.com/rivo/uniseg"
)

func length(s string) int { return len(utf16.Encode([]rune(s))) }
func (p *place) UnmarshalJSON(data []byte) error {
	type plain place
	var v plain
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) != nil || fields == nil || fields["name"] == nil || fields["locality"] == nil || fields["countryCode"] == nil || fields["confidence"] == nil || json.Unmarshal(data, &v) != nil {
		p.Confidence = -1
		return nil
	}
	*p = place(v)
	return nil
}
func truncate(s string, n int) string {
	g := uniseg.NewGraphemes(strings.TrimSpace(s))
	var b strings.Builder
	for i := 0; i < n && g.Next(); i++ {
		b.WriteString(g.Str())
	}
	return strings.TrimRightFunc(b.String(), unicode.IsSpace)
}

var countryPattern = regexp.MustCompile(`^[A-Z]{2}$`)

func validateAnalysis(a *analysis) error {
	bad := errors.New("AI analysis response is malformed")
	a.Title = truncate(a.Title, 40)
	if a.Title == "" {
		return bad
	}
	if a.Summary != nil {
		s := truncate(*a.Summary, 300)
		if s == "" {
			return bad
		}
		a.Summary = &s
	}
	if len(a.Tags) < 2 || len(a.Tags) > 5 {
		return bad
	}
	seen := map[string]bool{}
	for i, t := range a.Tags {
		t = strings.TrimSpace(t)
		if t == "" || length(t) > 20 || seen[t] {
			return bad
		}
		seen[t] = true
		a.Tags[i] = t
	}
	c := a.Category
	if c.Confidence != nil && (*c.Confidence < 0 || *c.Confidence > 1) {
		return bad
	}
	switch c.Type {
	case "none":
	case "existing":
		if c.CategoryID == nil || *c.CategoryID == "" {
			return bad
		}
	case "new":
		if c.Name == nil {
			return bad
		}
		n := strings.TrimSpace(*c.Name)
		if n == "" || length(n) > 16 {
			return bad
		}
		a.Category.Name = &n
	default:
		return bad
	}
	valid := make([]place, 0, len(a.Places))
	for _, p := range a.Places {
		p.Name = strings.TrimSpace(p.Name)
		if p.Name == "" || length(p.Name) > 120 || p.Confidence < 0 || p.Confidence > 1 {
			continue
		}
		if p.Locality != nil {
			v := strings.TrimSpace(*p.Locality)
			if v == "" || length(v) > 120 {
				continue
			}
			p.Locality = &v
		}
		if p.CountryCode != nil {
			v := strings.ToUpper(strings.TrimSpace(*p.CountryCode))
			if !countryPattern.MatchString(v) {
				continue
			}
			p.CountryCode = &v
		}
		valid = append(valid, p)
		if len(valid) == 15 {
			break
		}
	}
	a.Places = valid
	if s := a.Source; s != nil {
		if s.Confidence < 0 || s.Confidence > 1 {
			return bad
		}
		switch s.Platform {
		case "youtube", "instagram", "threads", "x", "tiktok", "github":
		default:
			return bad
		}
		for _, p := range []*string{s.Handle, s.PostURL, s.Repository} {
			if p != nil && strings.TrimSpace(*p) == "" {
				return bad
			}
		}
		if s.Handle != nil && length(*s.Handle) > 100 || s.PostURL != nil && length(*s.PostURL) > 2048 || s.Repository != nil && length(*s.Repository) > 201 {
			return bad
		}
	}
	return nil
}
func identity(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsNumber(r) {
			return unicode.ToLower(r)
		}
		return -1
	}, s)
}
func selectPlaces(in []place) []place {
	out := []place{}
	seen := map[string]bool{}
	for _, p := range in {
		id := identity(p.Name)
		if p.Confidence >= 0.85 && id != "" && !seen[id] {
			seen[id] = true
			out = append(out, p)
		}
	}
	return out
}
func filterTags(tags []string, places []place) []string {
	seen := map[string]bool{}
	for _, p := range places {
		seen[identity(p.Name)] = true
	}
	out := []string{}
	for _, t := range tags {
		if !seen[identity(t)] {
			out = append(out, t)
		}
	}
	return out
}
