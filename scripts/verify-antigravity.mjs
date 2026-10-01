import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

const base = process.env.MAGPIE_VERIFY_URL || "http://127.0.0.1:3425"
const headers = { Authorization: "Bearer magpie", "Content-Type": "application/json", "User-Agent": "magpie-antigravity-verifier" }
async function request(path, body) {
  const response = await fetch(base + path, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) })
  const data = await response.json()
  assert.equal(response.status, 200, `Gateway returned HTTP ${response.status}`)
  return data
}
const model = "google-plugin/gemini-3.7-flash"
const chat = { model, reasoning_effort: "low", max_tokens: 512 }
const responses = await request("/v1/responses", { model, input: "Reply exactly OK. Do not use tools.", reasoning: { effort: "low" } })
assert(responses.output.some((item) => item.content?.some((part) => part.text?.trim() === "OK")))
console.log("PASS Antigravity OpenAI Responses translation")

const anthropic = await request("/v1/messages", {
  model: "google-plugin/claude-sonnet-4-6", max_tokens: 128,
  messages: [{ role: "user", content: "Reply exactly OK. Do not use tools." }],
})
assert(anthropic.content.some((part) => part.text?.trim() === "OK"))
console.log("PASS Antigravity Anthropic translation")

const tools = [{ type: "function", function: {
  name: "lookup_marker", description: "Returns the required marker. Call before answering.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
} }]
const messages = [{ role: "user", content: "Call lookup_marker. Then reply with ONLY the exact marker it returns. You cannot know it without calling the tool." }]
const first = await request("/v1/chat/completions", { ...chat, messages, tools, tool_choice: "required" })
const assistant = first.choices[0].message
assert.equal(assistant.tool_calls?.length, 1)
assert.equal(assistant.tool_calls[0].function.name, "lookup_marker")
const marker = "NATIVE_" + randomUUID()
const second = await request("/v1/chat/completions", {
  ...chat, tools, messages: [...messages, assistant, { role: "tool", tool_call_id: assistant.tool_calls[0].id, content: marker }],
})
assert.equal(second.choices[0].message.content.trim(), marker)
console.log("PASS Antigravity caller tool roundtrip with unpredictable result")

const stream = await fetch(base + "/v1/chat/completions", {
  method: "POST", headers,
  body: JSON.stringify({ ...chat, stream: true, messages: [{ role: "user", content: "Reply exactly OK. Do not use tools." }] }),
  signal: AbortSignal.timeout(90000),
})
assert.equal(stream.status, 200)
const events = await stream.text()
assert(events.includes("[DONE]"))
const text = events.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || "").join("")
assert.equal(text.trim(), "OK")
console.log("PASS Antigravity streaming SSE")

const unknown = await fetch(base + "/v1/chat/completions", {
  method: "POST", headers,
  body: JSON.stringify({ ...chat, model: "google-plugin/not-a-model", messages: [{ role: "user", content: "Reply exactly OK" }] }),
  signal: AbortSignal.timeout(90000),
})
assert(unknown.status >= 400, "unknown Antigravity model was silently accepted")
console.log("PASS invalid Antigravity model rejected", unknown.status)
