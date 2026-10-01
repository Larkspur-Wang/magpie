package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/agent"
	"github.com/yetone/magpie/internal/settings"
)

func TestMirasimLaunchUsesSelectedModelAndPreservesOverrides(t *testing.T) {
	h := t.TempDir()
	t.Setenv("HOME", h)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(h, "config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(h, "cache"))
	path, recorded := filepath.Join(h, "mirasim"), filepath.Join(h, "args")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$MAGPIE_TEST_ARGS\"\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MAGPIE_MIRASIM_BIN", path)
	t.Setenv("MAGPIE_TEST_ARGS", recorded)
	s := settings.Load()
	s.ClaudeLauncher = "mirasim"
	if err := settings.Save(s); err != nil {
		t.Fatal(err)
	}
	a, err := agent.Find("claude")
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Field("model").Set("opus[1m]"); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		args []string
		want string
	}{
		{[]string{"-p", "hello"}, "claude\n--model\nopus[1m]\n-p\nhello\n"},
		{[]string{"--model", "glm-5.3-flash", "-p", "hello"}, "claude\n--model\nglm-5.3-flash\n-p\nhello\n"},
		{[]string{"--model=glm-5.3-flash"}, "claude\n--model=glm-5.3-flash\n"},
		{[]string{"--resume", "session-id"}, "claude\n--resume\nsession-id\n"},
		{[]string{"--resume=session-id"}, "claude\n--resume=session-id\n"},
		{[]string{"--continue"}, "claude\n--continue\n"},
	} {
		if err := launchCmd(append([]string{"claude"}, tc.args...)); err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(recorded)
		if err != nil || string(data) != tc.want {
			t.Fatalf("args %v: %q, %v", tc.args, data, err)
		}
	}
	t.Setenv("MAGPIE_MIRASIM_BIN", filepath.Join(h, "missing"))
	if err := launchCmd([]string{"claude"}); err == nil || !strings.Contains(err.Error(), "executable") {
		t.Fatalf("silently fell back: %v", err)
	}
}
