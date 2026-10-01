package provider

import (
	"context"
	"math"
	"time"

	"github.com/yetone/magpie/internal/mirasim"
)

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
		default:
			// An unknown scoped window is visible, but cannot constrain every model.
			v.Aside = w.ModelScoped
		}
		if w.ResetAt != "" {
			t, err := time.Parse(time.RFC3339Nano, w.ResetAt)
			if err != nil {
				q.Error = "Mirasim returned an invalid quota reset time"
				q.Windows = []QuotaWindow{}
				return q
			}
			v.ResetsAt = &t
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
