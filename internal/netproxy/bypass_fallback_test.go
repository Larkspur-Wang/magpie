package netproxy

import (
	"net/url"
	"testing"

	"github.com/yetone/magpie/internal/settings"
)

func TestNoProxyStopsSystemFallback(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	for _, key := range []string{"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"} {
		t.Setenv(key, "")
	}
	sysCache.at, sysCache.p = farFuture, Proxy{URL: "http://127.0.0.1:9"}
	t.Cleanup(func() { sysCache.at, sysCache.p = zero, Proxy{} })
	t.Setenv("NO_PROXY", "trace.example.invalid")
	target, _ := url.Parse("http://trace.example.invalid/cdn-cgi/trace")
	if proxy, err := For(target); err != nil || proxy != nil {
		t.Fatalf("NO_PROXY target fell through to the system proxy: %v, %v", proxy, err)
	}
	s := settings.Load()
	s.Proxy = "http://127.0.0.1:8"
	if err := settings.Save(s); err != nil {
		t.Fatal(err)
	}
	if proxy, err := For(target); err != nil || proxy == nil || proxy.Host != "127.0.0.1:8" {
		t.Fatalf("explicit settings choice lost precedence: %v, %v", proxy, err)
	}
}

func TestNoProxySystemFallbackRespectsURLPortAndCIDR(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	for _, key := range []string{"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"} {
		t.Setenv(key, "")
	}
	sysCache.at, sysCache.p = farFuture, Proxy{URL: "http://127.0.0.1:9"}
	t.Cleanup(func() { sysCache.at, sysCache.p = zero, Proxy{} })
	for _, tc := range []struct {
		list, target string
		direct       bool
	}{
		{"trace.example.invalid:443", "https://trace.example.invalid/", true},
		{"trace.example.invalid:443", "http://trace.example.invalid/", false},
		{"trace.example.invalid:443", "https://trace.example.invalid:8443/", false},
		{"192.0.2.0/24", "https://192.0.2.8/", true},
		{"192.0.2.0/24", "https://198.51.100.8/", false},
	} {
		t.Setenv("NO_PROXY", tc.list)
		u, _ := url.Parse(tc.target)
		proxy, err := For(u)
		if err != nil || (proxy == nil) != tc.direct {
			t.Errorf("NO_PROXY=%q for %s: proxy %v, err %v, want direct=%t", tc.list, tc.target, proxy, err, tc.direct)
		}
	}
}
