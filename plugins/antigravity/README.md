# Antigravity Adapter

This Magpie adapter wraps the community plugin at
<https://github.com/JoshRob297/opencode-antigravity-auth>, version 2.0.0,
pinned to `a72b130960b30d2ca6af4eef6f514ac99f0f18b4` for the local installation.
It forwards native authentication and request handling, supplies the plugin's
seven native model definitions to Magpie, and adds a native quota usage hook.
It is a community integration, not a Google-supported API product.

## Install

Build the upstream plugin in a separate checkout, without modifying its sources:

```sh
git clone https://github.com/JoshRob297/opencode-antigravity-auth.git ../magpie-antigravity-auth
git -C ../magpie-antigravity-auth checkout a72b130960b30d2ca6af4eef6f514ac99f0f18b4
cd ../magpie-antigravity-auth
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test -- --reporter=dot
```

Add this entry to Magpie's `plugins.json`, using absolute paths on your machine:

```json
{
  "plugins": [
    { "spec": "opencode-antigravity-auth@latest", "off": true },
    {
      "spec": "/absolute/path/magpie/plugins/antigravity",
      "options": { "upstream": "/absolute/path/magpie-antigravity-auth" }
    }
  ]
}
```

Keep only one Antigravity plugin active. Magpie retains the same native
`google` authentication identity and exposes it as `google-plugin`; the
adapter does not extract or copy credentials. Back up existing configuration
before changing plugins. If no account is signed in, use Magpie's normal
plugin sign-in flow. A pre-existing native sign-in can be reused.

The native plugin can update OpenCode configuration. For this pinned
installation, disable its automatic updater in
`~/.config/opencode/antigravity.json` by merging `"auto_update": false` into
the existing file. Do not overwrite other preferences. The native plugin
also manages its own OpenCode slash commands and account/project refresh.
Do not delete either checkout while its absolute path is configured.

Restart Magpie after changing the adapter or upstream build.

## Models And Quota

```sh
magpie-mirasim quota google-plugin --json
node --test plugins/antigravity/*.test.mjs
node scripts/verify-antigravity.mjs
node scripts/verify-subscriptions.mjs google-plugin/gemini-3.7-flash
```

Live verifiers consume small amounts of the signed-in subscription. They
default to the local gateway at `http://127.0.0.1:3425`; override with
`MAGPIE_VERIFY_URL`. They do not change an agent's model or login.

Public IDs omit the `antigravity-` prefix so matching models can enter
Magpie groups. Native API IDs retain that prefix. Only the native catalog
is exposed, not unrelated Google AI Studio or Vertex models from models.dev.
Models with different versions are not treated as the same model.

Quota comes directly from Google's native `retrieveUserQuotaSummary`.
Gemini and Claude/GPT five-hour and weekly pools are scoped to their models.
If that endpoint is unavailable, only actual native per-model quota readings
from `fetchAvailableModels` are used. The adapter does not use the upstream
helper's synthesized weekly windows or invented reset dates. Missing data
remains an error; unknown pool/period readings are informational and cannot
block every model. Percentages from separate subscriptions are not added.

The integration tests cover authentication renewal, project persistence,
missing quota, invalid fractions, unknown scopes and credential-safe errors.
The live verifier checks Responses, Anthropic messages, streaming, a tool
roundtrip with an unpredictable result, and rejection of an invalid model.

## Rollback

Disable this adapter and re-enable the retained original plugin entry, then
restart Magpie. Credentials and the original app are retained. The original
plugin may no longer work with current Antigravity endpoints; retaining it
is a rollback mechanism, not a claim of current compatibility.
