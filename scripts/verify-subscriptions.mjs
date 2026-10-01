const base = process.env.MAGPIE_VERIFY_URL || "http://127.0.0.1:3425"
const cases = process.argv.slice(2)
const models = cases.length ? cases : [
  "mirasim/glm-5.3-flash", "codex/gpt-6.1-sol", "cursor/cursor-grok-4.6",
  "grok/grok-4.7", "workbuddy/deepseek-v4.1-flash", "cohub/glm-5.3-flash:text",
  "google-plugin/gemini-3.7-flash",
]
const results = []
for (const model of models) {
  const start = Date.now()
  try {
    const res = await fetch(base + "/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer magpie", "Content-Type": "application/json", "User-Agent": "magpie-subscription-verifier" },
      body: JSON.stringify({ model, reasoning_effort: "low", max_tokens: 256, messages: [
        { role: "user", content: "Reply exactly OK. Do not use tools." },
      ] }),
      signal: AbortSignal.timeout(120000),
    })
    const raw = await res.text()
    let data
    try { data = JSON.parse(raw) } catch { data = { error: { message: "Non-JSON gateway reply" } } }
    const answer = data.choices?.[0]?.message?.content?.trim()
    const error = data.error?.message
    const safeError = typeof error === "string" && !/(Bearer\s|ya29\.|refresh_token|access_token|sk-[A-Za-z0-9])/i.test(error)
      ? error.slice(0, 600) : error ? "Upstream diagnostic redacted" : undefined
    const result = {
      requested: model, status: res.status, served: data.model, answer,
      usage: data.usage, error: safeError, milliseconds: Date.now() - start,
      result: res.status === 200 && answer === "OK" && data.usage?.total_tokens > 0 ? "PASS" : "FAIL",
    }
    results.push(result)
    console.log(JSON.stringify(result))
  } catch (error) {
    const result = { requested: model, result: "FAIL", error: error.name, milliseconds: Date.now() - start }
    results.push(result)
    console.log(JSON.stringify(result))
  }
}
console.log(JSON.stringify({ passed: results.filter((r) => r.result === "PASS").length, total: results.length }))
process.exitCode = results.some((r) => r.result !== "PASS") ? 1 : 0
