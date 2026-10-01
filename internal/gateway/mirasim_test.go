package gateway

import (
	"context"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/settings"
)

func TestMirasimGatewayUsesNativeWrapperAndReportsUsage(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mirasim")
	script := `#!/bin/sh
if [ "$1" != claude ]; then exit 8; fi
if [ -n "$ANTHROPIC_BASE_URL" ] || [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then exit 9; fi
read -r line
echo '{"type":"stream_event","event":{"type":"message_start","message":{"id":"m","model":"glm-5.3-flash","usage":{"input_tokens":23,"cache_read_input_tokens":7}}}}'
echo '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"OK"}}}'
echo '{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}}'
echo '{"type":"stream_event","event":{"type":"message_stop"}}'
while read -r line; do :; done
`
	if err := os.WriteFile(path, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MAGPIE_MIRASIM_BIN", path)
	t.Setenv("ANTHROPIC_BASE_URL", "http://127.0.0.1:3425")
	t.Setenv("CLAUDE_CODE_OAUTH_TOKEN", "must-not-forward")
	s := New()
	p := provider.Provider{ID: "mirasim", Account: &provider.Account{Agent: "mirasim", User: "local CLI"}}
	body := `{"model":"mirasim/glm-5.3-flash","messages":[{"role":"user","content":"hi"}]}`
	r := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(body)).WithContext(context.Background())
	w := httptest.NewRecorder()
	var u Usage
	status, msg := s.serveMirasim(w, r, provider.Chat, p, "glm-5.3-flash", []byte(body), &u)
	if status != 200 || msg != "" || !strings.Contains(w.Body.String(), "OK") {
		t.Fatalf("%d %s %s", status, msg, w.Body)
	}
	if u.Input != 23 || u.Output != 2 || u.CacheRead != 7 {
		t.Fatalf("usage %+v", u)
	}
}

func TestMirasimMissingWrapperFailsInsteadOfPlainClaude(t *testing.T) {
	t.Setenv("MAGPIE_MIRASIM_BIN", filepath.Join(t.TempDir(), "missing"))
	s := New()
	p := provider.Provider{ID: "mirasim", Account: &provider.Account{Agent: "mirasim", User: "local CLI"}}
	body := `{"model":"m","messages":[{"role":"user","content":"hi"}]}`
	w := httptest.NewRecorder()
	status, _ := s.serveMirasim(w, httptest.NewRequest("POST", "/", nil), provider.Chat, p, "m", []byte(body), &Usage{})
	if status < 400 {
		t.Fatalf("silently succeeded: %d %s", status, w.Body)
	}
}

func TestMirasimQuotaFailureFallsBackInPool(t *testing.T) {
	h := t.TempDir()
	t.Setenv("HOME", h)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(h, "config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(h, "cache"))
	path := filepath.Join(h, "mirasim")
	script := `#!/bin/sh
if [ "$1" = ui-cli ]; then
  echo '{"agent":"claude","models":[{"id":"m"}]}'
  exit 0
fi
read -r line
echo '{"type":"result","is_error":true,"result":"429 rate limit reached"}'
while read -r line; do :; done
`
	if err := os.WriteFile(path, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MAGPIE_MIRASIM_BIN", path)
	if _, err := provider.RefreshMirasim(context.Background()); err != nil {
		t.Fatal(err)
	}
	settingsNow := settings.Load()
	settingsNow.Mirasim = true
	if err := settings.Save(settingsNow); err != nil {
		t.Fatal(err)
	}
	spare := &fake{t: t, ctype: "application/json", reply: `{"id":"from-spare","choices":[]}`}
	up := httptest.NewServer(spare)
	defer up.Close()
	if err := provider.Save(provider.Provider{ID: "spare", Name: "Spare", Key: "test", Chat: up.URL + "/v1", Models: []string{"m2"}}); err != nil {
		t.Fatal(err)
	}
	if err := provider.SaveGroup(provider.Group{ID: "mirasim-test", Name: "Mirasim Test", Members: []string{"mirasim/m", "spare/m2"}, Routing: "order"}); err != nil {
		t.Fatal(err)
	}
	restingUntil.Lock()
	restingUntil.m = map[string]time.Time{}
	restingUntil.Unlock()
	s := New()
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(`{"model":"group/mirasim-test","messages":[{"role":"user","content":"hi"}]}`)))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "from-spare") {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if c := s.Recent()[0]; c.Provider != "spare" || !strings.Contains(c.Fallback, "mirasim") {
		t.Fatalf("%+v", c)
	}
}
