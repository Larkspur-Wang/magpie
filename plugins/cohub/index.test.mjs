import assert from "node:assert/strict"
import test from "node:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import cohub, { findCLI, modelsFrom } from "./index.mjs"
import { toCohubInput, toChatCompletion, streamChunks, usage } from "./convert.mjs"

const MODELS = {
  cohub: [
    { provider: "cohub", id: "claude-opus-5-5", model: { name: "claude-opus-5-5", reasoning: true, input: ["text", "image"], contextWindow: 1000000, maxTokens: 128000, cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } } },
    { provider: "cohub", id: "glm-5.3-flash", model: { name: "glm-5.3-flash", input: ["text"], contextWindow: 1000000, maxTokens: 64000 } },
  ],
  openrouter: [{ provider: "openrouter", id: "stealth/ox-alpha", model: {} }],
}

// fakeCLI writes a cohub-cli package whose client answers from the given
// script; calls records what the plugin sent.
async function fakeCLI(t, { events, result, error, me = { email: "lark@example.com" } } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "magpie-cohub-test-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.mkdir(path.join(root, "dist"), { recursive: true })
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "@neta-art/cohub-cli", version: "9.9.9", type: "module" }))
  await fs.writeFile(path.join(root, "dist", "client.js"), `
    export const calls = globalThis.__cohubCalls = []
    const script = ${JSON.stringify({ events, result, error, me, models: MODELS })}
    const fail = () => { const e = new Error(script.error.message); e.status = script.error.status; e.name = script.error.name ?? "HttpError"; throw e }
    export function createClient() {
      return {
        models: { list: async () => script.models },
        user: { getMe: async () => { if (script.error) fail(); return script.me } },
        space(id) {
          return {
            async completion(input) { calls.push({ id, input, stream: false }); if (script.error) fail(); return script.result },
            async *streamCompletion(input) {
              calls.push({ id, input, stream: true })
              if (script.error) fail()
              for (const e of script.events) yield e
            },
          }
        },
      }
    }`)
  await fs.writeFile(path.join(root, "dist", "space.js"), "export const resolveDefaultSpace = async () => 'home-space'")
  globalThis.__cohubCalls = []
  return root
}

async function request(hooks, body) {
  const { fetch } = await hooks.auth.loader()
  return fetch("https://cohub.invalid/v1/chat/completions", { method: "POST", body: JSON.stringify(body) })
}

test("chat messages become Cohub's, model suffix and efforts mapped", () => {
  const input = toCohubInput({
    model: "claude-opus-5-5:text",
    messages: [
      { role: "developer", content: "be brief" },
      { role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAA=" } }] },
      { role: "assistant", content: "ok" },
      { role: "user", content: "and this", name: "x" },
    ],
    max_completion_tokens: 50,
    temperature: 0.2,
    reasoning_effort: "none",
  })
  assert.deepEqual(input, {
    model: "claude-opus-5-5",
    messages: [
      { role: "system", content: [{ type: "text", text: "be brief" }] },
      { role: "user", content: [{ type: "text", text: "look" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA=" } }] },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
      { role: "user", content: [{ type: "text", text: "and this" }] },
    ],
    temperature: 0.2,
    maxTokens: 50,
    thinkingLevel: "off",
  })
})

test("a request that needs tools is refused, one that turns them off is not", () => {
  const tools = [{ type: "function", function: { name: "read", parameters: {} } }]
  assert.throws(() => toCohubInput({ model: "m", tools, messages: [{ role: "user", content: "hi" }] }), { status: 400, message: /no tool calling/ })
  assert.throws(() => toCohubInput({ model: "m", messages: [{ role: "tool", content: "x", tool_call_id: "1" }] }), { status: 400 })
  assert.equal(toCohubInput({ model: "m", tools, tool_choice: "none", messages: [{ role: "user", content: "hi" }] }).messages.length, 1)
})

test("usage counts cached tokens into the prompt", () => {
  assert.deepEqual(usage({ input: 10, output: 5, cacheRead: 100, cacheWrite: 2, cost: { total: 0.5 } }), {
    prompt_tokens: 112, completion_tokens: 5, total_tokens: 117, prompt_tokens_details: { cached_tokens: 100 }, cost: 0.5,
  })
})

test("a finished completion is one chat completion; an errored one fails", () => {
  const out = toChatCompletion({
    completionId: "c1",
    message: { role: "assistant", content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: "OK" }], stopReason: "length" },
    usage: { input: 3, output: 1 },
  }, "glm-5.3-flash:text", 7)
  assert.equal(out.id, "chatcmpl-c1")
  assert.deepEqual(out.choices[0], { index: 0, message: { role: "assistant", content: "OK", reasoning_content: "hm" }, finish_reason: "length" })
  assert.equal(out.usage.total_tokens, 4)
  assert.throws(() => toChatCompletion({ completionId: "c2", message: { content: [], stopReason: "error", errorMessage: "boom" } }, "m"), { status: 502, message: "boom" })
})

test("stream events become chunks ending in usage and [DONE]", async () => {
  async function* events() {
    yield { type: "meta", completionId: "s1" }
    yield { type: "thinking_delta", text: "t" }
    yield { type: "delta", text: "O" }
    yield { type: "delta", text: "K" }
    yield { type: "done", completionId: "s1", message: { content: [], stopReason: "stop" }, usage: { input: 2, output: 2 } }
  }
  const lines = []
  for await (const l of streamChunks(events(), "m", 1)) lines.push(l)
  assert.equal(lines.at(-1), "data: [DONE]\n\n")
  const chunks = lines.slice(0, -1).map((l) => JSON.parse(l.slice(6)))
  assert.deepEqual(chunks[0].choices[0].delta, { role: "assistant", reasoning_content: "t" })
  assert.equal(chunks.map((c) => c.choices[0]?.delta?.content ?? "").join(""), "OK")
  assert.equal(chunks.at(-2).choices[0].finish_reason, "stop")
  assert.equal(chunks.at(-1).usage.total_tokens, 4)
  assert.ok(chunks.every((c) => c.id === "chatcmpl-s1"))
})

test("models keep out of same-model groups and say they have no tools", () => {
  const ms = modelsFrom(MODELS)
  assert.deepEqual(Object.keys(ms), ["claude-opus-5-5:text", "glm-5.3-flash:text"])
  const opus = ms["claude-opus-5-5:text"]
  assert.equal(opus.api.id, "claude-opus-5-5")
  assert.equal(opus.api.npm, "@ai-sdk/openai-compatible")
  assert.equal(opus.capabilities.toolcall, false)
  assert.equal(opus.capabilities.input.image, true)
  assert.deepEqual(opus.limit, { context: 1000000, output: 128000 })
  assert.deepEqual(opus.cost, { input: 4, output: 20, cache: { read: 0.2, write: 5 } })
})

test("findCLI takes the newest installed CLI, or the configured one", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "magpie-cohub-home-"))
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  for (const [node, v] of [["v22.0.0", "8.3.0"], ["v24.0.0", "8.10.1"], ["v25.0.0", "8.4.1"]]) {
    const dir = path.join(home, ".nvm", "versions", "node", node, "lib", "node_modules", "@neta-art", "cohub-cli")
    await fs.mkdir(path.join(dir, "dist"), { recursive: true })
    await fs.writeFile(path.join(dir, "dist", "client.js"), "")
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ version: v }))
  }
  assert.match(findCLI({}, home, {}), /v24\.0\.0/)
  assert.throws(() => findCLI({ root: path.join(home, "nope") }, home, {}), /no Cohub CLI/)
  assert.throws(() => findCLI({}, path.join(home, "empty"), {}), /npm i -g @neta-art\/cohub-cli/)
})

test("a plain request goes to the home Space and answers a chat completion", async (t) => {
  const root = await fakeCLI(t, { result: { completionId: "r1", message: { content: [{ type: "text", text: "OK" }], stopReason: "stop" }, usage: { input: 5, output: 1 } } })
  const hooks = await cohub({}, { root })
  const res = await request(hooks, { model: "glm-5.3-flash:text", messages: [{ role: "user", content: "say OK" }] })
  assert.equal(res.status, 200)
  const out = await res.json()
  assert.equal(out.choices[0].message.content, "OK")
  assert.equal(out.model, "glm-5.3-flash:text")
  assert.deepEqual(globalThis.__cohubCalls, [{ id: "home-space", stream: false, input: { model: "glm-5.3-flash", messages: [{ role: "user", content: [{ type: "text", text: "say OK" }] }] } }])
})

test("a streamed request answers SSE; a configured Space is used", async (t) => {
  const root = await fakeCLI(t, { events: [
    { type: "meta", completionId: "s9" },
    { type: "delta", text: "hi" },
    { type: "done", completionId: "s9", message: { content: [], stopReason: "stop" }, usage: { input: 1, output: 1 } },
  ] })
  const hooks = await cohub({}, { root, space: "team-space" })
  const res = await request(hooks, { model: "glm-5.3-flash:text", stream: true, messages: [{ role: "user", content: "hi" }] })
  assert.equal(res.headers.get("content-type"), "text/event-stream")
  const text = await res.text()
  assert.match(text, /"content":"hi"/)
  assert.match(text, /"total_tokens":2/)
  assert.ok(text.endsWith("data: [DONE]\n\n"))
  assert.equal(globalThis.__cohubCalls[0].id, "team-space")
})

test("tools are refused before Cohub is asked; Cohub's own errors keep their status", async (t) => {
  const root = await fakeCLI(t, { error: { status: 429, message: "rate limited" } })
  const hooks = await cohub({}, { root })
  const tools = await request(hooks, { model: "m:text", tools: [{ type: "function", function: { name: "x" } }], messages: [{ role: "user", content: "hi" }] })
  assert.equal(tools.status, 400)
  assert.match((await tools.json()).error.message, /no tool calling/)
  assert.equal(globalThis.__cohubCalls.length, 0)
  const limited = await request(hooks, { model: "m:text", stream: true, messages: [{ role: "user", content: "hi" }] })
  assert.equal(limited.status, 429)
  assert.match((await limited.json()).error.message, /rate limited/)
})

test("sign-in and usage read the CLI's account; a lapsed CLI login says so", async (t) => {
  const root = await fakeCLI(t)
  const hooks = await cohub({}, { root })
  const flow = await hooks.auth.methods[0].authorize()
  assert.equal(flow.method, "auto")
  assert.deepEqual(await flow.callback(), { type: "success", key: "cohub-cli", metadata: { email: "lark@example.com" } })
  assert.deepEqual(await hooks.auth.usage(), { plan: "Cohub", user: "lark@example.com", windows: [] })

  const out = await fakeCLI(t, { error: { status: 401, message: "Not authenticated", name: "AuthRequiredError" } })
  const lapsed = await cohub({}, { root: out })
  assert.equal((await lapsed.auth.usage()).signIn, "expired")
  assert.equal((await lapsed.auth.methods[0].authorize().then((f) => f.callback())).type, "failed")
})
