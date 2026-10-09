// Real requests consume Mirasim quota. Run direct providers before group edits.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

const base = process.env.MAGPIE_VERIFY_URL || "http://127.0.0.1:3425"
const models = process.argv.slice(2)
if (!models.length) models.push("mirasim-gpt/gpt-6-astra", "mirasim-gpt/gpt-6.1-sol")
const headers = { Authorization: "Bearer magpie", "Content-Type": "application/json", "User-Agent": "magpie-mirasim-gpt-verifier" }
async function call(body) {
  const response = await fetch(base + "/v1/responses", {
    method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(`HTTP ${response.status} (${data.error?.type || "upstream error"}); inspect the local route record`)
  return data
}
const textOf = (data) => (data.output || []).flatMap((o) => o.content || []).map((c) => c.text || "").join("").trim()
for (const model of models) {
  const start = Date.now()
  const common = { model, reasoning: { effort: "high" }, max_output_tokens: 1024 }
  const reply = await call({ ...common, input: "Reply exactly OK. Do not use tools." })
  assert.equal(textOf(reply), "OK")
  assert(reply.usage?.input_tokens > 0)
  console.log(JSON.stringify({ check: "Responses generation", requested: model, served: reply.model, ms: Date.now() - start, result: "PASS" }))

  const input = [{ role: "user", content: "Call lookup_marker. Then reply with only the exact marker the tool returns." }]
  const tools = [{ type: "function", name: "lookup_marker", description: "Read the unpredictable marker.", parameters: { type: "object", properties: {}, additionalProperties: false } }]
  const first = await call({ ...common, input, tools, tool_choice: "required" })
  const tool = first.output.find((item) => item.type === "function_call")
  assert.equal(tool?.name, "lookup_marker")
  const marker = "MIRASIM_GPT_" + randomUUID()
  const second = await call({ ...common, tools, input: [...input, ...first.output, { type: "function_call_output", call_id: tool.call_id, output: marker }] })
  assert.equal(textOf(second), marker)
  console.log(JSON.stringify({ check: "tool roundtrip", requested: model, served: second.model, result: "PASS" }))

  const stream = await fetch(base + "/v1/responses", {
    method: "POST", headers, body: JSON.stringify({ ...common, input: "Reply exactly OK. No tools.", stream: true }),
    signal: AbortSignal.timeout(120000),
  })
  assert.equal(stream.status, 200)
  const events = (await stream.text()).split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)))
  assert(events.some((e) => e.type === "response.completed"))
  assert.equal(events.filter((e) => e.type === "response.output_text.delta").map((e) => e.delta).join("").trim(), "OK")
  console.log(JSON.stringify({ check: "Responses SSE", requested: model, result: "PASS" }))
}
