// OpenAI chat completions, as Magpie's gateway speaks to a plugin model on
// @ai-sdk/openai-compatible, to and from Cohub's raw space completions.
// Cohub's endpoint takes text, thinking and images, and drops tool
// definitions without saying so: a request that needs tools is refused here
// instead, so an agent never runs on a model that can't see its tools.

// MODEL_SUFFIX keeps Cohub's models out of Magpie's automatic same-model
// groups (sameModel holds a ":variant" apart), which agents route through.
export const MODEL_SUFFIX = ":text"

export class RequestError extends Error {
  constructor(status, message, type = "invalid_request_error") {
    super(message)
    this.status = status
    this.type = type
  }
}

const EFFORTS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"])

export function cohubModelId(id) {
  return typeof id === "string" && id.endsWith(MODEL_SUFFIX) ? id.slice(0, -MODEL_SUFFIX.length) : id
}

function thinkingLevel(body) {
  const v = body.reasoning_effort ?? body.reasoning?.effort
  if (typeof v !== "string") return undefined
  const e = v === "none" ? "off" : v
  return EFFORTS.has(e) ? e : undefined
}

function imageBlock(url) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url)
  if (m) return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } }
  return { type: "image", source: { type: "url", url } }
}

function blocks(content) {
  if (content == null) return []
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : []
  if (!Array.isArray(content)) return []
  const out = []
  for (const part of content) {
    if (part?.type === "text" && typeof part.text === "string") out.push({ type: "text", text: part.text })
    else if (part?.type === "image_url") {
      const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url
      if (url) out.push(imageBlock(url))
    }
  }
  return out
}

const NO_TOOLS = "Cohub's completion API has no tool calling: use this model for plain chat, not as an agent's model"

function needsTools(body) {
  return Array.isArray(body.tools) && body.tools.length > 0 && body.tool_choice !== "none"
}

// toCohubInput turns a chat completions body into Cohub's completion input.
export function toCohubInput(body) {
  if (!body || typeof body !== "object") throw new RequestError(400, "request body must be JSON")
  if (needsTools(body)) throw new RequestError(400, NO_TOOLS)
  const messages = []
  for (const m of Array.isArray(body.messages) ? body.messages : []) {
    const role = m?.role === "developer" ? "system" : m?.role
    if (role === "tool" || role === "function" || m?.tool_calls?.length || m?.function_call) {
      throw new RequestError(400, NO_TOOLS)
    }
    if (role !== "system" && role !== "user" && role !== "assistant") continue
    const content = blocks(m.content)
    if (content.length) messages.push({ role, content })
  }
  if (!messages.length) throw new RequestError(400, "messages must hold at least one text or image message")
  const maxTokens = body.max_completion_tokens ?? body.max_tokens
  return {
    model: cohubModelId(body.model),
    messages,
    ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
    ...(typeof maxTokens === "number" && maxTokens > 0 ? { maxTokens } : {}),
    ...(thinkingLevel(body) ? { thinkingLevel: thinkingLevel(body) } : {}),
  }
}

// usage is Cohub's usage as chat completions reports it: prompt tokens
// count the cached ones, which Cohub keeps apart from input.
export function usage(u) {
  if (!u) return undefined
  const input = u.input ?? 0
  const cacheRead = u.cacheRead ?? 0
  const cacheWrite = u.cacheWrite ?? 0
  const prompt = input + cacheRead + cacheWrite
  const completion = u.output ?? 0
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    prompt_tokens_details: { cached_tokens: cacheRead },
    ...(u.cost?.total != null ? { cost: u.cost.total } : {}),
  }
}

function finish(stopReason) {
  return stopReason === "length" ? "length" : "stop"
}

function textOf(message, type) {
  return (message?.content ?? [])
    .filter((b) => b.type === type)
    .map((b) => (type === "thinking" ? b.thinking : b.text))
    .join("")
}

// toChatCompletion is a finished Cohub completion as one chat completion.
export function toChatCompletion(result, model, created = Math.floor(Date.now() / 1000)) {
  if (result.message?.stopReason === "error") {
    throw new RequestError(502, result.message.errorMessage || "Cohub completion failed", "upstream_error")
  }
  const reasoning = textOf(result.message, "thinking")
  return {
    id: `chatcmpl-${result.completionId}`,
    object: "chat.completion",
    created,
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: textOf(result.message, "text"), ...(reasoning ? { reasoning_content: reasoning } : {}) },
      finish_reason: finish(result.message?.stopReason),
    }],
    usage: usage(result.usage),
  }
}

// streamChunks turns Cohub's stream events into chat completion chunks'
// SSE lines, ending with a usage chunk and [DONE].
export async function* streamChunks(events, model, created = Math.floor(Date.now() / 1000)) {
  let id = "chatcmpl-cohub"
  let role = false
  let last
  const chunk = (delta, finishReason = null, extra = {}) =>
    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finishReason }], ...extra })}\n\n`
  const open = (delta) => {
    if (role) return delta
    role = true
    return { role: "assistant", ...delta }
  }
  for await (const e of events) {
    if (e.type === "meta") id = `chatcmpl-${e.completionId}`
    else if (e.type === "delta" && e.text) yield chunk(open({ content: e.text }))
    else if (e.type === "thinking_delta" && e.text) yield chunk(open({ reasoning_content: e.text }))
    else if (e.type === "usage") last = e.usage
    else if (e.type === "done") {
      if (e.message?.stopReason === "error") throw new RequestError(502, e.message.errorMessage || "Cohub completion failed", "upstream_error")
      yield chunk(open({}), finish(e.message?.stopReason))
      const u = usage(e.usage ?? last)
      if (u) yield `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [], usage: u })}\n\n`
      yield "data: [DONE]\n\n"
      return
    }
  }
  yield chunk(open({}), "stop")
  yield "data: [DONE]\n\n"
}
