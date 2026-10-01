package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestWorkBuddyAIEmptyCreditPackages(t *testing.T) {
	for _, tc := range []struct {
		name     string
		packages any
		balance  string
	}{
		{"explicit-empty", []any{}, "0 credits"},
		{"missing", nil, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			wbTokens.Lock()
			previousTokens := wbTokens.m
			wbTokens.m = map[string]wbCreds{}
			wbTokens.Unlock()
			t.Cleanup(func() {
				wbTokens.Lock()
				wbTokens.m = previousTokens
				wbTokens.Unlock()
			})
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				data := map[string]any{"IsPaidUser": false}
				if tc.packages != nil {
					data["Packages"] = tc.packages
				}
				json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": data})
			}))
			defer srv.Close()
			old := wbAIEndpoint
			wbAIEndpoint = srv.URL
			defer func() { wbAIEndpoint = old }()
			q := wbQuota(context.Background(), wbAccount{site: wbAI,
				Login: Login{User: "Test", Plan: "Free"},
				creds: wbCreds{UID: "test", Access: "fake", ExpiresAt: time.Now().Add(time.Hour).UnixMilli()},
			})
			if q.Error != "" || q.Balance != tc.balance || len(q.Windows) != 0 {
				t.Fatalf("quota = %+v, balance %q expected; no fabricated usage percentage", q, tc.balance)
			}
		})
	}
}
