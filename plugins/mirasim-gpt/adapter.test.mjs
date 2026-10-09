import assert from "node:assert/strict"
import test from "node:test"
import { adapt } from "./adapter.mjs"

const model = (id, npm = "@ai-sdk/openai") => ({ id, providerID: "mirasim", api: { id, npm }, variants: { high: {} } })

async function fixture(overrides = {}) {
  const writes = []
  let nativeClient
  const hooks = await adapt({ client: { auth: { async set(v) { writes.push(v) } } } }, async ({ client }) => {
    nativeClient = client
    return {
      auth: {
        provider: "mirasim", loader: async () => ({ marker: "native transport" }),
        methods: [{ authorize: async () => ({ method: "code", callback: async () => ({ type: "success", provider: "mirasim", access: "FAKE" }) }) }],
        usage: async () => ({ plan: "Test", windows: [{ name: "7 days", used: 12 }, { name: "Claude 7 days", used: 100 }, { name: "Fable 7 days", used: 100 }] }),
        ...overrides.auth,
      },
      config: async (c) => { c.provider.mirasim = { name: "Mirasim", models: { "gpt-6-astra": model("gpt-6-astra") } } },
      provider: { models: async (p) => p.models },
    }
  })
  return { hooks, writes, client: nativeClient }
}

test("config leaves native bridge and other providers untouched", async () => {
  const { hooks } = await fixture()
  const config = { provider: { mirasim: { name: "Native CLI", models: { keep: true } }, cohub: { keep: true } } }
  const before = structuredClone(config)
  await hooks.config(config)
  assert.deepEqual(config.provider.mirasim, before.provider.mirasim)
  assert.deepEqual(config.provider.cohub, before.provider.cohub)
  assert.equal(config.provider["mirasim-gpt"].models["gpt-6-astra"].providerID, "mirasim-gpt")
  assert.equal(config.provider["mirasim-gpt"].npm, "@ai-sdk/openai")
})

test("model hook only exposes GPT on Responses, retaining exact ids and effort", async () => {
  const { hooks } = await fixture()
  const models = await hooks.provider.models({ models: {
    "gpt-6.1-sol": model("gpt-6.1-sol"),
    "claude-opus-5-5": model("claude-opus-5-5", "@ai-sdk/anthropic"),
    "gpt-unknown": model("gpt-unknown", "@ai-sdk/anthropic"),
  } })
  assert.deepEqual(Object.keys(models), ["gpt-6.1-sol"])
  assert.equal(models["gpt-6.1-sol"].api.id, "gpt-6.1-sol")
  assert.deepEqual(models["gpt-6.1-sol"].variants, { high: {} })
})

test("OAuth callback saves under the separate identity; renewals do too", async () => {
  const { hooks, client, writes } = await fixture()
  assert.equal(hooks.auth.provider, "mirasim-gpt")
  const pending = await hooks.auth.methods[0].authorize({})
  assert.equal((await pending.callback("code")).provider, "mirasim-gpt")
  await client.auth.set({ path: { id: "mirasim" }, body: { access: "FAKE_RENEWED" } })
  assert.equal(writes[0].path.id, "mirasim-gpt")
  assert.deepEqual(await hooks.auth.loader(), { marker: "native transport" })
})

test("failed login is not converted to a success", async () => {
  const { hooks } = await fixture({ auth: { methods: [{ authorize: async () => ({ callback: async () => ({ type: "failed", error: "refused" }) }) }] } })
  assert.deepEqual(await (await hooks.auth.methods[0].authorize({})).callback(), { type: "failed", error: "refused" })
})

test("Claude-specific quota cannot block GPT, global readings are preserved", async () => {
  const { hooks } = await fixture()
  const usage = await hooks.auth.usage(() => null)
  assert.equal(usage.windows[0].used, 12)
  assert.equal(usage.windows[0].aside, undefined)
  assert.equal(usage.windows[1].aside, true)
  assert.equal(usage.windows[2].aside, true)
})

test("missing quota remains an error, never fabricated headroom", async () => {
  const { hooks } = await fixture({ auth: { usage: async () => ({ error: "temporarily unavailable", signIn: "kept" }) } })
  const usage = await hooks.auth.usage(() => null)
  assert.equal(usage.error, "temporarily unavailable")
  assert.equal(usage.windows, undefined)
})
