import assert from "node:assert/strict"
import test from "node:test"
import adapter from "./index.mjs"
import { _internal } from "opencode-mirasim-auth"

test("real pinned plugin signs Responses, keeps tools, renews only its own login", async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const calls = []
  const writes = []
  let auth = { type: "oauth", access: "FAKE_EXPIRED", refresh: "FAKE_REFRESH", expires: 1, deviceKey: _internal.newDeviceKey() }
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url)
    assert(["auth.mirasim.ai", "relay.mirasim.ai"].includes(u.hostname))
    const headers = new Headers(init.headers)
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ path: u.pathname, headers, body })
    switch (u.pathname) {
      case "/auth/refresh": return Response.json({ access_token: "FAKE_NEW", refresh_token: "FAKE_NEXT", expires_in: 7200 })
      case "/v1/device/session":
        assert(headers.get("x-mirasim-sig"))
        return Response.json({ ticket: "FAKE_TICKET", expiresIn: 3600 })
      case "/v1/models": return Response.json({ data: [{ id: "gpt-6.1-sol" }, { id: "gpt-6-astra" }, { id: "claude-opus-5-5" }] })
      case "/v1/model-roster": return new Response("not available", { status: 404 })
      case "/v1/responses": return Response.json({ id: "resp_fake", object: "response", status: "completed", output: [] })
      default: throw new Error("unexpected endpoint: " + u.pathname)
    }
  }
  const hooks = await adapter({ client: { auth: { async set(value) { writes.push(value); auth = value.body } } } })
  const models = await hooks.provider.models({ models: {} }, { auth })
  assert.deepEqual(Object.keys(models), ["gpt-6.1-sol", "gpt-6-astra"])
  assert(writes.length >= 2)
  assert(writes.every((w) => w.path.id === "mirasim-gpt"))
  assert.equal(calls.filter((c) => c.path === "/auth/refresh").length, 1)
  const loader = await hooks.auth.loader(async () => auth)
  const tools = [{ type: "function", name: "lookup_marker", parameters: { type: "object", properties: {} } }]
  const res = await loader.fetch("https://relay.mirasim.ai/v1/responses", {
    method: "POST", headers: { Authorization: "Bearer WRONG", "x-api-key": "WRONG", "x-mirasim-session": "INJECTED" },
    body: JSON.stringify({ model: "gpt-6.1-sol", input: "Hello", reasoning: { effort: "high" }, tools }),
  })
  assert.equal(res.status, 200)
  const request = calls.at(-1)
  assert.equal(request.path, "/v1/responses")
  assert.equal(request.body.model, "gpt-6.1-sol")
  assert.deepEqual(request.body.input, [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }])
  assert.deepEqual(request.body.tools, tools)
  assert.equal(request.headers.get("authorization"), "Bearer FAKE_TICKET")
  assert.equal(request.headers.get("x-api-key"), null)
  assert.equal(request.headers.get("x-mirasim-session"), null)
  assert(request.headers.get("x-mirasim-enc"))
})

test("unsigned account cannot generate or fabricate a model catalog", async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async () => { throw new Error("unexpected network before sign-in") }
  const hooks = await adapter({ client: { auth: { set() { throw new Error("unexpected write") } } } })
  assert.deepEqual(await hooks.auth.loader(async () => null), {})
  assert.deepEqual(await hooks.provider.models({ models: {} }, { auth: null }), {})
  const usage = await hooks.auth.usage(async () => null)
  assert(usage.error.includes("not signed in"))
})

test("cold start retains the account's verified GPT catalog during a network failure", async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async () => { throw new Error("offline during startup") }
  const auth = {
    type: "oauth", access: "FAKE_VALID", expires: Date.now() + 7200000,
    deviceKey: _internal.newDeviceKey(),
    models: JSON.stringify({ data: [{ id: "gpt-6-astra", max_input_tokens: 872000 }, { id: "claude-opus-5-5" }] }),
  }
  const hooks = await adapter({ client: { auth: { set() { throw new Error("unexpected write") } } } })
  const models = await hooks.provider.models({ models: {} }, { auth })
  assert.deepEqual(Object.keys(models), ["gpt-6-astra"])
  assert.equal(models["gpt-6-astra"].api.npm, "@ai-sdk/openai")
  assert.equal(models["gpt-6-astra"].limit.context, 872000)
  assert.equal((await hooks.provider.models({ models: {} }, { auth: null }))["gpt-6-astra"], undefined)
})
