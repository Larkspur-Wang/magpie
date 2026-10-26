// Live capability investigation: bypasses this fork's text-only adapter.
// It uses the installed CLI's own client and login; no credentials are logged.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { findCLI } from "../plugins/cohub/index.mjs"

const root = findCLI()
const { createClient } = await import(pathToFileURL(path.join(root, "dist/client.js")))
const { resolveHomeSpace } = await import(pathToFileURL(path.join(root, "dist/space.js")))
const client = createClient()
const space = client.space(await resolveHomeSpace())
const catalog = await client.models.list()
const model = process.argv[2] || "claude-opus-5-5"
assert(catalog.cohub?.some((m) => m.id === model), "model absent from current Cohub catalog")
const marker = "TOOL_ONLY_" + randomUUID()
const name = "read_private_marker"
const schema = { type: "object", properties: {}, additionalProperties: false }
const message = [{ role: "user", content: "Use the provided read_private_marker tool to obtain a secret marker. You cannot know it without the tool. Do not invent a marker or merely write a tool call as text. If no callable tool was provided, reply exactly NO_TOOL." }]
const common = { provider: "cohub", model, thinkingLevel: "low", maxTokens: 1024, messages: message }
const candidates = [
  { label: "OpenAI tools + tool_choice", input: { ...common, tools: [{ type: "function", function: { name, description: "Read the secret marker.", parameters: schema } }], tool_choice: { type: "function", function: { name } } } },
  { label: "Anthropic tools + tool_choice", input: { ...common, tools: [{ name, description: "Read the secret marker.", input_schema: schema }], tool_choice: { type: "tool", name } } },
  { label: "Pi tools + toolChoice", input: { ...common, tools: [{ name, description: "Read the secret marker.", parameters: schema }], toolChoice: "required" } },
]
function callsOf(result) {
  return [
    ...(result.message?.content || []).filter((c) => ["tool_use", "toolCall", "function_call"].includes(c.type)),
    ...(result.message?.tool_calls || []),
  ]
}
for (const test of candidates) {
  const at = Date.now()
  try {
    const result = await space.completion(test.input)
    const calls = callsOf(result)
    const text = (result.message?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("")
    console.log(JSON.stringify({ check: test.label, model: result.model, stopReason: result.message?.stopReason,
      contentTypes: result.message?.content?.map((c) => c.type), calls: calls.length, text: text.slice(0, 800),
      tokens: result.usage?.totalTokens, ms: Date.now() - at }))
    if (calls.length) {
      // A structured call is only the first half of agent compatibility.
      const call = calls[0]
      const toolID = call.id || call.call_id
      const followup = await space.completion({ ...test.input, messages: [
        ...message,
        { role: "assistant", content: result.message.content },
        { role: "user", content: [{ type: "tool_result", tool_use_id: toolID, content: [{ type: "text", text: marker }] }] },
        { role: "user", content: "Reply only with the exact marker the tool returned." },
      ] })
      const answer = (followup.message?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim()
      console.log(JSON.stringify({ check: "tool roundtrip", encoding: test.label, markerMatches: answer === marker, stopReason: followup.message?.stopReason }))
    }
  } catch (error) {
    // Do not print native errors/bodies that may contain account data.
    console.log(JSON.stringify({ check: test.label, status: error.status || null, errorType: error.name, ms: Date.now() - at }))
  }
}
const stream = space.streamCompletion({ ...candidates[1].input }, { signal: AbortSignal.timeout(60000) })
const types = new Set()
let done
try {
  for await (const event of stream) {
    types.add(event.type)
    if (event.type === "done") done = event
  }
  console.log(JSON.stringify({ check: "native SSE tool request", events: [...types], calls: done ? callsOf(done).length : 0,
    stopReason: done?.message?.stopReason, text: done?.message?.content?.filter((c) => c.type === "text").map((c) => c.text).join("").slice(0, 800) }))
} catch (error) {
  console.log(JSON.stringify({ check: "native SSE tool request", status: error.status || null, errorType: error.name }))
}
