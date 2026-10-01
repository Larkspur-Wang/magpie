package agent

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/settings"
)

func TestMirasimLauncherDoesNotWriteConflictingGatewaySettings(t *testing.T) {
	h := t.TempDir()
	t.Setenv("HOME", h)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(h, "config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(h, "cache"))
	s := settings.Load()
	s.ClaudeLauncher = "mirasim"
	if err := settings.Save(s); err != nil {
		t.Fatal(err)
	}
	a := claude(h)
	if !strings.Contains(a.Name, "Mirasim") {
		t.Fatalf("%s", a.Name)
	}
	if err := provider.Save(provider.Provider{ID: "p", Name: "P", Key: "test", Chat: "http://localhost/v1", Models: []string{"model"}}); err != nil {
		t.Fatal(err)
	}
	if err := a.Field("model").Set("p/model"); err == nil {
		t.Fatal("wrote conflicting upstream")
	}
	if _, err := os.Stat(a.Path); !os.IsNotExist(err) {
		t.Fatalf("changed Claude settings: %v", err)
	}
	if err := a.Field("model").Set("opus"); err != nil {
		t.Fatal(err)
	}
}
