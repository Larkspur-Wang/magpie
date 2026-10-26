import assert from "node:assert/strict"
import test from "node:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import antigravity from "./index.mjs"

async function fixture(t, summary, available = {}, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "magpie-antigravity-test-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const files = {
    "index.js": "export const AntigravityCLIOAuthPlugin = async () => ({ auth: { provider: 'google', loader: async () => ({ native: true }) } })",
    "src/plugin/config/models.js": `export const OPENCODE_MODEL_DEFINITIONS = ${JSON.stringify({
      "antigravity-gemini-3.7-flash": { name: "Gemini", variants: { low: {} } },
      "antigravity-claude-sonnet-4-6": { name: "Claude" },
    })}`,
    "src/plugin/quota.js": `export const fetchQuotaSummary = async () => (${JSON.stringify(summary)}); export const fetchAvailableModels = async () => (${JSON.stringify(available)})`,
    "src/plugin/token.js": "export const refreshAccessToken = async () => { throw new Error('unexpected renewal') }",
    "src/plugin/auth.js": "export const accessTokenExpired = () => false",
    "src/plugin/project.js": "export const ensureProjectContext = async auth => ({ auth, effectiveProjectId: 'fake-project' })",
    ...options.modules,
  }
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, "dist", file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }
  const client = options.client ?? { auth: { set() { throw new Error("unexpected authentication change") } } }
  const hooks = await antigravity({ client }, { upstream: root })
  return hooks
}

test("models keep public grouping IDs and explicit Antigravity native API IDs", async (t) => {
  const hooks = await fixture(t, {})
  const config = { provider: { google: { options: { preserved: true } }, other: { name: "Unchanged" } } }
  await hooks.config(config)
  assert.equal(config.provider.google.name, "Antigravity")
  assert.equal(config.provider.google.npm, "@ai-sdk/google")
  assert.equal(config.provider.google.options.preserved, true)
  assert.equal(config.provider.other.name, "Unchanged")
  assert.equal(config.provider.google.models["gemini-3.7-flash"].id, "antigravity-gemini-3.7-flash")
  assert.equal(config.provider.google.models["gemini-3.7-flash"].reasoning, true)
  assert.equal(config.provider.google.models["claude-sonnet-4-6"].reasoning, false)
  assert.deepEqual(Object.keys(await hooks.provider.models({ models: { ...config.provider.google.models, unrelated: {} } })), ["gemini-3.7-flash", "claude-sonnet-4-6"])
  assert.deepEqual(await hooks.auth.loader(), { native: true })
})

test("native summary enters the Magpie usage hook without exposing authentication", async (t) => {
  const hooks = await fixture(t, { groups: [{ displayName: "Gemini Models", buckets: [
    { window: "5h", remainingFraction: 0.2, resetTime: "2026-10-02T00:00:00Z" },
  ] }] })
  const usage = await hooks.auth.usage(async () => ({ type: "oauth", access: "FAKE_SECRET" }))
  assert.equal(usage.windows[0].used, 80)
  assert.equal(usage.windows[0].span, 18000)
  assert.equal(usage.windows[0].aside, false)
  assert.deepEqual(usage.windows[0].models, ["gemini-3.7-flash"])
  assert(!JSON.stringify(usage).includes("FAKE_SECRET"))
})

test("empty native summary falls back only to actual model quota readings", async (t) => {
  const hooks = await fixture(t, {}, { models: { "gemini-3.7-flash-low": { quotaInfo: { remainingFraction: 0.4 } } } })
  const usage = await hooks.auth.usage(async () => ({ type: "oauth" }))
  assert.equal(usage.windows.length, 1)
  assert.equal(usage.windows[0].used, 60)
  assert.equal(usage.windows[0].span, undefined)
  assert.equal(usage.windows[0].resetsAt, undefined)
})

test("missing quota and signed-out accounts cannot be reported as healthy full quota", async (t) => {
  const hooks = await fixture(t, {})
  const missing = await hooks.auth.usage(async () => ({ type: "oauth" }))
  assert.deepEqual(missing.windows, [])
  assert(missing.error)
  const signedOut = await hooks.auth.usage(async () => null)
  assert.deepEqual(signedOut.windows, [])
  assert.equal(signedOut.signIn, "expired")
})

test("expired native auth is renewed and updated project context is persisted through the native client", async (t) => {
  const writes = []
  const hooks = await fixture(t, { groups: [{ displayName: "Gemini Models", buckets: [
    { window: "5h", remainingFraction: 0.5 },
  ] }] }, {}, {
    client: { auth: { async set(value) { writes.push(value) } } },
    modules: {
      "src/plugin/auth.js": "export const accessTokenExpired = () => true",
      "src/plugin/token.js": "export const refreshAccessToken = async () => ({ type: 'oauth', access: 'FAKE_RENEWED', refresh: 'FAKE_REFRESH' })",
      "src/plugin/project.js": "export const ensureProjectContext = async auth => ({ auth: { ...auth, refresh: auth.refresh + '|fake-project' }, effectiveProjectId: 'fake-project' })",
      "src/plugin/quota.js": "export const fetchQuotaSummary = async (access, project) => { if (access !== 'FAKE_RENEWED' || project !== 'fake-project') throw new Error('stale auth'); return { groups: [{ displayName: 'Gemini Models', buckets: [{ window: '5h', remainingFraction: 0.5 }] }] } }; export const fetchAvailableModels = async () => ({})",
    },
  })
  const usage = await hooks.auth.usage(async () => ({ type: "oauth", access: "FAKE_EXPIRED" }))
  assert.equal(usage.windows[0].used, 50)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].path.id, "google")
  assert.equal(writes[0].body.refresh, "FAKE_REFRESH|fake-project")
  assert(!JSON.stringify(usage).includes("FAKE_"))
})

test("native renewal failure cannot be reported as usable quota", async (t) => {
  const hooks = await fixture(t, {}, {}, { modules: {
    "src/plugin/auth.js": "export const accessTokenExpired = () => true",
    "src/plugin/token.js": "export const refreshAccessToken = async () => null",
  } })
  const usage = await hooks.auth.usage(async () => ({ type: "oauth" }))
  assert.deepEqual(usage.windows, [])
  assert.equal(usage.signIn, "expired")
  assert(usage.error)
})
