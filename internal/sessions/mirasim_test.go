package sessions

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/settings"
)

func TestMirasimResumeUsesResolvedWrapper(t *testing.T) {
	h := t.TempDir()
	t.Setenv("HOME", h)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(h, "config"))
	path := filepath.Join(h, "Mirasim CLI")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nexit 0\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MAGPIE_MIRASIM_BIN", path)
	s := settings.Load()
	s.ClaudeLauncher = "mirasim"
	if err := settings.Save(s); err != nil {
		t.Fatal(err)
	}
	got := ResumeCommand("claude", "abc-123", "/tmp/project with spaces")
	if !strings.Contains(got, "'"+path+"' 'claude' '--resume' 'abc-123'") || !strings.Contains(got, "/tmp/project with spaces") {
		t.Fatalf("%s", got)
	}
	if ResumeCommand("claude", "x; touch /tmp/unsafe", "") != "" {
		t.Fatal("accepted an unsafe session id")
	}
	t.Setenv("MAGPIE_MIRASIM_BIN", filepath.Join(h, "missing"))
	if ResumeCommand("claude", "abc-123", "") != "" {
		t.Fatal("silently fell back to plain Claude")
	}
}
