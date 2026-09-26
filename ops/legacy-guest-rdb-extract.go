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
	value          string
	found          bool
	audit          []json.RawMessage
	versions       map[string]int
	sessions       map[string]json.RawMessage
	sessionExpiry  map[string]time.Time
	personVersions map[string]string
	reports        map[string]json.RawMessage
	reportState    map[string]string
	reportExpiry   map[string]time.Time
}

func (*guestExtractor) AllowPartialRead() bool { return false }
func (g *guestExtractor) HandleString(key, value string) error {
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
	if strings.HasPrefix(key, "event-scoring:attendee-session:") {
		g.sessionExpiry[key] = expires
	}
	if strings.HasPrefix(key, "diagnostic-report:") || strings.HasPrefix(key, "user-report:") {
		g.reportExpiry[key] = expires
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
func (*guestExtractor) SetEntryHandler(string) func(string) error {
	return func(string) error { return nil }
}
func (*guestExtractor) ZsetEntryHandler(string) func(string, float64) error {
	return func(string, float64) error { return nil }
}
func (*guestExtractor) HashEntryHandler(string) func(string, string) error {
	return func(string, string) error { return nil }
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
	if len(os.Args) < 3 || len(os.Args) > 7 {
		panic("usage: go run legacy-guest-rdb-extract.go <absolute-rdb-path> <absolute-new-guest-json-path> [absolute-new-upload-audit-json-path] [absolute-new-auth-versions-json-path] [absolute-new-attendee-sessions-json-path] [absolute-new-reports-json-path]")
	}
	source, destination := os.Args[1], os.Args[2]
	if err := rdb.VerifyFile(source, rdb.VerifyFileOptions{
		MaxDataSize: 64 << 20, MaxEntrySize: 16 << 20, MaxValueSize: 16 << 20,
		MaxStreamPELSize: 10000,
	}); err != nil {
		panic(fmt.Errorf("RDB integrity verification failed: %w", err))
	}
	extractor := &guestExtractor{
		versions:       make(map[string]int),
		sessions:       make(map[string]json.RawMessage),
		sessionExpiry:  make(map[string]time.Time),
		personVersions: make(map[string]string),
		reports:        make(map[string]json.RawMessage),
		reportState:    make(map[string]string),
		reportExpiry:   make(map[string]time.Time),
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
	if len(os.Args) == 7 {
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
}
