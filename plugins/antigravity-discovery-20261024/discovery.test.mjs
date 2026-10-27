import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import antigravity from "./index.mjs"

async function fixture(t, modules = {}, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "antigravity-discovery-test-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const files = {
    "index.js": "export const AntigravityCLIOAuthPlugin = async () => ({ auth: { provider: 'google' } })",
    "src/plugin/config/models.js": "export const OPENCODE_MODEL_DEFINITIONS = {'antigravity-gemini-3.8-flash':{name:'Gemini Flash',limit:{context:1000000,output:65536},modalities:{input:['text','image','pdf'],output:['text']},variants:{high:{thinkingLevel:'high'}}}}",
    "src/plugin/config/model-discovery.js": "export const buildDiscoveredModels = ids => Object.fromEntries([...ids].filter(id=>/^gemini-4[.-]/.test(id)).map(id=>['antigravity-'+id,{name:id,limit:{context:1048576,output:65536},modalities:{input:['text','image','pdf'],output:['text']},variants:{low:{thinkingLevel:'low'},high:{thinkingLevel:'high'}}}]))",
    "src/plugin/quota.js": "export const fetchAvailableModels = async () => ({models:{'gemini-4-argon-low':{},'gemini-4-argon-high':{},'gemini-2.5-pro':{},'chat_123':{}}}); export const fetchQuotaSummary=async()=>({})",
    "src/plugin/auth.js": "export const accessTokenExpired=()=>false; export const parseRefreshParts=refresh=>({refreshToken:refresh,managedProjectId:'existing-project'})",
    "src/plugin/token.js": "export const refreshAccessToken=async()=>{throw new Error('unexpected refresh')}",
    "src/plugin/project.js": "export const ensureProjectContext=async()=>{throw new Error('must not provision a project for model discovery')}",
    ...modules,
  }
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(root, "dist", name)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, body)
  }
  const writes = []
  const hooks = await antigravity({ client: { auth: { set: async value => writes.push(value) } } }, { upstream: root, modelDiscovery: true, ...options })
  const config = {}
  await hooks.config(config)
  const provider = { id: "google", models: Object.fromEntries(Object.entries(config.provider.google.models).map(([id, model]) => [id, {
    id, providerID: "google", name: model.name,
    api: { id: model.id, npm: "@ai-sdk/google", url: "" },
    options: {}, headers: {}, cost: { input: 0, output: 0 }, limit: model.limit,
    capabilities: { temperature: true, toolcall: true, reasoning: true, input: { text: true, image: true, pdf: true }, output: { text: true } },
    variants: model.variants,
  }])) }
  return { hooks, provider, writes }
}

const auth = { type: "oauth", access: "FAKE_ACCESS", refresh: "FAKE_REFRESH", expires: 9999999999999 }

test("discovers actual Argon tiers with exact native IDs and image capabilities", async t => {
  const { hooks, provider, writes } = await fixture(t)
  const models = await hooks.provider.models(provider, { auth })
  assert.ok(models["gemini-4-argon-low"], "Argon from the account catalog was dropped")
  assert.equal(models["gemini-4-argon-low"].api.id, "antigravity-gemini-4-argon-low")
  assert.equal(models["gemini-4-argon-high"].capabilities.input.image, true)
  assert.equal(models["gemini-4-argon-low"].limit.context, 1048576)
  assert.ok(models["gemini-3.8-flash"])
  assert.equal(models["gemini-2.5-pro"], undefined)
  assert.equal(models.chat_123, undefined)
  assert.equal(writes.length, 0)
  assert.equal(JSON.stringify(models).includes("FAKE_ACCESS"), false)
})

test("does not invent Argon when the account catalog lacks it", async t => {
  const { hooks, provider } = await fixture(t, { "src/plugin/quota.js": "export const fetchAvailableModels=async()=>({models:{'gemini-3.8-flash-tiered':{}}}); export const fetchQuotaSummary=async()=>({})" })
  assert.deepEqual(Object.keys(await hooks.provider.models(provider, { auth })), ["gemini-3.8-flash"])
})

test("discovery is explicitly opt-in and signed-out listing never calls the vendor", async t => {
  const modules = { "src/plugin/quota.js": "export const fetchAvailableModels=async()=>{throw new Error('vendor must not be called')}; export const fetchQuotaSummary=async()=>({})" }
  const off = await fixture(t, modules, { modelDiscovery: false })
  assert.deepEqual(Object.keys(await off.hooks.provider.models(off.provider, { auth })), ["gemini-3.8-flash"])
  const out = await fixture(t, modules)
  assert.deepEqual(Object.keys(await out.hooks.provider.models(out.provider, {})), ["gemini-3.8-flash"])
})

test("a failed catalog read is not an authoritative empty catalog", async t => {
  const { hooks, provider } = await fixture(t, { "src/plugin/quota.js": "export const fetchAvailableModels=async()=>{throw new Error('HTTP 503')}; export const fetchQuotaSummary=async()=>({})" })
  await assert.rejects(hooks.provider.models(provider, { auth }), /catalog unavailable/)
})

test("account-specific models do not leak into another account", async t => {
  const { hooks, provider } = await fixture(t, { "src/plugin/quota.js": "export const fetchAvailableModels=async access=>({models:access==='A'?{'gemini-4-argon-low':{}}:{}}); export const fetchQuotaSummary=async()=>({})" })
  assert.ok((await hooks.provider.models(provider, { auth: { ...auth, access: "A", refresh: "A" } }))["gemini-4-argon-low"])
  assert.equal((await hooks.provider.models(provider, { auth: { ...auth, access: "B", refresh: "B" } }))["gemini-4-argon-low"], undefined)
})

test("expired auth uses the native refresher and preserves identity through normal persistence", async t => {
  const { hooks, provider, writes } = await fixture(t, {
    "src/plugin/auth.js": "export const accessTokenExpired=a=>a.access==='OLD'; export const parseRefreshParts=refresh=>({refreshToken:refresh,projectId:'existing-project'})",
    "src/plugin/token.js": "export const refreshAccessToken=async a=>({...a,access:'NEW',expires:9999999999999})",
  })
  const models = await hooks.provider.models(provider, { auth: { ...auth, access: "OLD", email: "fixture@example.invalid" } })
  assert.ok(models["gemini-4-argon-low"])
  assert.equal(writes.length, 1)
  assert.equal(writes[0].path.id, "google")
  assert.equal(writes[0].body.email, "fixture@example.invalid")
})

test("invalid Argon selector is rejected before reaching the native fetch", async t => {
  const { hooks, provider } = await fixture(t, {
    "index.js": "export const AntigravityCLIOAuthPlugin = async()=>({auth:{provider:'google',loader:async()=>({fetch:async()=>new Response('native-called')})}})",
  })
  const loaded = await hooks.auth.loader(async()=>auth, provider)
  const bad = await loaded.fetch("https://generativelanguage.googleapis.com/v1beta/models/antigravity-gemini-4-argon-invalid-qa:streamGenerateContent", {method:"POST"})
  assert.equal(bad.status, 404)
  const valid = await loaded.fetch("https://generativelanguage.googleapis.com/v1beta/models/antigravity-gemini-4-argon-high:streamGenerateContent", {method:"POST"})
  assert.equal(await valid.text(), "native-called")
})
