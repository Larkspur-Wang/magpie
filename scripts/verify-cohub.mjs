// Live check of the Cohub plugin through a running Magpie gateway:
//   node scripts/verify-cohub.mjs   (MAGPIE_VERIFY_URL overrides the gateway)
// Spends a few Cohub tokens on glm-5.3-flash.
import assert from "node:assert/strict";

const base = process.env.MAGPIE_VERIFY_URL || "http://127.0.0.1:3425";
const model = process.env.MAGPIE_VERIFY_COHUB_MODEL || "cohub/glm-5.3-flash:text";
async function call(path, body) {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: "Bearer magpie", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000),
  });
  return { status: res.status, text: await res.text() };
}
async function json(path, body) {
  const r = await call(path, body);
  assert.equal(r.status, 200, r.text);
  return JSON.parse(r.text);
}

const models = await json("/v1/models");
assert(models.data.some((m) => m.id === model), `${model} is not served`);
console.log("PASS Cohub models served with the :text suffix");

const ask = [{ role: "user", content: "Reply exactly OK." }];
const answer = await json("/v1/chat/completions", { model, max_tokens: 64, messages: ask });
assert.equal(answer.choices[0].message.content.trim(), "OK");
assert(answer.usage.prompt_tokens > 0 && answer.usage.completion_tokens > 0);
console.log("PASS chat completion and token usage", JSON.stringify(answer.usage));

const streamed = await call("/v1/chat/completions", { model, stream: true, stream_options: { include_usage: true }, messages: ask });
assert.equal(streamed.status, 200, streamed.text);
assert.equal([...streamed.text.matchAll(/"content":"([^"]*)"/g)].map((m) => m[1]).join("").trim(), "OK");
console.log("PASS streamed chat completion");

const anthropic = await json("/v1/messages", { model, max_tokens: 64, messages: ask });
assert(anthropic.content.some((part) => part.text?.trim() === "OK"));
console.log("PASS Anthropic Messages client through the gateway");

const tools = await call("/v1/chat/completions", {
  model, messages: ask, tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object", properties: {} } } }],
});
assert.equal(tools.status, 400, tools.text);
assert.match(tools.text, /no tool calling/);
console.log("PASS a tool-calling request is refused, not silently stripped");
