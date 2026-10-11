import { MirasimAuthPlugin, _internal } from "opencode-mirasim-auth"
import { adapt } from "./adapter.mjs"

export default async function mirasimGPT(input) {
  return adapt(input, MirasimAuthPlugin, accountModels)
}

// This catalog was verified and saved by the upstream plugin at sign-in or
// refresh. Seed only this account's list; never invent models while offline.
function accountModels(auth) {
  if (auth?.type !== "oauth" || !auth.access || !auth.deviceKey || !auth.models) return {}
  let models, roster
  try {
    models = _internal.parseModels(auth.models)
    roster = auth.roster ? _internal.parseRoster(JSON.parse(auth.roster)) : null
  } catch { return {} }
  if (roster) models = _internal.withoutWithdrawn(models, roster)
  return Object.fromEntries(models.filter((model) => model.id.startsWith("gpt-")).map((model) => {
    const spec = roster ? _internal.specOf(roster, model.id) : null
    const efforts = (spec?.effort ?? []).filter((effort) => _internal.effortSupported("codex", effort))
    return [model.id, {
      id: model.id, name: spec?.label || model.id, providerID: "mirasim-gpt",
      api: { id: model.id, npm: "@ai-sdk/openai" },
      limit: { context: Math.max(Number(model.max_input_tokens || 0), Number(spec?.contextWindow || 0)), output: Number(spec?.maxOutput || 0) },
      capabilities: { toolcall: true, reasoning: efforts.length > 0, input: { text: true }, output: { text: true } },
      variants: Object.fromEntries(efforts.map((effort) => [effort, { reasoningEffort: effort }])),
    }]
  }))
}
