# Mirasim GPT Cold-Start Fix And Upstream Upgrade

## Observed User Failure

On 2026-10-12 at 07:23:14 Asia/Shanghai, `group/gpt-sol` tried
`mirasim-gpt/gpt-6.1-sol` first. It failed after 15 ms with status 502:

```text
Mirasim GPT has no endpoint configured
```

The next attempt used Codex and succeeded. Subsequent tool continuations
remained on Codex (`affinity.why=turn`), as expected for a tool-bearing turn.
The group definition was not reordered and native quota was not exhausted.
This was not evidence that Mirasim successfully answered: the old gateway's
top-level provider field could still name the initial provider after failover.
Use the successful `tries[].id` to identify the actual source.

## Root Cause And Fix

The pinned native plugin returns the supplied provider models on a transient
catalog/ticket network failure. Our GPT adapter supplied an empty base list.
On cold start this lost the GPT catalog and left the Go provider without a
configured Responses endpoint.

Two regression tests failed before their corresponding fixes:

- JS: with a previously verified account catalog and a network failure,
  the models hook returned `[]` instead of `gpt-6-astra`.
- Go: a cold plugin declaring `@ai-sdk/openai` but no loaded models returned
  no endpoint instead of Responses (Anthropic/Chat transports failed too).

Fixes:

- Seed the models hook from only that account's previously verified catalog;
  preserve roster withdrawals, GPT-only transport and context metadata.
  No models are fabricated for a signed-out account.
- While a plugin catalog is empty, configure its endpoint from its explicitly
  declared SDK transport. A plugin with no declared transport remains empty.
  Its native loader still authenticates and signs each real request.

## Routing Policy

Both GPT groups now use `routing=order`, `stays=turn`, with no intent rules:

```text
group/gpt-6-astra:
  mirasim-gpt/gpt-6-astra
  codex/gpt-6-astra
  cohub/gpt-5.6-sol:text

group/gpt-sol:
  mirasim-gpt/gpt-6.1-sol
  codex/gpt-6.1-sol
  codex/gpt-6-sol
  cursor/gpt-5.6-sol
  cohub/gpt-5.6-sol:text
```

Mirasim is highest priority for each new user turn while available. Tool
continuations remain on the source that answered that turn. This is priority,
not forced single-provider routing; errors still trigger the retained fallback.
An already-running turn that fell back to Codex is not silently switched
mid-tool-chain. Cohub remains text-only.

## Upgrade

Fetched official upstream main at `74b30cb7`, tag `v0.1.1202`, and merged
1,919 upstream commits into the product branch. Merge commit: `839ffb77`.
Cold-start fix commit before that merge: `a651b0f5`.

Preserved native Mirasim launcher, catalog, quota and session support; kept
the independent GPT, Cohub and Antigravity adapters. Adapted native CLI
command injection to upstream's new session bridge rather than restoring
the obsolete bridge. Mirasim controls moved into Settings -> Models with
the updated tabbed UI. Official-update protection remains covered by its test.

Pre-install backup:
`~/Library/Caches/magpie-mirasim/pre-upgrade-20261012/` contains the old app
archive and pre-install settings/provider/plugin configuration. It is local
private material, not a shareable credential export.

## Verification Before Install

- `node --test plugins/*/*.test.mjs`: 34 passed, 0 failed.
- Bun Mirasim GPT tests: 9 passed, 0 failed, including offline cold start.
- Focused native Mirasim/ColdStart Go tests passed across gateway, provider,
  agent, GUI, sessions, settings and native runtime integration.
- Focused race tests passed for gateway/provider and redaction selection.
- Gateway order/turn/affinity regression selection passed.
- `go vet -tags nogui ./...` passed (upstream macOS enum-conversion warning).
- Playwright Mirasim settings tests passed at 900/480 px in English/Chinese;
  screenshots under `/tmp/magpie-ui-check-20261012/screens/`.
- Custom-version update-protection test passed; app build and signature check
  passed for `mirasim-v0.1.1202+839ffb77`.
- Before app install, a fresh real Codex CLI using `group/gpt-sol`, xhigh,
  returned `OK`; 07:27:34 ledger shows one `mirasim-gpt` attempt, status 200.
- Both direct providers and both groups passed generation, random-marker
  tool roundtrip and SSE tests after the adapter reload.

## Installed Runtime Acceptance

Installed and restarted `/Applications/Magpie Mirasim.app`:
`mirasim-v0.1.1202+839ffb77`. Bundle signature verification passed. The new
process listens on `127.0.0.1:3425`; LAN sharing was not enabled.

A real Codex CLI started against the new gateway, `group/gpt-sol`, xhigh,
returned `OK`. The 07:42:00 route record shows a single successful
`mirasim-gpt/gpt-6.1-sol` attempt, no Codex fallback. After installation,
both groups again passed generation, random-marker tool roundtrip and SSE;
all eight requests selected `mirasim-gpt` first. Group IDs and profile references
were retained. The native Claude launcher/provider remains enabled.

The official `main` mirror and product branch were pushed to the fork;
installed release tag: `mirasim-v0.1.1202.1`. No fresh OAuth sign-in or desktop
credential copying was needed. Diagnostic commands run inside a Mirasim Codex
relay home should unset `CODEX_HOME` to inspect the desktop's native Codex
subscription, rather than that isolated relay home's account discovery.

## Full-Suite Limitations

`env -u CODEX_HOME -u CLAUDE_CONFIG_DIR go test -tags nogui ./...` did NOT pass:

- `TestOTelClaudeMainAndChildDedupRetainsHelper` failed with unexpected end of
  JSON input. A repeated gateway run logged ONLY this test as failed; the same
  failure reproduced in an unmodified upstream worktree at `74b30cb7`.
- `TestOTelSessionWatcherExportsNewInteractionWithoutGatewayDuplicates`
  failed with `no hierarchy`; it also reproduced on unmodified upstream.
- The provider suite reached its ten-minute timeout in `TestZhipuKeyTeamFields`.
  The merge had combined our earlier inner map lock with upstream's new outer
  handler lock. A three-second isolated run reproduced the deadlock. Removing
  the redundant inner lock fixes this TEST fixture without changing product
  logic; the five-repetition race regression passes afterward.

Do not describe this release as full-suite green or all-provider runtime
acceptance. The requested GPT route is verified; historical/native Claude
platform congestion and full long-context sessions are not covered by the
short GPT probes. Existing unrelated local untracked documents were retained.

VERDICT: PARTIAL
