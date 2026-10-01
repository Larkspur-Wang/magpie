package mirasim

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRelayStatusKeepsOnlyQuotaMetadata(t *testing.T) {
	s, err := ParseRelayStatus([]byte("host ready\n" + `{
"mode":"cloud","configured":true,"tokenTail":"credential-secret",
"login":{"plan":"max","planExp":1792674899,"email":"private@example.com"},
"usage":{"ok":true,"source":"relay-limits","windows":[{"label":"5h","usedPercent":2.5}]}
}`))
	if err != nil || s.Usage == nil || len(s.Usage.Windows) != 1 || s.Login.Plan != "max" {
		t.Fatalf("%+v %v", s, err)
	}
	b, _ := json.Marshal(s)
	if strings.Contains(string(b), "credential-secret") || strings.Contains(string(b), "private@example.com") {
		t.Fatal("retained credentials or account identifiers")
	}
	if _, err := ParseRelayStatus([]byte(`{"agent":"claude","models":[]}`)); err == nil {
		t.Fatal("accepted an unrelated host frame")
	}
}

func TestQuotaAttachesNativeHostAndHidesDiagnostics(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mirasim")
	t.Setenv("MAGPIE_MIRASIM_BIN", path)
	t.Setenv("MAGPIE_MIRASIM_PORT", "4971")
	script := "#!/bin/sh\n[ \"$1\" = ui-cli ] && [ \"$2\" = --port ] && [ \"$3\" = 4971 ] || exit 9\necho '{\"mode\":\"cloud\",\"configured\":true}'\n"
	if err := os.WriteFile(path, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := FetchRelayStatus(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MAGPIE_MIRASIM_PORT", "4970;unsafe")
	if _, err := FetchRelayStatus(context.Background()); err == nil {
		t.Fatal("accepted shell syntax as a port")
	}
	t.Setenv("MAGPIE_MIRASIM_PORT", "4971")
	if err := os.WriteFile(path, []byte("#!/bin/sh\necho credential-secret >&2\nexit 1\n"), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := FetchRelayStatus(context.Background()); err == nil || strings.Contains(err.Error(), "credential-secret") {
		t.Fatalf("%v", err)
	}
}
