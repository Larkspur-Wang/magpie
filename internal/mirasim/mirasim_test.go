package mirasim

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveDesktopUpdatedRuntime(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("MIRASIM_HOME", "")
	t.Setenv("MAGPIE_MIRASIM_BIN", "")
	dir := filepath.Join(home, ".mirasim", "app", "0.0.387")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "server.cjs"), []byte(""), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(dir), "state.json"), []byte(`{"good":"0.0.387"}`), 0600); err != nil {
		t.Fatal(err)
	}
	bin := t.TempDir()
	if err := os.WriteFile(filepath.Join(bin, "node"), []byte("#!/bin/sh\nexit 0\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin)
	c, err := Resolve()
	if err != nil {
		t.Fatal(err)
	}
	if c.Binary != filepath.Join(bin, "node") || len(c.Args) != 1 || c.Args[0] != filepath.Join(dir, "server.cjs") {
		t.Fatalf("resolved %+v", c)
	}
}

func TestOverrideIsExecutableAndNotShellSyntax(t *testing.T) {
	t.Setenv("MAGPIE_MIRASIM_BIN", "mirasim; echo unsafe")
	if _, err := Resolve(); err == nil {
		t.Fatal("accepted a shell expression")
	}
	path := filepath.Join(t.TempDir(), "CLI with spaces")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nexit 0\n"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MAGPIE_MIRASIM_BIN", path)
	if _, err := Resolve(); err == nil {
		t.Fatal("accepted a non executable")
	}
	if err := os.Chmod(path, 0700); err != nil {
		t.Fatal(err)
	}
	c, err := Resolve()
	if err != nil || c.Binary != path {
		t.Fatalf("%+v %v", c, err)
	}
}

func TestCatalogLogLinesAndCapabilities(t *testing.T) {
	if c, err := ParseCatalog([]byte("host starting\n{\n\"agent\":\"claude\",\n\"models\":[{\"id\":\"m\"}]\n}\n")); err != nil || len(c.Models) != 1 {
		t.Fatalf("multiline catalog: %+v %v", c, err)
	}
	c, err := ParseCatalog([]byte("Starting host...\n" + `{"agent":"claude","models":[{"id":"claude-opus-5-5[1m]","contextWindow":1000000}],"effortByModel":{"claude-opus-5-5[1m]":[{"id":"low"},{"id":"medium","unavailable":true}]}}` + "\nStopping host...\n"))
	if err != nil || len(c.Models) != 1 || c.Models[0].ContextWindow != 1000000 || !c.EffortByModel[c.Models[0].ID][1].Unavailable {
		t.Fatalf("%+v %v", c, err)
	}
	for _, bad := range []string{`{}`, `{"agent":"codex","models":[{"id":"gpt"}]}`, `{"agent":"claude","models":[{"id":""}]}`, `not json`} {
		if _, err := ParseCatalog([]byte(bad)); err == nil {
			t.Fatalf("accepted %s", bad)
		}
	}
}

func TestShellQuotesWithoutEvaluating(t *testing.T) {
	c := Command{Binary: "/tmp/node with spaces", Args: []string{"/tmp/it's.cjs"}}
	got := c.Shell("claude", "--resume", "id")
	if got != `'/tmp/node with spaces' '/tmp/it'"'"'s.cjs' 'claude' '--resume' 'id'` {
		t.Fatalf("%s", got)
	}
	if args := c.With("claude"); len(args) != 2 || len(c.Args) != 1 {
		t.Fatal("mutated command prefix")
	}
}

func TestNativeProbeRejectsEmptySuccessAndHidesDiagnostics(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mirasim")
	t.Setenv("MAGPIE_MIRASIM_BIN", path)
	for _, script := range []string{
		"#!/bin/sh\nprintf '%s\\n' '{\"type\":\"result\",\"is_error\":false,\"result\":\"\"}'\n",
		"#!/bin/sh\necho credential-secret >&2\nexit 1\n",
	} {
		if err := os.WriteFile(path, []byte(script), 0700); err != nil {
			t.Fatal(err)
		}
		err := Probe(context.Background(), "m")
		if err == nil || strings.Contains(err.Error(), "credential-secret") {
			t.Fatalf("%v", err)
		}
	}
}

// The relay checks a request's client version against its signature, so the
// version has to be the desktop's own: a plugin keeping one of its own is
// refused once the app updates.
func TestDesktopVersionIsTheInstalledBuild(t *testing.T) {
	h := t.TempDir()
	t.Setenv("MIRASIM_HOME", h)
	t.Setenv("MIRASIM_APP_VERSION", "")
	if got := DesktopVersion(); got != "" {
		t.Fatalf("no state read as %q", got)
	}
	app := filepath.Join(h, "app")
	if err := os.MkdirAll(filepath.Join(app, "0.0.597"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(app, "0.0.597", "payload.json"), []byte(`{"version":"0.0.597"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(app, "state.json"), []byte(`{"good":"0.0.597","pending":"0.0.598"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := DesktopVersion(); got != "0.0.597" {
		t.Fatalf("got %q, want the good build", got)
	}
	// a good build whose files are gone is no version at all
	if err := os.Remove(filepath.Join(app, "0.0.597", "payload.json")); err != nil {
		t.Fatal(err)
	}
	if got := DesktopVersion(); got != "" {
		t.Fatalf("a missing build read as %q", got)
	}
}

// The desktop passes the build it is running to its children, and an app
// updated in place leaves state.json naming the build before it. Signing
// with that stale one is what the relay refuses, so the desktop's own
// answer has to win over the staged directory.
func TestDesktopVersionPrefersTheRunningAppOverStagedState(t *testing.T) {
	h := t.TempDir()
	t.Setenv("MIRASIM_HOME", h)
	app := filepath.Join(h, "app")
	// state.json names the build installed there, one the app has moved past
	if err := os.MkdirAll(filepath.Join(app, "0.0.595"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(app, "0.0.595", "payload.json"), []byte(`{}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(app, "state.json"), []byte(`{"good":"0.0.595","pending":"0.0.604"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MIRASIM_APP_VERSION", "0.0.622")
	if got := DesktopVersion(); got != "0.0.622" {
		t.Fatalf("got %q, want the running build over the staged one", got)
	}
	// and with the desktop silent the staged build is all there is
	t.Setenv("MIRASIM_APP_VERSION", "")
	if got := DesktopVersion(); got != "0.0.595" {
		t.Fatalf("got %q, want the staged build", got)
	}
	// a value that is not a build name is no version, not a path
	t.Setenv("MIRASIM_APP_VERSION", "../../etc")
	if got := DesktopVersion(); got != "0.0.595" {
		t.Fatalf("a path read as %q", got)
	}
}
