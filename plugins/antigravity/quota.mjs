function reading(value, resetTime) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return null
  const resetsAt = resetTime ? new Date(resetTime) : null
  if (resetsAt && Number.isNaN(resetsAt.getTime())) return null
  return {
    used: Math.round((1 - value) * 10000) / 100,
    ...(resetsAt ? { resetsAt: resetsAt.toISOString() } : {}),
  }
}

export function modelBase(id, known) {
  const plain = id.replace(/^antigravity-/, "").toLowerCase()
  return [...known].sort((a, b) => b.length - a.length).find((base) =>
    plain === base || ["minimal", "low", "medium", "high", "max"].some((effort) => plain === `${base}-${effort}`))
}

export function summaryWindows(summary, known) {
  const windows = []
  for (const group of summary?.groups ?? []) {
    const label = group.displayName || "Unknown pool"
    const lower = label.toLowerCase()
    const models = known.filter((id) =>
      lower.includes("gemini") && id.startsWith("gemini-") ||
      (lower.includes("claude") || lower.includes("gpt")) && /^(claude-|gpt-)/.test(id))
    for (const bucket of group.buckets ?? []) {
      const value = reading(bucket.remainingFraction, bucket.resetTime)
      if (!value) continue
      const key = String(bucket.window || bucket.bucketId || "").toLowerCase()
      const span = /5h|five.?hour/.test(key) ? 5 * 3600 : /week|7d/.test(key) ? 7 * 86400 : 0
      windows.push({
        name: `${label.replace(/ models?$/i, "")} ${span === 5 * 3600 ? "5 hours" : span ? "7 days" : bucket.displayName || key || "quota"}`,
        ...value, span, models, aside: !models.length || !span,
      })
    }
  }
  return windows
}

export function modelWindows(available, known) {
  const windows = []
  for (const [id, info] of Object.entries(available?.models ?? {})) {
    if (!info.quotaInfo) continue
    const value = reading(info.quotaInfo.remainingFraction, info.quotaInfo.resetTime)
    if (!value) continue
    const base = modelBase(info.model || id, known)
    windows.push({ name: info.displayName || id, ...value, models: base ? [base] : [], aside: !base })
  }
  return windows
}

export function quotaError(error) {
  const status = Number.isInteger(error?.status) ? ` (HTTP ${error.status})` : ""
  return {
    windows: [],
    error: `Antigravity quota unavailable${status}; check the account in its plugin`,
    signIn: error?.code === "invalid_grant" ? "expired" : "kept",
  }
}
