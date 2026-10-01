package gateway

import (
	"context"
	"net/http"
	"os"

	"github.com/yetone/magpie/internal/mirasim"
	"github.com/yetone/magpie/internal/netproxy"
	"github.com/yetone/magpie/internal/provider"
)

func (s *Server) serveMirasim(w http.ResponseWriter, r *http.Request, from provider.Protocol, p provider.Provider, model string, body []byte, usage *Usage) (int, string) {
	start := func(ctx context.Context, req *Request) (*subscriptionRun, <-chan Event, error) {
		owner := p.ID + "\x00" + p.Account.User
		if run, events := s.subscription.resume(req, owner); run != nil {
			return run, events, nil
		}
		s.subscription.retire(owner, req.Messages)
		c, err := mirasim.Resolve()
		if err != nil {
			return nil, nil, err
		}
		env := netproxy.EnvWith(netproxy.Choice(ctx), cleanClaudeEnv(os.Environ()))
		env = append(env, "MIRASIM_QUIET=1")
		return s.subscription.startCommand(req, model, owner, c.Binary, c.With("claude"), env)
	}
	return s.serveSubscription(w, r, from, "Mirasim Claude", model, body, usage, start)
}
