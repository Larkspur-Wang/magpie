# Cohub completion tool capability recheck

Checked 2026-10-24. No provider configuration, group priority, account,
text-only guard, or running gateway was changed. The old blanket wording
"Cohub does not support tools" is too broad: Cohub agents have tools;
this check concerns external caller-supplied tools on the completion API
used by the Magpie provider.

## Current installation

- Installed CLI: `@neta-art/cohub-cli` 10.12.1.
- Registry `npm view @neta-art/cohub-cli version`: 10.12.1.
- CLI dependency: `@neta-art/cohub` 12.6.0.
- CLI command `completion --help`: raw LLM completion, no tool-definition
  option. `prompt --help` has harnesses cohub, pi, codex, claude,
  workbuddy and cursor; it is an agent/task surface, not raw completion.

## Check: bypass the Magpie guard

Command run:

```sh
node scripts/probe-cohub-tool-capability.mjs
```

The script uses the installed CLI's own `createClient`, login refresh,
and `resolveHomeSpace`. It calls `space.completion` and
`space.streamCompletion` directly. No tool request is sent through
Magpie's `toCohubInput` guard. No token, raw auth file or credential-bearing
diagnostic is printed or saved in this report.

The SDK's real HTTP implementation serializes the full input with a
spread into the JSON request to `/api/spaces/<id>/completions`. Thus tool
fields supplied by the probe are not removed by the SDK. The test tool
`read_private_marker` is harmless and exposes no real file or shell
operation. The prompt explicitly distinguishes a structured tool call
from a model writing fake tool-call text.

Output observed:

```text
OpenAI tools + tool_choice: claude-opus-5-5, stop, calls=0, NO_TOOL
Anthropic tools + tool_choice: claude-opus-5-5, stop, calls=0, NO_TOOL
Pi tools + toolChoice: claude-opus-5-5, stop, calls=0, NO_TOOL
native SSE tool request: meta,delta,usage,done; stop, calls=0, NO_TOOL
```

A separate SDK control on `gpt-6.1-sol`, OpenAI function tools and
`tool_choice:required`, returned:

```json
{"model":"gpt-6.1-sol","stopReason":"stop","contentTypes":["text"],"text":"NO_TOOL"}
```

Result: caller-supplied structured tool calls were NOT observed on this
completion endpoint, across the tested encodings, JSON/SSE and two model
families. Since no first structured call occurred, an actual tool-result
roundtrip could not run. Successful HTTP/text generation is not agent
tool compatibility. No claim is made that these underlying models are
incapable of tools through other interfaces.

## Check: protocol and source explanation

The installed SDK's `CreateSpaceCompletionInput` declares provider, model,
systemPromptPath, messages, temperature, maxTokens, thinkingLevel and
stream, but no tools or tool-choice field. `CompletionMessageInput`
reuses generic `ContentBlock` types; generic tool-related blocks in that
union do not establish a supported tool-definition transport. The
completion SSE contract has text/thinking deltas, usage, done and error,
not tool argument/call events.

The separately checked-out Cohub repository is an October 12 snapshot
(`e5f908fb`), not proof of the current cloud deployment. It nevertheless
explains the observed behavior:

- `apps/api/src/routes/spaces/completions.route.ts:createCompletionSchema`
  lists no tool fields; the Zod object does not passthrough unknown
  top-level keys, and `runInput` does not forward them.
- `apps/api/src/llm/stream-completion.ts:streamCompletionEvents` gives
  the underlying model only systemPrompt and messages, no tools.
- Its message conversion keeps user text/images and assistant text, not
  a general external tool-history loop.

Result: the installed published SDK and direct cloud probes agree with
the older source's limitation. The older checkout is supporting evidence,
not a claim that its HEAD equals the live service.

## Meaning for Magpie and Mirasim

- Current `cohub/<model>:text` entries remain text-only intentionally.
  Merely removing the guard would silently lose tool definitions or
  history instead of adding capabilities.
- Cohub's own `prompt`/agent runtime is a different execution surface.
  Tools running inside that agent are not automatically tools exposed by
  the Magpie caller. A safe agent bridge would require a separate design
  and native tool-handoff verification; none was installed or claimed.
- This check did not prove that every Cohub API or future version lacks
  an alternative passthrough route. It qualifies only the currently used
  published completion path.

Capability verdict for the present completion-to-coding-agent route:
FAIL. Investigation completed; text-only protection retained.

VERDICT: FAIL
