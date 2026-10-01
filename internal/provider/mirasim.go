package provider

import (
	"context"
	"slices"
	"strings"
	"time"

	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/mirasim"
	"github.com/yetone/magpie/internal/settings"
)

func mirasimAccount() (Provider, bool) {
	if !settings.Load().Mirasim {
		return Provider{}, false
	}
	if _, err := mirasim.Resolve(); err != nil {
		return Provider{}, false
	}
	return Provider{ID: "mirasim", Name: "Mirasim", Icon: "claudecode-color", Website: "https://mirasim.ai",
		Anthropic: "mirasim-cli://local", Account: &Account{Agent: "mirasim", User: "local CLI", Home: "mirasim-cli://local",
			models: func() []catalog.Model { ms, _, _ := catalog.Live("mirasim"); return ms }, fetch: RefreshMirasim}}, true
}

// RefreshMirasim asks the native CLI, not the relay's unsigned HTTP endpoint.
func RefreshMirasim(ctx context.Context) ([]catalog.Model, error) {
	c, err := mirasim.FetchCatalog(ctx)
	if err != nil {
		return nil, err
	}
	var ms []catalog.Model
	seen := map[string]bool{}
	for _, m := range c.Models {
		id := strings.TrimSuffix(m.ID, "[1m]")
		if seen[id] {
			continue
		}
		seen[id] = true
		var efforts []string
		for _, e := range c.EffortByModel[m.ID] {
			if !e.Unavailable && slices.Contains([]string{"low", "medium", "high", "xhigh", "max"}, e.ID) {
				efforts = append(efforts, e.ID)
			}
		}
		ms = append(ms, catalog.Model{ID: id, Name: m.Label, Context: m.ContextWindow, Efforts: efforts})
	}
	return ms, catalog.SaveLive("mirasim", "mirasim-cli://local", ms)
}

func mirasimTest(ctx context.Context, model string) Result {
	start := time.Now()
	err := mirasim.Probe(ctx, model)
	r := Result{Protocol: Anthropic, Model: model, OK: err == nil, Millis: time.Since(start).Milliseconds()}
	if err != nil {
		r.Error = err.Error()
	} else {
		r.Status = 200
	}
	return r
}
