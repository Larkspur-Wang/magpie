package provider

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/yetone/magpie/internal/settings"
)

func TestMirasimCatalogUsesNativeIdsAndAvailableEfforts(t *testing.T) {
	h := t.TempDir()
	t.Setenv("HOME", h)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(h, "config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(h, "cache"))
	path := filepath.Join(h, "mirasim")
	script := `#!/bin/sh
echo 'host starting'
echo '{"agent":"claude","models":[{"id":"claude-opus-5-5[1m]","label":"Opus","contextWindow":1000000},{"id":"glm-5.3-flash"}],"effortByModel":{"claude-opus-5-5[1m]":[{"id":"low"},{"id":"medium","unavailable":true},{"id":"ultra"}]}}'
`
	if err := os.WriteFile(path, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MAGPIE_MIRASIM_BIN", path)
	if _, ok := mirasimAccount(); ok {
		t.Fatal("enabled without opting in")
	}
	ms, err := RefreshMirasim(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(ms) != 2 || ms[0].ID != "claude-opus-5-5" || ms[0].Context != 1000000 || !reflect.DeepEqual(ms[0].Efforts, []string{"low"}) {
		t.Fatalf("%+v", ms)
	}
	s := settings.Load()
	s.Mirasim = true
	if err := settings.Save(s); err != nil {
		t.Fatal(err)
	}
	p, ok := mirasimAccount()
	if !ok || p.Account.Agent != "mirasim" || len(p.Available()) != 2 {
		t.Fatalf("%+v %t", p, ok)
	}
}
