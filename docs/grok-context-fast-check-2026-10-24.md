# Grok context windows and optional Fast in Mirasim

Checked 2026-10-24, Asia/Shanghai. Grok 4.7's native context and speed
selection pass. Grok 4.6's normal context passes, but its Fast agent
requests still expose errors in the current Cursor plugin. The full
two-model speed matrix is not accepted.

## The actual layers

```text
Mirasim UI -> native Codex agent -> Magpie routing group -> Cursor Grok
```

Cursor is the model source, not the outer agent. Changing a source does
not change the agent's own model catalog, compaction, or speed controls.
No production agent was changed to Claude Code during this work.

## Source capabilities versus the previous client fallback

Cursor's authenticated picker, read with its installed plugin, reports:

| Model | Actual Cursor context | Optional speed | Efforts |
| --- | --- | --- | --- |
| Grok 4.6 | 256000 | normal / Fast | low, medium, high, xhigh |
| Grok 4.7 | 256000 / 500000 | normal / Fast | low, medium, high, xhigh |

4.7 at 500K selects the picker's `context=500k` and Max Mode. Max Mode is
a context/billing mode, not the reasoning level named max. Fast is a
separate `fast=true` parameter, selected by `service_tier=priority`.
No speed multiplier or monetary saving was established by these probes.

The old `cursor-grok-4.6` alias was advertised as 500K by generic fallback
metadata, although Cursor's actual 4.6 picker says 256K. The new 4.6 group
uses canonical `cursor/grok-4.6` and explicitly declares 256K.

The original 4.7 Mirasim/Codex session reported 258400 usable tokens.
The cause was not routing to Cursor's 256K variant: the group was already
on `cursor/grok-4.7@500k`. In Mirasim 0.0.626, the bundled `HRc` helper
constructs a Codex catalog filename using the remote model ID directly.
For `group/grok-4-7` it tries to write below `model-catalog/group/`, but
creates only `model-catalog/`. The failed write is caught and cached as
null, so Codex falls back to its generic model metadata. The expected
directory was empty before the fix.

## Applied compatibility fix

No installed Mirasim application file was patched. Magpie already accepts
a group's name/normalized-name alias. The existing Mirasim profile IDs
now use slash-free aliases, with explicit, source-verified context limits:

| Existing Mirasim profile | Wire model alias | Actual group | Window |
| --- | --- | --- | --- |
| 3d5ad590-43af-4940-8da0-706d758a7e4a | grok-4.6 | group/grok-4-6 | 256000 |
| 3084549a-e80c-4055-9165-812c29275cf1 | Grok 4.7 | group/grok-4-7 | 500000 |

The public `group/...` IDs remain valid and unchanged for other clients.
The native Mirasim catalog files now exist with valid slash-free names.
4.6's native roster metadata may name a larger maximum, but the profile
explicitly limits it to Cursor's verified 256K; the native token reading
confirms that limit rather than relying on the roster's maximum.

Both profiles retain their four effort choices and default high. Both
groups remain order/turn, Cursor first, with no forced Fast member.
Other groups, logins and production agent defaults were preserved.
Mirasim stays local, and production Codex speed stays default.

## Check: Native context, not just an edited label

Commands run: `mirasim ui-cli --port 4970 prompt` on quiet test sessions,
then `session context --session <key>`. All requests used the existing
profiles and own route, with no file reads or tool calls requested.

Output observed:

```text
Grok 4.7 new session: windowTokens=475000
Grok 4.7 existing test session continued: 258400 -> 475000
grok-4.6 new session: windowTokens=243200
```

Result: PASS for native client configuration. These are Codex's reported
usable windows (95% of 500K/256K); Mirasim estimates the breakdown
categories, but takes the window from Codex's native token-count record.
No 500K-capacity or greater-than-256K payload stress test was run.

## Where the manual Fast control is

Mirasim 0.0.626 exposes it under:

```text
Settings -> Agents -> Codex -> Speed tier
设置 -> 智能体 -> Codex -> 速度档
```

Native `settings.search` for Fast returned
`agents.codex.speedTier`, title `Codex · 速度档`. The UI implements that
control through `setAgentDefaults {agent:codex, serviceTier:priority}`.
It is an agent-wide preference, not a per-Grok composer toggle. Changing
it can affect later Codex sessions using other providers too. It was left
at default in the real desktop; no global Fast was silently enabled.
The provider and model must actually support it. Fast can consume more
allowance, and does not itself enlarge a context window.

## Check: Actual native Mirasim Fast and normal requests

To avoid changing a real agent's speed while other work is running, the
live verifier starts a separate loopback Mirasim host with private
MIRASIM_HOME and CODEX_HOME. It imports no sign-in. The gateway uses the
already configured account on the real Magpie. Public model metadata is
seeded from the desktop-generated catalogs so a fresh, account-less host
has the same speed metadata; production catalog creation is checked
separately above. No production config file is copied into that host.

Command run:

```sh
node scripts/verify-mirasim-context-fast.mjs --model 4.7
```

Output observed:

```text
native Mirasim to Cursor: Grok 4.7 priority -> actual priority, 475000, 200, PASS
native Mirasim to Cursor: Grok 4.7 default -> actual default, 475000, 200, PASS
isolated host stopped
```

Result: PASS. Ledger sessions `01a16c1a-cc21-77f2-9435-75db5739ed69`
and `01a16c1a-e9a4-7181-b72d-601af0d4374f` each have exactly one Cursor
attempt, served `grok-4.7@500k`, effort high, at their respective speed.
The verifier fails if a fallback succeeds instead, or if the actual tier
does not match. It uses the same supported atom as the real speed UI,
not an invented model named Fast. All isolated hosts were stopped.

## Check: Grok 4.6 Fast adverse cases

Command run:

```sh
node scripts/verify-mirasim-context-fast.mjs
```

Output observed on full native agent requests: FAIL. Earlier attempts at
low and high also failed; these failures are not replaced by a later
simple HTTP-200 result.

The local installed Cursor plugin is 0.2.19; the npm registry also
reported 0.2.19 as latest during the check. With a full native agent
request, Cursor Fast 4.6 returned either:

```text
502 Cursor: native tool batch exceeded its declared count
502 Cursor: an empty reply (Cursor ended the turn without text or a tool call)
```

The fallback could initially answer on Grok's own source. A later request
found that source's included free allowance exhausted (429) and Cohub
then rejected the tool-bearing request (400). Neither is Cursor success.
A small direct request to Cursor 4.6 Fast returned 200, which establishes
that the speed can be requested but does not qualify native agent use.
No tool-count guard or safety check was disabled to suppress these errors.

Result: FAIL for stable Cursor 4.6 Fast with native agent context/tools.
Default-speed 4.6 remains usable. Fast is opt-in, but should not be relied
on for that group pending a plugin fix and exact-client regression test.

## Reuse and limits

Re-run only the qualified 4.7 lane with `--model 4.7`. Default invocation
checks both and intentionally remains red while 4.6 Fast is broken. The
script consumes real Cursor quota and requires local Mirasim, Codex,
the real Magpie routing ledger, and the desktop-generated catalog rows.
`node --check` and `git diff --check` passed. No Go product code changed,
and no full Go, GUI, race, long-tool-chain or full-window load test ran.

Private before snapshot:
`/Users/lark/Library/Caches/magpie-context-fast-20261024`.

VERDICT: FAIL
