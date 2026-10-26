# Selectable Grok effort through Mirasim and Magpie

Later context/Fast follow-up: [grok-context-fast-check-2026-10-24.md](grok-context-fast-check-2026-10-24.md).
It records the current slash-free profile aliases, verified native windows,
and the remaining Grok 4.6 Fast failure. The original effort checks below
are historical evidence, not an all-speed or full-window qualification.

Verified on 2026-10-24, Asia/Shanghai. This change is configuration and
catalog refresh only; no provider or gateway product code was changed.

## Before and after

- `group/grok-4-6` had `:high` on both Cursor and Grok members. A request
  for low was sent high, as that configuration explicitly required.
- `group/grok-4-7` was not pinned, but the running gateway had an old
  Cursor catalog: reasoning false, no levels. Requests for low and high
  returned 200 with no effort on the actual attempt. HTTP 200 alone did
  not establish effort forwarding.
- Both Mirasim profiles had no explicit ladder. Their catalog therefore
  offered generic levels including max and ultra.

Cursor's current authenticated picker was read through the installed
plugin's own `usable` function. Both Grok models actually offer low,
medium, high and xhigh. Its real selection function maps those levels to
the respective `cursor-grok-4.6-{effort}` and `grok-4.7-{effort}` variants,
with `fast=false`. At 500k, 4.7 also sets the context parameter to 500k
and Max Mode, which is context mode, not a reasoning level named max.
Credentials and raw authentication responses were not saved in this doc.

Ran `magpie sync` to refresh the model lists. The CLI could then see
4.7's correct levels, but the running gateway still used its old in-memory
catalog. The first post-refresh ledger assertion failed on missing actual
effort for 4.7. Restarting the existing `com.yetone.magpie` LaunchAgent
loaded the refreshed catalog; `/v1/models` then reported reasoning true
and the four actual levels for `cursor/grok-4.7@500k`.

## Current settings

```text
group/grok-4-6: order, stays=turn, effort=agent
  cursor/cursor-grok-4.6
  grok/grok-4.6
  cohub/grok-4.6:text
  levels: low, medium, high, xhigh

group/grok-4-7: order, stays=turn, effort=agent
  cursor/grok-4.7@500k
  grok/grok-4.7@500k
  levels: low, medium, high, xhigh
```

Mirasim profiles were updated in place, without changing their IDs:

- `3d5ad590-43af-4940-8da0-706d758a7e4a`: Grok 4.6, default high.
- `3084549a-e80c-4055-9165-812c29275cf1`: Grok 4.7, default high.

Each profile declares the four verified levels. In the native Mirasim
catalog, max and ultra are marked unavailable instead of being advertised
as supported. A per-turn selection overrides the default; the default is
not a forced member suffix.

Applied using supported commands:

```sh
magpie sync
magpie group set grok-4-6 name='Grok 4.6' models=cursor/cursor-grok-4.6,grok/grok-4.6,cohub/grok-4.6:text effort=agent levels=low,medium,high,xhigh
magpie group set grok-4-7 effort=agent levels=low,medium,high,xhigh
mirasim ui-cli --port 4970 profile save --id 3d5ad590-43af-4940-8da0-706d758a7e4a --provider 1e8faf1e-ce9a-40ee-adc1-4f955100f790 --model group/grok-4-6 --name 'Grok 4.6 · Cursor 优先' --effort high --efforts low,medium,high,xhigh
mirasim ui-cli --port 4970 profile save --id 3084549a-e80c-4055-9165-812c29275cf1 --provider 1e8faf1e-ce9a-40ee-adc1-4f955100f790 --model group/grok-4-7 --name 'Grok 4.7 · Cursor 优先' --effort high --efforts low,medium,high,xhigh
launchctl kickstart -k gui/$(id -u)/com.yetone.magpie
```

These profile/provider UUIDs are machine-specific, not portable IDs.

## Check: Eight real gateway requests

Command run: a sequential Node fetch loop called
`POST http://127.0.0.1:3425/v1/chat/completions` for both groups, at low,
medium, high and xhigh. Each body carried `reasoning_effort` and a short
arithmetic question. A second Node assertion read the local routing ledger
and required requested effort = attempt effort, exactly one attempt,
provider Cursor, HTTP 200, and no forced effort.

Output observed after the restart:

| Time | Group | Requested | Actually sent | Provider | Status |
| --- | --- | --- | --- | --- | --- |
| 11:33:52 | grok-4-6 | low | low | cursor | 200 |
| 11:34:02 | grok-4-6 | medium | medium | cursor | 200 |
| 11:34:10 | grok-4-6 | high | high | cursor | 200 |
| 11:34:22 | grok-4-6 | xhigh | xhigh | cursor | 200 |
| 11:34:38 | grok-4-7 | low | low | cursor | 200 |
| 11:34:41 | grok-4-7 | medium | medium | cursor | 200 |
| 11:34:46 | grok-4-7 | high | high | cursor | 200 |
| 11:34:51 | grok-4-7 | xhigh | xhigh | cursor | 200 |

Result: PASS. No fallback. This verifies parameter delivery, not a claim
about model intelligence, exact reasoning duration, or hidden token count.

## Check: Real Mirasim sessions and changes within a session

Commands run: native `mirasim ui-cli --port 4970 prompt`, using Codex,
the existing profiles and `--route own`. Quiet test sessions were created
in `/tmp`, with explicit instructions not to read files or use tools.
Later turns used the same session with a different `--effort`.

Output observed: settled phases were done, error null. Arithmetic answers
were 4, 6, 8 and 10. The actual route ledger, agent `mirasim`, showed:

- 4.6 session `01a16bf6...`: low at 11:31:35, xhigh at 11:32:28.
- 4.7 session `01a16bf7...`: low at 11:33:51, xhigh at 11:34:34.
- New 4.7 session `01a16bf9...`, no explicit effort: high at 11:34:37.

Every listed attempt was Cursor, HTTP 200, at the requested effort.
The earlier 4.7 high test before the restart had no attempt effort and is
not counted as a passing depth test.

Result: PASS. Changing the effort within an existing Mirasim session
reaches Cursor; the profile's high default does not override that choice.

## Check: Scope and unsupported levels

Commands run: structural Node assertions against the private before
snapshot; native Mirasim `catalog --agent codex`, `model export` and
`relay status`; `magpie healthcheck`.

Output observed:

```text
PASS other group definitions preserved
PASS: global Magpie settings unchanged.
{"mode":"local"}
```

The native catalog lists only the four declared levels as available;
max and ultra have `unavailable:true`. The new groups remain order/turn,
Cursor first, without fixed effort, cross-version members, or fast mode.
Legacy `group/grok` and other groups were not rewritten. No global agent
default or login was changed. Mirasim remains local as requested.

Result: PASS. The pre-fix low-to-high counterexample and within-session
low-to-xhigh tests are the adverse-path checks. No new Go/plugin source
was changed, so no product rebuild or full source suite was needed here.
Fallback providers' effort behavior was not independently requalified.

Private before-snapshot location:
`/Users/lark/Library/Caches/magpie-grok-effort-20261024`.

VERDICT: PASS
