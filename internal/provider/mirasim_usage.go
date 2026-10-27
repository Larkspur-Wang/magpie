package provider

import (
	"context"
	"math"
	"time"

	"github.com/yetone/magpie/internal/mirasim"
)

// relayNoResetHorizon is how far past now a window's reset can be and still
// name a real renewal: the platform says "this does not renew" with a date a
// century out (2126-09-29), and no subscription window runs past a year. A
// reset beyond it is the sentinel, read as no reset at all.
const relayNoResetHorizon = 10 * 365 * 24 * time.Hour

func mirasimSubscriptionUsage(ctx context.Context) SubscriptionQuota {
	s, err := mirasim.FetchRelayStatus(ctx)
	if err != nil {
		return SubscriptionQuota{Provider: "mirasim", Name: "Mirasim", Icon: "claudecode-color", User: "local CLI", Windows: []QuotaWindow{}, Error: err.Error()}
	}
	return mirasimQuota(s, time.Now())
}

func mirasimQuota(s mirasim.RelayStatus, now time.Time) SubscriptionQuota {
	q := SubscriptionQuota{Provider: "mirasim", Name: "Mirasim", Icon: "claudecode-color", User: "local CLI", Plan: s.Login.Plan, Windows: []QuotaWindow{}}
	if s.Login.PlanExp > 0 {
		t := time.Unix(s.Login.PlanExp, 0)
		q.Until = &t
	}
	switch {
	case !s.Configured:
		q.Error = "Mirasim is not signed in to its platform"
		return q
	case s.Mode != "cloud":
		q.Error = "Mirasim is not in platform routing mode; its platform allowance does not describe the native CLI route"
		return q
	case s.Usage == nil || !s.Usage.OK || s.Usage.Source != "relay-limits" || len(s.Usage.Windows) == 0:
		q.Error = "Mirasim quota fetch failed: no native platform allowance is available"
		return q
	}
	for _, w := range s.Usage.Windows {
		if w.UsedPercent == nil || math.IsNaN(*w.UsedPercent) || math.IsInf(*w.UsedPercent, 0) || *w.UsedPercent < 0 || *w.UsedPercent > 100 {
			q.Error = "Mirasim returned an invalid quota percentage"
			q.Windows = []QuotaWindow{}
			return q
		}
		v := QuotaWindow{Name: w.Label, Used: *w.UsedPercent, ResetSecs: w.ResetAfterSeconds}
		switch w.Label {
		case "5h":
			v.Name, v.Span = "5 hours", 5*time.Hour
		case "7d":
			v.Name, v.Span = "7 days", 7*24*time.Hour
		case "7d_claude":
			v.Name, v.Span, v.Model = "Claude 7 days", 7*24*time.Hour, "claude-"
		case "7d_fable":
			v.Name, v.Span, v.Model = "Fable 7 days", 7*24*time.Hour, "fable"
		case "30d":
			// the platform's rolling allowance on a plan that reports one
			// window for every model (Mirasim max)
			v.Name, v.Span = "30 days", 30*24*time.Hour
		default:
			// An unknown scoped window is visible, but cannot constrain every model.
			v.Aside = w.ModelScoped
		}
		// The platform counts the window in credits and its percentage is
		// that count rounded to a tenth: 81.19 credits of 47,235 is 0.2%,
		// which alone reads as nothing spent. Carry the count beside the
		// share so the card can say the figure the percentage loses.
		if w.Used != nil && w.Budget != nil && *w.Budget > 0 {
			v.Amount, v.Limit, v.Unit = *w.Used, *w.Budget, "credits"
		}
		// A window that does not renew says so with a reset a century out
		// (2126-09-29, resetAfterSeconds 3153599267); counting down to it
		// read "↻36499d23h". Nothing renews then, so leave the reset
		// unknown instead of naming a date that means never. The seconds
		// fall the same way, for a reply that gives them and no date.
		if int64(v.ResetSecs) > int64(relayNoResetHorizon/time.Second) {
			v.ResetSecs = 0
		}
		if w.ResetAt != "" {
			t, err := time.Parse(time.RFC3339Nano, w.ResetAt)
			if err != nil {
				q.Error = "Mirasim returned an invalid quota reset time"
				q.Windows = []QuotaWindow{}
				return q
			}
			if t.After(now.Add(relayNoResetHorizon)) {
				v.ResetSecs = 0
			} else {
				v.ResetsAt = &t
			}
		}
		q.Windows = append(q.Windows, v)
	}
	if at, err := time.Parse(time.RFC3339Nano, s.Usage.CapturedAt); err == nil && now.Sub(at) > 2*time.Minute {
		q.AsOf = &at
	}
	if q.Plan != "" {
		q.Plan = "Mirasim " + q.Plan
	}
	return q
}
