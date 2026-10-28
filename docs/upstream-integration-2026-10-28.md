# Upstream Integration Candidate: 2026-10-28

## Source State

- Upstream: `6104e88a`, tag `v0.1.1906`.
- Starting fork product branch: `020258a7` (`origin/feat/mirasim`).
- Merge: `b386ae83`, 340 new upstream commits, no conflicts.
- Candidate branch: `integrate/upstream-20261028`.
- The original product checkout and its seven modified tracked files and
  untracked files were not reset, stashed, committed or overwritten.
- Origin's `main` remains a pure upstream mirror. This candidate is not a
  release and must not replace the installed app until its gates pass.

The merge retains the Mirasim native launcher, signed Claude bridge,
native allowance integration, independent GPT plugin, Cohub text adapter,
Antigravity discovery wrapper and custom non-semver build/update guard.
It does not replace any of them with the official app or change plugin
dependency pins.

## Checks Actually Run

| Check | Result |
| --- | --- |
| `git diff --check HEAD~1 HEAD` at the merge | PASS |
| `go vet ./...` | PASS |
| `go test ./...` | FAIL: GUI script budget and native window corners; all other reported packages passed, including gateway, agent, provider, plugin, Mirasim and update |
| `go test ./internal/gui -run '^TestCoreScriptBudget$' -count=1` after the fork allowance fix | PASS |
| `go test ./internal/mirasim ./internal/provider ./internal/plugin ./internal/update -run 'Mirasim\|DesktopVersion\|Relay' -count=1` | PASS; plugin reported no tests matching this selection |
| `node --test plugins/*/*.test.mjs` | PASS: 54 tests, zero failures/skips |
| `go test -race ./internal/gateway/ ./internal/redact/` | FAIL: gateway exceeded its default 600-second timeout; redact passed |
| `go test -race ./internal/gateway ./internal/redact -run 'Mirasim\|Relay\|Quota\|Plugin.*(Tool\|Stream)' -count=1 -timeout 3m` | PASS: gateway; no matching redact tests |
| `sh build/mirasim-app.sh` at the merge | PASS: ad-hoc signed `mirasim-v0.1.1906+b386ae83`; candidate only, not installed |

The script-budget failure was caused by the fork's existing 443-byte
`app.js` extension exceeding upstream's reduced budget. The fix adds
exactly that fixed extension allowance to both limits, preserving
upstream's own headroom. It does not calculate a budget from the current
file or exempt arbitrary future growth. `i18n.js` is excluded upstream.

## Remaining Release Gates

`TestMainWindowCorners/macOS_26_SDK` fails on this Mac's macOS 27 AppKit:
plain and toolbar windows both report 16-point corners, but the upstream
helper still removes the toolbar. The test requires preserving it when
the corner sizes do not differ. The same failure was independently
reproduced on a detached, unmodified `6104e88a` worktree with:

```sh
go test ./internal/gui -run '^(TestMainWindowCorners|TestCoreScriptBudget)$' -count=1
```

The upstream script budget passes there; the native window test fails.
Do not skip or weaken the window test to call this candidate green.

The full gateway race run also exceeded 600 seconds while exercising
large-request tests, with `TestCodexBodyReadsPastOldLimit` in the timeout
stack. The scoped race pass is not a full race pass. The full normal
gateway run passed in 467.610 seconds.

The first browser regression invocation lacked Playwright. Playwright was
installed outside the repository, but browser binaries were absent; the
download repeatedly reset and was cancelled after the native release
gate had already failed. The Chromium/WebKit Mirasim matrix was NOT run.
No candidate exact-client tool/SSE or live native GUI acceptance is
claimed. The production app was not restarted or replaced.

## Separate Runtime Cleanup

At the user's explicit request, production configuration removed the
Cursor and SuperGrok plugins, their Magpie sign-ins, provider rows and
model-picker entries. All three Grok routing groups and the corresponding
three Mirasim profiles were removed. The nine other explicit groups keep
their original member order and metadata, minus Cursor members. Native
Cursor/Grok applications and historical request ledgers were not deleted.
Removed migration tombstones remain to prevent automatic reactivation.

Production short-request checks, on the existing installed build:

- Mirasim Claude Opus 5.5: HTTP 200, `MAGPIE_OK`.
- Mirasim GPT 6.1 Sol: HTTP 200, `MAGPIE_OK`.
- Local Codex GPT 6 Astra: HTTP 200, `MAGPIE_OK`.
- Cohub GPT 6.1 Sol text route: HTTP 200, `MAGPIE_OK`; this Magpie adapter
  remains text-only, unlike Cohub's separate native agent surface.
- Antigravity Gemini 3.8 Flash: HTTP 400, location not supported. This is
  not usable-provider acceptance and was not bypassed.
- WorkBuddy remains switched off; it was not re-enabled or tested.

Removed Cursor/SuperGrok provider routes and all three Grok group routes
were individually called and returned HTTP 404, not a silent fallback.
No other account identity or routing priority was deliberately changed.
Credential-bearing rollback backups remain private and are not in Git.

Verdict: source merge candidate prepared; runtime removal verified;
release/install NOT accepted.

## Subsequent User-Requested Installation

Later on 2026-10-28 the user explicitly requested replacing the running
app after being told about the test failures above. This supersedes the
earlier decision not to install, not the recorded test results.

- Rebuilt the custom edition from exact source `e2aa30a2` as
  `mirasim-v0.1.1906+e2aa30a2`; verified its bundle ID, local signature and
  installed binary hash. No official binary was used.
- Backed up active configuration and retained the old app outside
  `/Applications`, then restarted the existing LaunchAgent. Gateway
  ownership changed from PID 18300 to PID 34250 on port 3425.
- Post-install native Mirasim verification passed Chat Completions,
  Responses, Anthropic generation, a random-marker tool roundtrip, token
  accounting, SSE and invalid-model rejection.
- Both `group/gpt-6-astra` and `group/gpt-sol` passed real Responses
  generation, random-marker tool roundtrips and SSE. Routing records
  were checked for Mirasim GPT first/only, not merely successful fallback.
- Direct short requests to Mirasim Claude, Mirasim GPT, Codex and Cohub
  passed. Antigravity also passed this time, reporting served model
  `gemini-3.8-flash-n`; the earlier location error was not reproduced on
  this request. No proxy/account setting was changed to bypass it.
- Nine explicit groups, five remaining account identities and WorkBuddy's
  off state were preserved. Removed Cursor/SuperGrok/group endpoints
  still returned 404. No expired subscription was re-enabled.

The source product branch may now fast-forward to this documented install
record at the user's request. This is an installed custom build with
known outstanding full-suite issues, not a claim that the native window
test, the full race suite or the browser matrix passed. No release tag is
created while those gates remain unresolved.
