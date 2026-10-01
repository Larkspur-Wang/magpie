import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.env.MAGPIE_VERIFY_URL || "http://127.0.0.1:3426";
async function request(path, body) {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: "Bearer magpie", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000),
  });
  const data = await res.json();
  assert.equal(res.status, 200, JSON.stringify(data));
  return data;
}

const models = await request("/v1/models");
assert(models.data.some((m) => m.id === "mirasim/glm-5.3-flash"));
assert(models.data.some((m) => m.id === "mirasim/claude-opus-5-5"));
console.log("PASS native Mirasim model catalog");

const chat = {
  model: "mirasim/glm-5.3-flash", reasoning_effort: "low", max_tokens: 64,
  messages: [{ role: "user", content: "Reply exactly OK. Do not use tools." }],
};
const answer = await request("/v1/chat/completions", chat);
assert.equal(answer.choices[0].message.content.trim(), "OK");
assert(answer.usage.prompt_tokens > 0 && answer.usage.completion_tokens > 0);
console.log("PASS chat generation and token usage", JSON.stringify(answer.usage));

const responses = await request("/v1/responses", { model: chat.model, input: "Reply exactly OK. Do not use tools.", reasoning: { effort: "low" } });
assert(responses.output.some((item) => item.content?.some((part) => part.text?.trim() === "OK")));
console.log("PASS OpenAI Responses translation");

const anthropic = await request("/v1/messages", {
  model: "mirasim/claude-opus-5-5", max_tokens: 64,
  messages: [{ role: "user", content: "Reply exactly OK. Do not use tools." }],
});
assert(anthropic.content.some((part) => part.text?.trim() === "OK"));
console.log("PASS Anthropic generation through Mirasim Claude");

const tools = [{ type: "function", function: {
  name: "lookup_marker", description: "Returns the required marker. Call before answering.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
} }];
const messages = [{ role: "user", content: "Call lookup_marker. Then reply with ONLY the exact marker it returns. You cannot know it without calling the tool." }];
const first = await request("/v1/chat/completions", { ...chat, messages, tools, tool_choice: "required" });
const assistant = first.choices[0].message;
assert.equal(assistant.tool_calls?.length, 1, JSON.stringify(assistant));
assert.equal(assistant.tool_calls[0].function.name, "lookup_marker");
const marker = "BRIDGE_" + randomUUID();
const second = await request("/v1/chat/completions", {
  ...chat, tools, messages: [...messages, assistant, { role: "tool", tool_call_id: assistant.tool_calls[0].id, content: marker }],
});
assert.equal(second.choices[0].message.content.trim(), marker);
console.log("PASS caller tool -> native MCP -> tool result -> final reply");

const res = await fetch(base + "/v1/chat/completions", {
  method: "POST", headers: { Authorization: "Bearer magpie", "Content-Type": "application/json" },
  body: JSON.stringify({ ...chat, stream: true }), signal: AbortSignal.timeout(90000),
});
assert.equal(res.status, 200);
const stream = await res.text();
assert(stream.includes("[DONE]"));
assert(stream.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || "").join("").trim() === "OK");
console.log("PASS streaming SSE");

const bad = await fetch(base + "/v1/chat/completions", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...chat, model: "mirasim/not-a-model" }), signal: AbortSignal.timeout(90000),
});
assert(bad.status >= 400, "unknown model silently accepted");
console.log("PASS invalid model boundary", bad.status);
