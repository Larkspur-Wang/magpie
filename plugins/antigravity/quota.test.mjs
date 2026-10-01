import assert from "node:assert/strict"
import test from "node:test"
import { modelBase, modelWindows, quotaError, summaryWindows } from "./quota.mjs"

const known = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.1-pro", "claude-opus-4-6-thinking", "gpt-oss-120b-medium"]
const reset = "2026-10-02T00:00:00Z"

test("native windows keep actual percentages, scopes and reset times", () => {
  const windows = summaryWindows({ groups: [{ displayName: "Claude and GPT", buckets: [
    { window: "5h", remainingFraction: 0.27, resetTime: reset },
    { window: "weekly", remainingFraction: 0.75, resetTime: reset },
  ] }] }, known)
  assert.deepEqual(windows.map((w) => [w.used, w.span, w.aside]), [[73, 18000, false], [25, 604800, false]])
  assert.deepEqual(windows[0].models, [known[3], known[4]])
  assert.equal(windows[0].resetsAt, "2026-10-02T00:00:00.000Z")
})

test("unknown pools and unknown periods cannot block the whole account", () => {
  assert.equal(summaryWindows({ groups: [{ displayName: "Unknown", buckets: [{ window: "5h", remainingFraction: 0 }] }] }, known)[0].aside, true)
  assert.equal(summaryWindows({ groups: [{ displayName: "Gemini", buckets: [{ window: "unknown", remainingFraction: 0 }] }] }, known)[0].aside, true)
})

test("missing or invalid readings are not invented as zero quota", () => {
  for (const remainingFraction of [undefined, null, "0.5", NaN, Infinity, -0.1, 1.1]) {
    assert.deepEqual(summaryWindows({ groups: [{ displayName: "Gemini", buckets: [{ window: "5h", remainingFraction }] }] }, known), [])
  }
  assert.deepEqual(modelWindows({ models: { "gemini-3.7-flash": { quotaInfo: { remainingFraction: 0.5, resetTime: "bad" } } } }, known), [])
})

test("model fallback does not fabricate weekly or five-hour windows", () => {
  const windows = modelWindows({ models: { "gemini-3.7-flash-high": {
    displayName: "Gemini 3.7 Flash High", quotaInfo: { remainingFraction: 0.6, resetTime: reset },
  } } }, known)
  assert.equal(windows.length, 1)
  assert.equal(windows[0].used, 40)
  assert.deepEqual(windows[0].models, ["gemini-3.7-flash"])
  assert.equal(windows[0].span, undefined)
  assert.equal(modelBase("antigravity-gpt-oss-120b-medium", known), "gpt-oss-120b-medium")
})

test("an unknown model's quota cannot block unrelated models", () => {
  const windows = modelWindows({ models: { "not-exposed": { quotaInfo: { remainingFraction: 0 } } } }, known)
  assert.equal(windows[0].aside, true)
  assert.deepEqual(windows[0].models, [])
})

test("quota diagnostics never include raw credential-bearing errors", () => {
  const result = quotaError({ message: "refresh_token=SECRET", status: 403 })
  assert(!JSON.stringify(result).includes("SECRET"))
  assert.equal(result.signIn, "kept")
  assert.equal(quotaError({ code: "invalid_grant" }).signIn, "expired")
})
