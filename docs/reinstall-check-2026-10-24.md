# Magpie reinstall and separate Grok groups

Checked 2026-10-24, Asia/Shanghai.

## Installation

Before reinstall, the official `/Applications/magpie.app` (0.1.1364)
owned gateway port 3425. The custom `Magpie Mirasim.app` was also installed
(mirasim-v0.1.1313+a6937170-dirty). The `magpie` command pointed to the
official application, while `magpie-mirasim` pointed to the custom one.

Rebuilt the existing fork using `sh build/mirasim-app.sh`. This is a
reinstall of the custom source, not a merge of the newest upstream. The
build identifies itself as `mirasim-v0.1.1314+a6937170-dirty`; the ancestor
tag changed after tags were fetched, not because a new merge was done.
Existing uncommitted source changes were preserved, built, and not
committed or pushed during this task.

Installed binary SHA-256:

```text
9669c7ce69d34200d37bc83cfe0dbaacb03de823790f306f33fbe4aa9b4a7275
```

`codesign --verify --deep --strict` succeeded. This is a locally ad-hoc
signed build, not a notarized release. The installed and built binaries
have identical hashes.

The application under `/Applications` is now only `Magpie Mirasim.app`.
Both `~/.local/bin/magpie` and `~/.local/bin/magpie-mirasim` resolve to its
`Contents/MacOS/magpie`. The existing `com.yetone.magpie` LaunchAgent was
started and owns port 3425 (PID 86792 at verification time). Old
`magpie mcp image` children were left alone; they are not extra gateways.

Private rollback directory:

```text
/Users/lark/Library/Caches/magpie-reinstall-20261024-Xcpcgn
```

It contains the original configuration snapshot, original CLI targets,
LaunchAgent plist, previous custom application, and the official 0.1.1364
application. No login was logged out or deleted.

## Grok groups

Added, without deleting the legacy `group/grok`:

```text
group/grok-4-6  (order, stays=turn)
  cursor/cursor-grok-4.6:high
  grok/grok-4.6:high
  cohub/grok-4.6:text

group/grok-4-7  (order, stays=turn)
  cursor/grok-4.7@500k
  grok/grok-4.7@500k
```

There is no cross-version fallback in either new group. Neither contains
a fast variant. Grok 4.7 has no Cohub substitute because no matching 4.7
Cohub model was verified. Cohub 4.6 remains text-only, not a tool-capable
coding-agent fallback.

Added both profiles to the existing Mirasim Magpie provider using the
native `ui-cli profile save` command. Names in the UI are
`Grok 4.6 high · Cursor 优先` and `Grok 4.7 · Cursor 优先`. All original
profiles and agent defaults remain unchanged. Original groups and
`settings.json` were compared structurally with the backup and match.

The 12 explicit group IDs are:

```text
group/claude-opus-5-5
group/claude-sonnet-5-5
group/claude-fable-5-1
group/gpt-6-astra
group/gpt-sol
group/gemini
group/grok-4-6
group/grok-4-7
group/kimi-k3
group/deepseek-v4-flash
group/glm-5-3-flash
group/grok  (legacy mixed group, retained for existing sessions)
```

## Check: Focused tests and build

Commands run:

```sh
go test -tags nogui ./internal/mirasim ./internal/provider -run 'Mirasim|Relay' -count=1
go test -tags nogui ./internal/plugin -run 'HostEnv|Proxy|Mirasim' -count=1
go test -tags nogui ./internal/gateway -run Mirasim -count=1
node --test plugins/mirasim-gpt/*.test.mjs plugins/cohub/*.test.mjs plugins/antigravity/*.test.mjs
sh build/mirasim-app.sh
```

Output observed: all selected Go tests passed; Node reported `tests 35`,
`pass 35`, `fail 0`. Build and signature verification succeeded. macOS
compiler/linker emitted enum conversion and duplicate-library warnings.

Result: PASS. No full Go, race, or GUI suite was run for this reinstall.

## Check: Grok requests through the installed gateway

Commands run:

```sh
node scripts/verify-subscriptions.mjs group/grok-4-6 group/grok-4-7
mirasim ui-cli --port 4970 model test --provider 1e8faf1e-ce9a-40ee-adc1-4f955100f790 --model group/grok-4-6
mirasim ui-cli --port 4970 model test --provider 1e8faf1e-ce9a-40ee-adc1-4f955100f790 --model group/grok-4-7
```

Output observed: `passed:2,total:2`; both native UI model tests returned
`ok:true`, `reply:pong`, upstream 200 (4393 ms for 4.6; 4001 ms for 4.7).
Ledger evidence shows the actual successful provider was `grok`, not
Cursor. Cursor attempts return 401, "Cursor's sign-in has run out".

Initial result: PASS for separate models and working fallback; FAIL for
the initially expired Cursor first hop. Browser sign-in was completed
through Magpie's supported `plugin login cursor` flow. The CLI returned
`signed in to Cursor`.

Post-authorization command run:

```sh
node scripts/verify-subscriptions.mjs cursor/cursor-grok-4.6 group/grok-4-6 group/grok-4-7
```

Output observed: `passed:3,total:3`. Per-attempt ledger evidence:

```text
11:20:44 cursor/cursor-grok-4.6 -> cursor / cursor-grok-4.6 / 200
11:20:49 group/grok-4-6 -> cursor / cursor-grok-4.6 / high / 200
11:20:53 group/grok-4-7 -> cursor / grok-4.7@500k / 200
```

Each request has exactly one attempt. Final result: PASS for actual Cursor
first-hop selection, not only successful sign-in or fallback.

## Check: GPT regression

Command run:

```sh
node scripts/verify-mirasim-gpt.mjs group/gpt-sol group/gpt-6-astra
```

The first post-restart Sol request timed out after 120 seconds. Its
ledger attempt is `mirasim-gpt`, final status 499 after the test canceled.
Do not hide this failed first run. Separate direct Astra and Sol probes
then returned 200.

The complete rerun at 11:18:03-11:18:22 passed generation, unpredictable
tool-result continuation, and SSE for both groups. All eight ledger
requests have one attempt, `id:mirasim-gpt`, status 200, and the correct
served model; no Codex, Cursor, or Cohub fallback.

Result: PASS for the rerun, not a long-session stability claim. The tool
continuation with a random marker and structural no-cross-version checks
are adverse-path checks rather than simple health checks.

## Mirasim mode

Per the user's explicit instruction, preserve `local` and keep both local
and platform choices available. No switch to `cloud` was performed. The
native local-mode Claude probe reports "Not logged in"; this was not
silently treated as working platform access. Mirasim's local/own route to
the Magpie Grok profiles was verified. Local here means the configured
provider path, not offline model inference. The separately authenticated
Mirasim GPT plugin is independent of the native Claude launch mode.

## Scope limits

Cursor browser authorization and real first-hop verification are complete.
The native Claude account/platform-mode decision is intentionally deferred
by the user. Other providers were not all requalified in this task. PASS
below applies to the reinstall, preserved configuration, separate Grok
groups and their real Cursor first hops, not all-provider availability.

VERDICT: PASS
