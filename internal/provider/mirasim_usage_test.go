package provider

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/yetone/magpie/internal/mirasim"
	"github.com/yetone/magpie/internal/settings"
)

func nativeQuotaFixture(t *testing.T, now time.Time) mirasim.RelayStatus {
	t.Helper()
	raw := `{"mode":"cloud","configured":true,"login":{"plan":"max","planExp":1792674899},"usage":{"ok":true,"source":"relay-limits","windows":[{"label":"5h","usedPercent":2.5,"resetAfterSeconds":3600},{"label":"7d","usedPercent":16.1,"resetAfterSeconds":604800},{"label":"7d_claude","usedPercent":99,"resetAfterSeconds":604800,"modelScoped":true},{"label":"7d_fable","usedPercent":100,"resetAfterSeconds":604800,"modelScoped":true}]}}`
	s, err := mirasim.ParseRelayStatus([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	s.Usage.CapturedAt = now.Format(time.RFC3339Nano)
	return s
}

func TestMirasimQuotaWindowScopesAndInvalidReadings(t *testing.T) {
	now := time.Now()
	s := nativeQuotaFixture(t, now)
	q := mirasimQuota(s, now)
	if q.Error != "" || q.Provider != "mirasim" || q.Plan != "Mirasim max" || len(q.Windows) != 4 || q.Until == nil {
		t.Fatalf("%+v", q)
	}
	a := allowanceOf(q.Windows, now)
	for model, want := range map[string]float64{"glm-5.3-flash": 16.1, "claude-opus-5-5": 99, "claude-fable-5": 100} {
		if used, _ := a.For(model, now); used != want {
			t.Fatalf("%s used %v, want %v", model, used, want)
		}
	}
	if !a.Full("glm-5.3-flash", 98, now).IsZero() || a.Full("claude-fable-5", 98, now).IsZero() {
		t.Fatal("a scoped exhausted window blocked unrelated models")
	}
	s.Usage.CapturedAt = now.Add(-3 * time.Minute).Format(time.RFC3339Nano)
	if q := mirasimQuota(s, now); q.AsOf == nil {
		t.Fatal("stale snapshot appeared fresh")
	}
	for _, change := range []func(*mirasim.RelayStatus){
		func(s *mirasim.RelayStatus) { s.Configured = false },
		func(s *mirasim.RelayStatus) { s.Mode = "local" },
		func(s *mirasim.RelayStatus) { s.Usage = nil },
		func(s *mirasim.RelayStatus) { s.Usage.Source = "app-server-live" },
		func(s *mirasim.RelayStatus) { s.Usage.Windows[0].UsedPercent = nil },
		func(s *mirasim.RelayStatus) { v := 101.0; s.Usage.Windows[0].UsedPercent = &v },
		func(s *mirasim.RelayStatus) { s.Usage.Windows[0].ResetAt = "bad date" },
	} {
		s := nativeQuotaFixture(t, now)
		change(&s)
		if q := mirasimQuota(s, now); q.Error == "" || len(q.Windows) > 0 {
			t.Fatalf("invalid native state appeared usable: %+v", q)
		}
	}
}

func TestMirasimNativeQuotaFeedsUsageAndRouting(t *testing.T) {
	isolate(t)
	h := t.TempDir()
	t.Setenv("HOME", h)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(h, "config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(h, "cache"))
	path := filepath.Join(h, "mirasim")
	b, _ := json.Marshal(nativeQuotaFixture(t, time.Now()))
	if err := os.WriteFile(path, append([]byte("#!/bin/sh\necho '"), append(b, []byte("'\n")...)...), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MAGPIE_MIRASIM_BIN", path)
	s := settings.Load()
	s.Mirasim = true
	if err := settings.Save(s); err != nil {
		t.Fatal(err)
	}
	q := LoginUsage(context.Background(), "mirasim")["local CLI"]
	if q.Provider != "mirasim" || q.Error != "" || len(q.Windows) != 4 {
		t.Fatalf("%+v", q)
	}
	a := Allowances("mirasim")["local CLI"]
	if used, _ := a.For("glm-5.3-flash", time.Now()); used != 16.1 {
		t.Fatalf("routing did not read native quota: %v", used)
	}
	if got := visibleQuotas([]SubscriptionQuota{q}); len(got) != 1 {
		t.Fatal("hidden while enabled")
	}
	s.Mirasim = false
	if err := settings.Save(s); err != nil {
		t.Fatal(err)
	}
	if got := visibleQuotas([]SubscriptionQuota{q}); len(got) != 0 {
		t.Fatal("stale Mirasim card visible after disabling")
	}
}
