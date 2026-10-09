# Mirasim GPT

GPT-only adapter around `opencode-mirasim-auth@0.3.0`, pinned with npm
integrity in package-lock.json. Independent provider ID: `mirasim-gpt`.
The existing native `mirasim claude` provider is not replaced.

## Setup

```sh
cd plugins/mirasim-gpt
npm ci --ignore-scripts --no-audit --no-fund
cd ../..
magpie-mirasim plugin add "$PWD/plugins/mirasim-gpt"
magpie-mirasim plugin login mirasim-gpt 1
# Choose Google, using the same Mirasim account as the desktop app.
magpie-mirasim provider models mirasim-gpt
magpie-mirasim quota mirasim-gpt --json
node scripts/verify-mirasim-gpt.mjs
```

This is a third-party integration, not an official Mirasim API guarantee.
It signs requests itself instead of launching Codex or using ChatGPT login.
Credentials from a fresh OAuth login are saved by Magpie under the separate
`mirasim-gpt` identity; renewal writes and OAuth callbacks use that identity
too. It does not read or copy the desktop Mirasim or Codex credential files.
The pinned upstream implementation defaults to auth.mirasim.ai and
relay.mirasim.ai. Do not set endpoint overrides for a real account without
reviewing the destination. Do not auto-upgrade this authentication dependency.

Only `gpt-*` catalog entries with the OpenAI Responses transport are exposed.
Responses string-input shorthand is expanded into an equivalent user-message
array before signing: the relay rejects that shorthand on streamed requests.
Native Claude/Fable quota windows are informational for this GPT source and
do not block GPT routing. The global windows apply. The two Mirasim providers
are interfaces to the SAME subscription, not two independent allowances.

## Routing

Only after both direct model probes pass, prepend:

- `mirasim-gpt/gpt-6-astra` to `group/gpt-6-astra`;
- `mirasim-gpt/gpt-6.1-sol` to `group/gpt-sol`.

Keep the existing group IDs, ordered policy, and subsequent members intact.
Confirm the successful `tries[].id` is `mirasim-gpt`, not a fallback provider.
Mirasim UI profiles can keep referencing the same groups; do not rename or
recreate them. No agent default needs changing.

To roll back, remove ONLY the new member from each group before disabling
this plugin. Do not disable `mirasim`, which is the independent Claude bridge.
Avoid restoring an old entire providers.json over later user changes.

## Verification

```sh
node --test plugins/mirasim-gpt/*.test.mjs
bun test plugins/mirasim-gpt/*.test.mjs
node scripts/verify-mirasim-gpt.mjs
node scripts/verify-mirasim-gpt.mjs group/gpt-6-astra group/gpt-sol
```

Offline tests cover separate configuration/auth identities, GPT-only catalog,
renewal, signed Responses including tools, injected-header removal, absent
credentials, failed login and model-scoped quota. The live script verifies
text, an unpredictable function-tool roundtrip and Responses SSE per model.
Live checks spend quota and append records to the ordinary routing ledger.
