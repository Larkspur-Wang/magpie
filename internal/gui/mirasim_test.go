package gui

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/settings"
)

func TestMirasimSettingsMissingRuntimeDoesNotEnable(t *testing.T) {
	h := t.TempDir()
	t.Setenv("HOME", h)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(h, "config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(h, "cache"))
	t.Setenv("MAGPIE_MIRASIM_BIN", filepath.Join(h, "missing"))
	w := httptest.NewRecorder()
	Handler(nil, nil).ServeHTTP(w, httptest.NewRequest("POST", "/api/settings", strings.NewReader(`{"mirasim":true,"claudeLauncher":"mirasim"}`)))
	if w.Code < 400 || settings.Load().Mirasim || settings.Load().ClaudeLauncher == "mirasim" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

func TestMirasimSettingsFetchCatalogBeforeEnabling(t *testing.T) {
	h := t.TempDir()
	t.Setenv("HOME", h)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(h, "config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(h, "cache"))
	path := filepath.Join(h, "mirasim")
	if err := os.WriteFile(path, []byte("#!/bin/sh\necho '{\"agent\":\"claude\",\"models\":[{\"id\":\"m\"}]}'\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MAGPIE_MIRASIM_BIN", path)
	w := httptest.NewRecorder()
	Handler(nil, nil).ServeHTTP(w, httptest.NewRequest("POST", "/api/settings", strings.NewReader(`{"mirasim":true,"claudeLauncher":"mirasim"}`)))
	if w.Code != 200 || !settings.Load().Mirasim || settings.Load().ClaudeLauncher != "mirasim" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}
