# Group Check: 2026-10-05

Checked 07:16-07:20 Asia/Shanghai. No route definitions, consumer defaults,
provider logins or running applications were intentionally changed/restarted.
Live probes consume subscription quota and append diagnostic requests to the
normal Magpie ledger.

## Configuration

- Installed CLI: `mirasim-v0.1.552+fa4ce82`.
- Mirasim runtime selected by state.json: `0.0.415`.
- Mirasim provider enabled; launcher `mirasim claude`.
- Existing gateway listens at loopback port 3425; desktop host at 4970.
- Ten explicit groups retain `routing=order`; no fast members or WorkBuddy
  members in these groups. Auto-discovered smart groups remain separate.
- Mirasim model export (without keys) confirms all ten profiles reference
  their current group IDs and Magpie's localhost base URL. No agent defaults
  are bound to these profiles.

## Live Results

Requests asked for a short `OK` reply, mostly at low effort. Grok's fixed
member effort remained high. Final providers below come from the last
successful entry in `tries`, not solely the record's top-level provider.

| Requested group | Final provider / model | Result | Duration |
| --- | --- | --- | --- |
| claude-opus-5-5 | mirasim / claude-opus-5-5 | 200, OK | 4.1 s |
| claude-sonnet-5-5 | mirasim / claude-sonnet-5-5 | 200, OK | 4.1 s |
| claude-fable-5-1 | mirasim / claude-fable-5-1 | 200, OK | 4.2 s |
| gpt-6-astra | codex / gpt-6-astra | 200, OK | 3.5 s |
| gpt-sol | codex / gpt-6.1-sol | 200, OK | 7.0 s |
| gemini | cohub / gemini-3.8-flash:text | 200, OK after Antigravity 429 | 12.0 s |
| grok | cursor / cursor-grok-4.6, high | 200, OK | 12.4 s |
| kimi-k3 | mirasim / kimi-k3 | 200, OK | 2.9 s |
| glm-5-3-flash | mirasim / glm-5.3-flash | 200, OK | 5.3 s |
| deepseek-v4-flash | mirasim / deepseek-flash | 200, OK | 3.2 s |

Opus additional checks:

- Direct Mirasim provider request: 200, OK, tokens present.
- Desktop-host `ui-cli model test` using the existing Magpie provider:
  200, pong, approximately 3.8 seconds.
- High-effort function-tool roundtrip with an unpredictable random marker:
  passed; actual served model claude-opus-5-5, source mirasim.
- Anthropic Messages SSE: correct text and message_stop; passed.

These checks do not reproduce the user's full long conversation, compaction,
all subagents, or every possible fallback branch.

## Mirasim Historical Failure

On October 4, approximately 16:48-16:55 local time, the native diagnostic
file `~/.mirasim/diag/ev-2026100408.ndjson` contains repeated relay.mirasim.ai
503 responses and a `net.request.fail` event with
`errorCode=platform_queue_full`. The native Sonnet turn ended interrupted
after approximately seven minutes. Concurrent Magpie Sonnet group requests
ended as 499 (`the agent canceled the request`) after approximately 357 and
54 seconds.

Therefore the 499 records are not sufficient to dismiss the original issue
as merely user cancellation: actual platform queue failures existed in the
same interval. The new requests on October 5 are successful. The historical
queue condition has not been independently recreated or fixed locally.

The CLI bridge consumes stream-json result/error events, not each raw relay
HTTP response. Internal CLI retries can delay the terminal failure Magpie
needs to try another provider. No failover timing policy was changed.

## Antigravity Remains Unavailable

The Gemini group initially encountered native Antigravity 429
`Resource has been exhausted`, then succeeded through Cohub text-only.
Two subsequent direct Antigravity requests, at high and low effort, both
returned 400 `User location is not supported for the API use` from the
plugin's selected daily/sandbox endpoint.

Native quota read still reports substantial remaining allowance (Gemini
weekly 99.75%, five-hour 100%). Consequently neither a successful quota read
nor the initial 429 proves account exhaustion or generation availability.
No proxy, region, account or plugin configuration was changed.

Cohub rejects tool-bearing requests. Gemini's text-only fallback success is
not acceptance for a coding-agent tool workflow. Also this gateway's Gemini
record retained the initial provider at its top level despite the Cohub
success; the detailed tries show the actual successful source.

## Evidence

- Current requests: `~/.config/magpie/routing/2026-10-05.jsonl`.
- Historical canceled group requests:
  `~/.config/magpie/routing/2026-10-04.jsonl.gz`.
- Native historical relay errors:
  `~/.mirasim/diag/ev-2026100408.ndjson`.
- CLI bridge implementation: `internal/gateway/claude_subscription.go`.

Verdict: nine groups succeeded at their first provider in this check;
Gemini succeeded only for a tool-free request through Cohub. Mirasim is
currently callable, but the historical platform queue failure and long-turn
behavior must not be represented as fixed by these short probes.
