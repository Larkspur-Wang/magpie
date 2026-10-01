# Mirasim Verification

Date: 2026-10-01, Asia/Shanghai. Host: macOS ARM64, Go 1.26.3.
Native Mirasim runtime: 0.0.387.

## Delivered State

- Fork: https://github.com/Larkspur-Wang/magpie; default branch `feat/mirasim`.
- `origin` points to the fork. `upstream` fetches yetone/magpie; its push URL
  is `DISABLED`. Upstream base: `813fdcb`.
- Installed `/Applications/Magpie Mirasim.app`, product version
  `mirasim-dev-57f34d9`, bundle ID `com.larkspur.magpie.mirasim`.
- `~/.local/bin/magpie-mirasim` points to that executable. The official
  app and its `magpie` command remain available for rollback.
- Installed app serves `127.0.0.1:3425`. Temporary port 3426 server stopped.
- Settings enable Mirasim as a provider and Claude launcher. No global
  Claude executable or Claude/Codex credential was replaced. Existing
  default Claude/Codex/Cursor models were retained.

## Local Tests

| Command | Observed result |
| --- | --- |
| `go test -tags nogui ./...` | All packages passed, including quota additions |
| `go test ./...` | All packages passed with macOS GUI build |
| `go vet -tags nogui ./...` and `go vet ./...` | Exit 0 |
| `go test -tags nogui ./internal/gateway -run TestMirasim -count=5` | Five repetitions passed |
| Focused gateway/mirasim/provider `go test -race -tags nogui` | Passed; native quota parser, bridge, adapter and routing tests included |
| `go test -race -tags nogui ./internal/provider -run '^TestZhipuKeyTeamFields$' -count=20` | Twenty repetitions passed after fixture repair |
| `node --check internal/gui/assets/app.js` | Exit 0 |
| Playwright `node --test internal/gui/tests/mirasim.test.cjs` | 4 passed, 0 failed; English/Chinese at 900/480px |
| Linux/Windows amd64 `CGO_ENABLED=0 go build -tags nogui` | Exit 0; cross-compilation, not runtime acceptance |
| `sh build/mirasim-app.sh` | Production GUI built, locally signed |
| `codesign --verify --deep --strict '/Applications/Magpie Mirasim.app'` | Exit 0; ad-hoc, not notarized |
| `git diff --check` | Exit 0 |

One earlier full-suite run failed in the unchanged upstream
`zhipu_team_key_test.go`: `fatal error: concurrent map writes`. Running that
test alone with `-race` reproduced concurrent handler writes to the `hosts`
and `asked` maps. The test-only follow-up protects those observations with
a mutex; Zhipu product logic is unchanged. Both full suites subsequently
passed. macOS linking emits libobjc/deployment-target warnings; these did
not fail tests or builds on this host.

Failure paths cover missing runtime without plain-Claude fallback, malformed
catalog/status output, invalid port overrides, hidden native diagnostics,
empty generation results, conflicting Claude gateway settings, and a
simulated native 429 followed by a successful backup group member. Quota
tests reject missing/invalid percentages, wrong quota source, signed-out
state and a local/own route; they verify model-scoped windows do not block
unrelated GLM models, stale readings are marked, disabled cards disappear,
and native quota reaches the allowance-aware router. Native `[1m]` argument
preservation is tested, not a million-token workload.

## Live Model And Agent Tests

```sh
MAGPIE_VERIFY_URL=http://127.0.0.1:3425 node scripts/verify-mirasim.mjs
```

The installed product passed seven semantic checks: native catalog; GLM chat
with positive token counts; OpenAI Responses; Anthropic Opus; a caller tool
roundtrip through native MCP with a random returned marker; streaming SSE
with nonempty answer and `[DONE]`; and invalid model -> HTTP 502 rather than
an empty 200 response. GLM and Opus were exercised live; the catalog has 10
models, not all 10 independently generation-tested.

The native launch command returned `OK`, `is_error:false`, 73 input / 4
output tokens. Mirasim's native receipt reported one platform call and zero
direct calls. That receipt is not a verified bill or monetary balance.

An actual Codex `exec` used temporary command-line overrides, an ephemeral
session and read-only sandbox to call `mirasim/glm-5.3-flash` on port 3425.
It returned `OK`. The Magpie ledger recorded `agent=codex`, `provider=mirasim`,
actual model `glm-5.3-flash`, 61,439 input / 18 output tokens and HTTP 200.
The intentionally config-free client logged model-metadata fallback warnings:
the generic model-list API is not Codex's rich metadata format. Generation
succeeded; full rich-metadata acceptance is not claimed. No Codex login or
default model was changed.

A real `group/auto-glm-5-3-flash` request returned `OK`, selected Mirasim and
recorded 1,450 input / 10 output tokens and HTTP 200. That automatic group
also contains WorkBuddy and WorkBuddy AI; Opus groups contain Mirasim and
Cursor. Real subscriptions were not deliberately exhausted to prove failover.

## Live Native Quota And GUI

```sh
magpie-mirasim quota mirasim --json
```

The native `ui-cli --port 4970 relay status` reports `source=relay-limits`.
CLI verification returned actual platform windows and plan expiry. The
updated GUI's Usage -> Overview showed Mirasim Max with 5-hour usage 2.8%,
weekly usage 16.2%, Claude weekly 16.2%, Fable weekly 0%, reset times and
plan expiry October 22. Values are snapshots and change with subsequent use.
This is native platform quota, not an estimate derived from Magpie's ledger.

GUI inspection also confirmed Claude Code (Mirasim), native-only Claude
model choices, the enabled 10-model source, launcher/provider controls and
actual Mirasim rows in Usage -> Requests. The Google/Antigravity plugin source
became visible during this run; its generation/quota was not independently
accepted by this Mirasim audit. CC Switch remains excluded.

## Boundaries

- Keep Mirasim's desktop host running for quota reads (default port 4970;
  `MAGPIE_MIRASIM_PORT` overrides it). The native CLI owns authentication;
  Magpie does not decrypt or copy its credentials.
- One active native Mirasim account is one source. Internal accounts are
  not independently pooled. Cross-provider percentages are not added into
  a fictitious shared balance.
- Historical/direct Mirasim traffic bypassing Magpie is not imported.
  Model-price cost estimates are not platform invoices or cash balances.
- Images, every model/context limit, real quota exhaustion and Windows
  launch/resume remain unverified. The local app is not notarized.
- GitHub CI is triggered separately; local runtime evidence is independent
  of its status. An in-progress run is not a passed CI suite.

VERDICT: PARTIAL
