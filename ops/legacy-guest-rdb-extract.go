// Run this file from the pinned github.com/upstash/rdb module checkout described
// in docs/legacy-guest-archive.md. It is an offline migration tool, not app code.
package main

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/upstash/rdb"
)

type guestExtractor struct {
	value           string
	found           bool
	audit           []json.RawMessage
	versions        map[string]int
	sessions        map[string]json.RawMessage
	sessionExpiry   map[string]time.Time
	personVersions  map[string]string
	reports         map[string]json.RawMessage
	reportState     map[string]string
	reportExpiry    map[string]time.Time
	votingStrings   map[string]string
	votingHashes    map[string]map[string]string
	votingExpiry    map[string]time.Time
	wordMetas       map[string]json.RawMessage
	wordIndex       map[string]bool
	wordShares      map[string]json.RawMessage
	wordShareIndex  map[string]map[string]bool
	wordShareSlugs  map[string]bool
	wordShareExpiry map[string]time.Time
}

func (*guestExtractor) AllowPartialRead() bool { return false }
func (g *guestExtractor) HandleString(key, value string) error {
	if strings.HasPrefix(key, "words:meta:") && !strings.HasSuffix(key, ":mutation-lock") {
		if !json.Valid([]byte(value)) {
			return errors.New("invalid word metadata JSON")
		}
		g.wordMetas[strings.TrimPrefix(key, "words:meta:")] = json.RawMessage(value)
		return nil
	}
	if strings.HasPrefix(key, "words:share:") && !strings.HasPrefix(key, "words:share:pin-rl:") {
		if !json.Valid([]byte(value)) {
			return errors.New("invalid word share JSON")
		}
		g.wordShares[strings.TrimPrefix(key, "words:share:")] = json.RawMessage(value)
		return nil
	}
	if strings.HasPrefix(key, "best-dressed:") {
		g.votingStrings[key] = value
		return nil
	}
	if strings.HasPrefix(key, "diagnostic-report:v1:") || strings.HasPrefix(key, "user-report:") {
		if !json.Valid([]byte(value)) {
			return errors.New("invalid report JSON")
		}
		g.reports[key] = json.RawMessage(value)
		return nil
	}
	if strings.HasPrefix(key, "diagnostic-report:rate:v1:") ||
		strings.HasPrefix(key, "diagnostic-report:duplicate:v1:") ||
		strings.HasPrefix(key, "diagnostic-report:idempotency:v1:") ||
		strings.HasPrefix(key, "diagnostic-report:follow-up-lock:v1:") {
		g.reportState[key] = value
		return nil
	}
	if strings.HasPrefix(key, "event-scoring:attendee-session:") {
		if !json.Valid([]byte(value)) {
			return errors.New("invalid attendee session JSON")
		}
		g.sessions[key] = json.RawMessage(value)
		return nil
	}
	if strings.HasPrefix(key, "event-scoring:attendee-person-session-version:") {
		g.personVersions[strings.TrimPrefix(key, "event-scoring:attendee-person-session-version:")] = value
		return nil
	}
	if strings.HasPrefix(key, "auth:token-version:") {
		role := strings.TrimPrefix(key, "auth:token-version:")
		if role != "admin" && role != "upload" && role != "staff" {
			return errors.New("unknown auth token-version role")
		}
		version, err := strconv.Atoi(value)
		if err != nil || version < 1 {
			return errors.New("invalid auth token version")
		}
		if g.versions == nil {
			g.versions = make(map[string]int)
		}
		g.versions[role] = version
		return nil
	}
	if key != "guest:list" {
		return nil
	}
	if g.found {
		return errors.New("duplicate guest:list key")
	}
	g.value, g.found = value, true
	return nil
}
func (g *guestExtractor) HandleExpireTime(key string, expires time.Time) {
	if strings.HasPrefix(key, "words:share:") && !strings.HasPrefix(key, "words:share:pin-rl:") {
		g.wordShareExpiry[strings.TrimPrefix(key, "words:share:")] = expires
	}
	if strings.HasPrefix(key, "event-scoring:attendee-session:") {
		g.sessionExpiry[key] = expires
	}
	if strings.HasPrefix(key, "diagnostic-report:") || strings.HasPrefix(key, "user-report:") {
		g.reportExpiry[key] = expires
	}
	if strings.HasPrefix(key, "best-dressed:") {
		g.votingExpiry[key] = expires
	}
}
func (*guestExtractor) HandleListEnding(string, uint64)                     {}
func (*guestExtractor) HandleZsetEnding(string, uint64)                     {}
func (*guestExtractor) HandleStreamEnding(string, uint64)                   {}
func (*guestExtractor) HandleArrayEnding(string, uint64, uint64)            {}
func (*guestExtractor) HandleLibrary(string) error                          { return nil }
func (*guestExtractor) HandleModule(string, string, rdb.ModuleMarker) error { return nil }
func (g *guestExtractor) ListEntryHandler(key string) func(string) error {
	return func(value string) error {
		if key == "auth:upload-open:audit" {
			g.audit = append(g.audit, json.RawMessage(value))
		}
		return nil
	}
}
func (g *guestExtractor) SetEntryHandler(key string) func(string) error {
	return func(value string) error {
		if key == "words:index" {
			g.wordIndex[value] = true
		}
		if key == "words:share-slugs" {
			g.wordShareSlugs[value] = true
		}
		if strings.HasPrefix(key, "words:share-index:") {
			slug := strings.TrimPrefix(key, "words:share-index:")
			if g.wordShareIndex[slug] == nil {
				g.wordShareIndex[slug] = make(map[string]bool)
			}
			g.wordShareIndex[slug][value] = true
		}
		return nil
	}
}
func (*guestExtractor) ZsetEntryHandler(string) func(string, float64) error {
	return func(string, float64) error { return nil }
}
func (g *guestExtractor) HashEntryHandler(key string) func(string, string) error {
	return func(field, value string) error {
		if key == "best-dressed:votes:v2" || strings.HasPrefix(key, "best-dressed:voted:") {
			if g.votingHashes[key] == nil {
				g.votingHashes[key] = make(map[string]string)
			}
			g.votingHashes[key][field] = value
		}
		return nil
	}
}
func (*guestExtractor) HashWithExpEntryHandler(string) func(string, string, time.Time) error {
	return func(string, string, time.Time) error { return nil }
}
func (*guestExtractor) StreamEntryHandler(string) func(rdb.StreamEntry) error {
	return func(rdb.StreamEntry) error { return nil }
}
func (*guestExtractor) StreamGroupHandler(string) func(rdb.StreamConsumerGroup) error {
	return func(rdb.StreamConsumerGroup) error { return nil }
}
func (*guestExtractor) ArrayEntryHandler(string) func(uint64, string) error {
	return func(uint64, string) error { return nil }
}

func main() {
	if len(os.Args) < 3 || len(os.Args) > 10 {
		panic("usage: go run legacy-guest-rdb-extract.go <absolute-rdb-path> <absolute-new-guest-json-path> [absolute-new-upload-audit-json-path] [absolute-new-auth-versions-json-path] [absolute-new-attendee-sessions-json-path] [absolute-new-reports-json-path] [absolute-new-best-dressed-json-path] [absolute-new-words-json-path] [absolute-new-word-shares-json-path]")
	}
	source, destination := os.Args[1], os.Args[2]
	if err := rdb.VerifyFile(source, rdb.VerifyFileOptions{
		MaxDataSize: 64 << 20, MaxEntrySize: 16 << 20, MaxValueSize: 16 << 20,
		MaxStreamPELSize: 10000,
	}); err != nil {
		panic(fmt.Errorf("RDB integrity verification failed: %w", err))
	}
	extractor := &guestExtractor{
		versions:        make(map[string]int),
		sessions:        make(map[string]json.RawMessage),
		sessionExpiry:   make(map[string]time.Time),
		personVersions:  make(map[string]string),
		reports:         make(map[string]json.RawMessage),
		reportState:     make(map[string]string),
		reportExpiry:    make(map[string]time.Time),
		votingStrings:   make(map[string]string),
		votingHashes:    make(map[string]map[string]string),
		votingExpiry:    make(map[string]time.Time),
		wordMetas:       make(map[string]json.RawMessage),
		wordIndex:       make(map[string]bool),
		wordShares:      make(map[string]json.RawMessage),
		wordShareIndex:  make(map[string]map[string]bool),
		wordShareSlugs:  make(map[string]bool),
		wordShareExpiry: make(map[string]time.Time),
	}
	if err := rdb.ReadFile(source, extractor); err != nil {
		panic(fmt.Errorf("RDB decode failed: %w", err))
	}
	if !extractor.found {
		if len(os.Args) == 3 {
			panic("guest:list is absent")
		}
		fmt.Println("guest_list_absent")
	} else {
		var guests []struct {
			ID       string            `json:"id"`
			Name     string            `json:"name"`
			PlusOnes []json.RawMessage `json:"plusOnes"`
		}
		if err := json.Unmarshal([]byte(extractor.value), &guests); err != nil || guests == nil {
			panic("guest:list is not a JSON guest array")
		}
		plusOnes := 0
		for _, guest := range guests {
			if guest.ID == "" || guest.Name == "" || guest.PlusOnes == nil {
				panic("guest:list contains an invalid top-level guest")
			}
			plusOnes += len(guest.PlusOnes)
		}
		file, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			panic(err)
		}
		if _, err = file.Write([]byte(extractor.value)); err != nil {
			file.Close()
			panic(err)
		}
		if err = file.Close(); err != nil {
			panic(err)
		}
		hash := sha256.Sum256([]byte(extractor.value))
		fmt.Printf("guest_json_sha256=%x top_level=%d plus_ones=%d\n", hash, len(guests), plusOnes)
	}
	if len(os.Args) >= 4 {
		for _, raw := range extractor.audit {
			var event struct {
				ID     string `json:"id"`
				Action string `json:"action"`
				At     string `json:"at"`
			}
			if err := json.Unmarshal(raw, &event); err != nil || event.ID == "" ||
				(event.Action != "opened" && event.Action != "closed") || event.At == "" {
				panic("auth:upload-open:audit has an invalid event")
			}
		}
		payload, err := json.Marshal(extractor.audit)
		if err != nil {
			panic(err)
		}
		auditFile, err := os.OpenFile(os.Args[3], os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			panic(err)
		}
		if _, err := auditFile.Write(payload); err != nil {
			auditFile.Close()
			panic(err)
		}
		if err := auditFile.Close(); err != nil {
			panic(err)
		}
		fmt.Printf("upload_audit_events=%d\n", len(extractor.audit))
	}
	if len(os.Args) >= 5 {
		payload, err := json.Marshal(extractor.versions)
		if err != nil {
			panic(err)
		}
		versionFile, err := os.OpenFile(os.Args[4], os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			panic(err)
		}
		if _, err := versionFile.Write(payload); err != nil {
			versionFile.Close()
			panic(err)
		}
		if err := versionFile.Close(); err != nil {
			panic(err)
		}
		fmt.Printf("auth_token_roles=%d\n", len(extractor.versions))
	}
	if len(os.Args) >= 6 {
		type attendeeRow struct {
			ID        string          `json:"id"`
			Value     json.RawMessage `json:"value"`
			ExpiresAt string          `json:"expiresAt"`
		}
		keys := make([]string, 0, len(extractor.sessions))
		for key := range extractor.sessions {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		rows := make([]attendeeRow, 0, len(keys))
		for _, key := range keys {
			id := strings.TrimPrefix(key, "event-scoring:attendee-session:")
			var identity struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(extractor.sessions[key], &identity); err != nil || identity.ID != id {
				panic("attendee session ID does not match its key")
			}
			expires, ok := extractor.sessionExpiry[key]
			if !ok {
				panic("attendee session lacks absolute expiry")
			}
			rows = append(rows, attendeeRow{ID: id, Value: extractor.sessions[key], ExpiresAt: expires.UTC().Format(time.RFC3339Nano)})
		}
		payload, err := json.Marshal(struct {
			Sessions       []attendeeRow     `json:"sessions"`
			PersonVersions map[string]string `json:"personVersions"`
		}{rows, extractor.personVersions})
		if err != nil {
			panic(err)
		}
		sessionFile, err := os.OpenFile(os.Args[5], os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			panic(err)
		}
		if _, err := sessionFile.Write(payload); err != nil {
			sessionFile.Close()
			panic(err)
		}
		if err := sessionFile.Close(); err != nil {
			panic(err)
		}
		fmt.Printf("attendee_sessions=%d person_versions=%d\n", len(rows), len(extractor.personVersions))
	}
	if len(os.Args) >= 7 {
		type reportRow struct {
			Key       string          `json:"key"`
			Value     json.RawMessage `json:"value"`
			ExpiresAt string          `json:"expiresAt"`
		}
		type stateRow struct {
			Key       string `json:"key"`
			Value     string `json:"value"`
			ExpiresAt string `json:"expiresAt"`
		}
		reportKeys := make([]string, 0, len(extractor.reports))
		for key := range extractor.reports {
			reportKeys = append(reportKeys, key)
		}
		sort.Strings(reportKeys)
		reports := make([]reportRow, 0, len(reportKeys))
		for _, key := range reportKeys {
			expires, ok := extractor.reportExpiry[key]
			if !ok {
				panic("report lacks absolute expiry")
			}
			reports = append(reports, reportRow{key, extractor.reports[key], expires.UTC().Format(time.RFC3339Nano)})
		}
		stateKeys := make([]string, 0, len(extractor.reportState))
		for key := range extractor.reportState {
			stateKeys = append(stateKeys, key)
		}
		sort.Strings(stateKeys)
		state := make([]stateRow, 0, len(stateKeys))
		for _, key := range stateKeys {
			expires, ok := extractor.reportExpiry[key]
			if !ok {
				panic("report receipt/rate lacks absolute expiry")
			}
			state = append(state, stateRow{key, extractor.reportState[key], expires.UTC().Format(time.RFC3339Nano)})
		}
		payload, err := json.Marshal(struct {
			Reports []reportRow `json:"reports"`
			State   []stateRow  `json:"state"`
		}{reports, state})
		if err != nil {
			panic(err)
		}
		file, err := os.OpenFile(os.Args[6], os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			panic(err)
		}
		if _, err := file.Write(payload); err != nil {
			file.Close()
			panic(err)
		}
		if err := file.Close(); err != nil {
			panic(err)
		}
		fmt.Printf("diagnostic_report_records=%d diagnostic_report_state=%d\n", len(reports), len(state))
	}
	if len(os.Args) >= 8 {
		type expiringString struct {
			Key       string `json:"key"`
			Value     string `json:"value"`
			ExpiresAt string `json:"expiresAt"`
		}
		type expiringHash struct {
			Key       string            `json:"key"`
			Values    map[string]string `json:"values"`
			ExpiresAt string            `json:"expiresAt"`
		}
		votes := extractor.votingHashes["best-dressed:votes:v2"]
		if raw, ok := extractor.votingStrings["best-dressed:votes:v2"]; ok {
			if votes != nil {
				panic("Best Dressed votes appear as two Redis types")
			}
			var parsed map[string]json.RawMessage
			if err := json.Unmarshal([]byte(raw), &parsed); err != nil || parsed == nil {
				panic("Best Dressed votes string is not a JSON object")
			}
			votes = make(map[string]string, len(parsed))
			for name, count := range parsed {
				var number json.Number
				if err := json.Unmarshal(count, &number); err != nil {
					panic("Best Dressed votes JSON has a nonnumeric count")
				}
				votes[name] = string(number)
			}
		}
		if votes == nil {
			votes = make(map[string]string)
		}
		stringsOut := []expiringString{}
		for key, value := range extractor.votingStrings {
			if key == "best-dressed:session" || key == "best-dressed:open-until" ||
				key == "best-dressed:votes:v2" || key == "best-dressed:votes" {
				continue
			}
			if !strings.HasPrefix(key, "best-dressed:token:") && !strings.HasPrefix(key, "best-dressed:code:") {
				panic(fmt.Sprintf("unexpected Best Dressed string key hash=%x", sha256.Sum256([]byte(key))))
			}
			expires, ok := extractor.votingExpiry[key]
			if !ok {
				panic("Best Dressed credential lacks absolute expiry")
			}
			stringsOut = append(stringsOut, expiringString{key, value, expires.UTC().Format(time.RFC3339Nano)})
		}
		sort.Slice(stringsOut, func(i, j int) bool { return stringsOut[i].Key < stringsOut[j].Key })
		hashesOut := []expiringHash{}
		for key, values := range extractor.votingHashes {
			if key == "best-dressed:votes:v2" {
				continue
			}
			if !strings.HasPrefix(key, "best-dressed:voted:") {
				panic("unexpected Best Dressed hash key")
			}
			expires, ok := extractor.votingExpiry[key]
			if !ok {
				panic("Best Dressed voter receipt lacks absolute expiry")
			}
			hashesOut = append(hashesOut, expiringHash{key, values, expires.UTC().Format(time.RFC3339Nano)})
		}
		sort.Slice(hashesOut, func(i, j int) bool { return hashesOut[i].Key < hashesOut[j].Key })
		payload, err := json.Marshal(struct {
			Session     string            `json:"session"`
			OpenUntil   string            `json:"openUntil"`
			Votes       map[string]string `json:"votes"`
			LegacyVotes string            `json:"legacyVotes"`
			Strings     []expiringString  `json:"strings"`
			Voted       []expiringHash    `json:"voted"`
		}{
			extractor.votingStrings["best-dressed:session"],
			extractor.votingStrings["best-dressed:open-until"],
			votes,
			extractor.votingStrings["best-dressed:votes"],
			stringsOut,
			hashesOut,
		})
		if err != nil {
			panic(err)
		}
		file, err := os.OpenFile(os.Args[7], os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			panic(err)
		}
		if _, err := file.Write(payload); err != nil {
			file.Close()
			panic(err)
		}
		if err := file.Close(); err != nil {
			panic(err)
		}
		fmt.Printf("best_dressed_active_vote_candidates=%d legacy_votes_present=%t credentials=%d voted_hashes=%d\n",
			len(votes), extractor.votingStrings["best-dressed:votes"] != "", len(stringsOut), len(hashesOut))
	}
	if len(os.Args) >= 9 {
		type wordRow struct {
			Slug  string          `json:"slug"`
			Value json.RawMessage `json:"value"`
		}
		if len(extractor.wordMetas) != len(extractor.wordIndex) {
			panic("word metadata and index counts differ")
		}
		slugs := make([]string, 0, len(extractor.wordMetas))
		for slug := range extractor.wordMetas {
			if !extractor.wordIndex[slug] {
				panic("word metadata is missing from index")
			}
			slugs = append(slugs, slug)
		}
		sort.Strings(slugs)
		rows := make([]wordRow, 0, len(slugs))
		for _, slug := range slugs {
			rows = append(rows, wordRow{slug, extractor.wordMetas[slug]})
		}
		payload, err := json.Marshal(rows)
		if err != nil {
			panic(err)
		}
		file, err := os.OpenFile(os.Args[8], os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			panic(err)
		}
		if _, err := file.Write(payload); err != nil {
			file.Close()
			panic(err)
		}
		if err := file.Close(); err != nil {
			panic(err)
		}
		fmt.Printf("word_metadata=%d index_members=%d\n", len(rows), len(extractor.wordIndex))
	}
	if len(os.Args) == 10 {
		type shareRow struct {
			ID              string          `json:"id"`
			Value           json.RawMessage `json:"value"`
			RecordExpiresAt string          `json:"recordExpiresAt"`
		}
		ids := make([]string, 0, len(extractor.wordShares))
		for id, raw := range extractor.wordShares {
			var identity struct {
				ID   string `json:"id"`
				Slug string `json:"slug"`
			}
			if err := json.Unmarshal(raw, &identity); err != nil || identity.ID != id || identity.Slug == "" {
				panic("word share identity mismatch")
			}
			if !extractor.wordShareIndex[identity.Slug][id] || !extractor.wordShareSlugs[identity.Slug] {
				panic("word share missing from index")
			}
			if _, ok := extractor.wordShareExpiry[id]; !ok {
				panic("word share lacks absolute record expiry")
			}
			ids = append(ids, id)
		}
		for _, index := range extractor.wordShareIndex {
			for id := range index {
				if _, ok := extractor.wordShares[id]; !ok {
					panic("word share index has a stale member")
				}
			}
		}
		for slug := range extractor.wordShareSlugs {
			if len(extractor.wordShareIndex[slug]) == 0 {
				panic("word share slug index has a stale member")
			}
		}
		for slug := range extractor.wordShareIndex {
			if !extractor.wordShareSlugs[slug] {
				panic("word share index is missing its tracked slug")
			}
		}
		sort.Strings(ids)
		rows := make([]shareRow, 0, len(ids))
		for _, id := range ids {
			rows = append(rows, shareRow{id, extractor.wordShares[id], extractor.wordShareExpiry[id].UTC().Format(time.RFC3339Nano)})
		}
		payload, err := json.Marshal(rows)
		if err != nil {
			panic(err)
		}
		file, err := os.OpenFile(os.Args[9], os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			panic(err)
		}
		if _, err := file.Write(payload); err != nil {
			file.Close()
			panic(err)
		}
		if err := file.Close(); err != nil {
			panic(err)
		}
		fmt.Printf("word_shares=%d indexed_slugs=%d\n", len(rows), len(extractor.wordShareSlugs))
	}
}
