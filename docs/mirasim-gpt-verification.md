# Mirasim GPT Integration Verification

Date: 2026-10-09, Asia/Shanghai. Installed Magpie remains
`mirasim-v0.1.552+fa4ce82`; this change adds a local plugin, not a new app build.

## Changes

- Added `plugins/mirasim-gpt`, wrapping the pinned npm package
  `opencode-mirasim-auth@0.3.0` under the independent ID `mirasim-gpt`.
- Completed a fresh Google OAuth sign-in. No desktop Mirasim or Codex
  credential was copied. The plugin reports a Max plan and six GPT models.
- GPT requests go to Mirasim's signed Responses endpoint, not the local
  Codex subscription or a nested Codex process.
- Kept the native `mirasim` Claude provider and all other groups unchanged.
- Prepended `mirasim-gpt/gpt-6-astra` to `group/gpt-6-astra`, and
  `mirasim-gpt/gpt-6.1-sol` to `group/gpt-sol`. All old members remain in
  order, group IDs and `routing=order` retained, agent defaults untouched.
- CI and the upstream-sync script install the pinned dependency with
  lifecycle scripts disabled before plugin tests.

## Check: Offline Isolation And Failure Paths

Command run:

```sh
node --test plugins/*/*.test.mjs
/Users/lark/.cache/magpie/bun/1.3.14/bun test plugins/mirasim-gpt/*.test.mjs
```

Output observed: `tests 33`, `pass 33`, `fail 0`; Bun: `8 pass`, `0 fail`.
Cases include failed OAuth, missing credentials/quota, preserved native
Claude configuration, credential renewal identity, tool fields and removal
of caller-supplied signing headers. No real credentials used in tests.

Result: PASS.

## Check: Responses Streaming Regression

The initial real Astra probe passed text and tools, but streaming with a
string `input` returned 400. Controlled probes established:

```json
{"array":true,"max":1024,"status":200,"complete":true}
{"array":false,"status":400,"complete":false}
```

Added a regression assertion against the real pinned plugin transport; it
failed with actual `'Hello'` instead of a message array. The adapter now
expands string shorthand into an equivalent user-message array BEFORE the
native plugin signs it. Tools, reasoning and existing array inputs remain
unchanged. Node/Bun tests and both live streamed model probes pass afterward.

Result: PASS after adapter fix.

## Check: Direct GPT Providers

Command run: `node scripts/verify-mirasim-gpt.mjs`.

Output observed: `Responses generation`, `tool roundtrip`, `Responses SSE`
all returned `PASS` for both `mirasim-gpt/gpt-6-astra` and
`mirasim-gpt/gpt-6.1-sol`. Tool replies reproduced an unpredictable random
marker, and SSE contained text plus `response.completed`.

Local route records at 22:09:13-22:09:41 show all eight requests with
`tries[0].id=mirasim-gpt`, requested model served, status 200, no fallback.

Result: PASS.

## Check: Groups And Mirasim UI Entry

Command run:

```sh
node scripts/verify-mirasim-gpt.mjs group/gpt-6-astra group/gpt-sol
```

Output observed: generation, tools and SSE `PASS` for both groups.
All eight route records at 22:10:09-22:10:35 show one successful
`mirasim-gpt` attempt, not Codex or Cohub fallback.

Using the current native runtime's `ui-cli --port 4970 model test` against
the existing Magpie provider returned:

```json
{"model":"group/gpt-6-astra","ok":true,"reply":"pong","latencyMs":2577,"status":200}
{"model":"group/gpt-sol","ok":true,"reply":"pong","latencyMs":4142,"status":200}
```

Those two requests also show `mirasim-gpt` as the successful source.

Result: PASS.

## Check: Quota And Configuration Preservation

Command run: `magpie-mirasim quota mirasim-gpt --json`.
Output observed: plan `max`, 5h remaining 95.6%, 7d remaining 72.2%
at the initial reading. These are time-specific readings, not promises of
current balance. Claude/Fable-only windows are marked informational inside
the adapter and must not block GPT. Both Mirasim sources share the same
subscription allowance; do not add their percentages.

A structured comparison of current configuration against the pre-change
backup produced:

```text
PASS other groups, providers and settings unchanged
PASS prepended only: gpt-6-astra mirasim-gpt/gpt-6-astra
PASS prepended only: gpt-sol mirasim-gpt/gpt-6.1-sol
```

Backup: `~/Library/Caches/magpie-mirasim/gpt-before-20261009/`.
No login files are included in that configuration backup.

Result: PASS.

## Check: Existing Claude Source

Command run: `node scripts/verify-subscriptions.mjs group/claude-opus-5-5`.

Output observed:

```json
{"requested":"group/claude-opus-5-5","result":"FAIL","error":"TimeoutError","milliseconds":120003}
```

Result: FAIL. Its group/configuration remains unchanged, but this run does
not establish its current runtime health or prove the cause of the timeout.
No attempted fix or fallback reorder was made for Claude.

## Boundaries And Rollback

- GPT short requests, tool roundtrips, streaming and UI model tests passed.
  Full Codex long sessions, compaction, image inputs and live quota-exhaustion
  failover were not tested. Existing session affinity may retain an old source
  until the session releases it; a new session selects the ordered first member.
- Cohub remains text-only, even as the last group fallback.
- Remove only the two added group members before disabling this new plugin.
  Keep the original native Mirasim provider enabled. Do not blindly restore
  whole configuration backups over later user changes.
- No Go product source changed, so the full Go suite was not rerun.
- Native Claude timeout prevents claiming all previous sources are healthy;
  the requested GPT integration itself passed the checks above.

VERDICT: PARTIAL
