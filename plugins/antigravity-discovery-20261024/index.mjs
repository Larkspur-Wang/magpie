import path from "node:path"
import { pathToFileURL } from "node:url"
import { modelWindows, quotaError, summaryWindows } from "./quota.mjs"

export default async function antigravity(input, options = {}) {
  const upstream = options.upstream || process.env.MAGPIE_ANTIGRAVITY_ROOT
  if (!upstream) throw new Error("Set this plugin's upstream option to the built Antigravity community checkout")
  const load = (file) => import(pathToFileURL(path.join(upstream, "dist", file)).href)
  const [entry, definitions, quota, tokens, auth, projects] = await Promise.all([
    load("index.js"), load("src/plugin/config/models.js"), load("src/plugin/quota.js"),
    load("src/plugin/token.js"), load("src/plugin/auth.js"), load("src/plugin/project.js"),
  ])
  const native = await entry.AntigravityCLIOAuthPlugin(input)
  const models = Object.fromEntries(Object.entries(definitions.OPENCODE_MODEL_DEFINITIONS).map(([id, model]) => [
    id.replace(/^antigravity-/, ""), { ...model, id, reasoning: !!Object.keys(model.variants ?? {}).length },
  ]))
  const known = Object.keys(models)
  const namesByAccount = new Map()
  const accountKey = (value) => value?.refresh ? auth.parseRefreshParts(value.refresh).refreshToken : ""
  const quotaNames = (ids) => [...new Set(ids.map((id) => id.startsWith("gemini-") ? id.replace(/-(minimal|low|medium|high|max)$/, "") : id))]
  const knownFor = (value) => options.modelDiscovery === true ? namesByAccount.get(accountKey(value)) || known : known
  return {
    ...native,
    async config(config) {
      await native.config?.(config)
      config.provider ??= {}
      config.provider.google = {
        ...config.provider.google, name: "Antigravity", npm: "@ai-sdk/google", models,
      }
    },
    provider: {
      id: "google",
      async models(provider, context = {}) {
        const listed = Object.fromEntries(known.filter((id) => provider.models[id]).map((id) => [id, provider.models[id]]))
        let current = context.auth
        if (options.modelDiscovery !== true || current?.type !== "oauth") return listed
        try {
          if (auth.accessTokenExpired(current)) {
            current = await tokens.refreshAccessToken(current, input.client, "google")
            if (!current?.access) throw new Error("Native token refresh failed")
            await input.client.auth.set({ path: { id: "google" }, body: current })
          }
          const parts = auth.parseRefreshParts(current.refresh)
          // Listing must not onboard an account or change its subscription/project.
          const project = parts.managedProjectId || parts.projectId || current.projectId
          const available = await quota.fetchAvailableModels(current.access, project)
          if (!available?.models || typeof available.models !== "object" || Array.isArray(available.models)) {
            throw new Error("Native catalog is malformed")
          }
          const discovery = await load("src/plugin/config/model-discovery.js")
          const discovered = discovery.buildDiscoveredModels(Object.keys(available.models))
          for (const [nativeId, def] of Object.entries(discovered)) {
            const id = nativeId.replace(/^antigravity-/, "")
            if (listed[id]) continue
            listed[id] = {
              id, providerID: "google", name: def.name,
              api: { id: nativeId, url: "", npm: "@ai-sdk/google" },
              options: {}, headers: {}, cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
              limit: { ...def.limit }, variants: def.variants || {},
              capabilities: {
                temperature: true, toolcall: true, attachment: true,
                reasoning: !!Object.keys(def.variants || {}).length,
                input: Object.fromEntries((def.modalities?.input || ["text"]).map((kind) => [kind, true])),
                output: Object.fromEntries((def.modalities?.output || ["text"]).map((kind) => [kind, true])),
              },
            }
          }
          namesByAccount.set(accountKey(current), quotaNames(Object.keys(listed)))
          return listed
        } catch (cause) {
          // Let the host keep the last known catalog instead of treating a failed read as empty.
          const error = new Error("Antigravity model catalog unavailable; check this account's plugin")
          error.signIn = cause?.code === "invalid_grant" ? "expired" : "kept"
          throw error
        }
      },
    },
    auth: {
      ...native.auth,
      async loader(...args) {
        const loaded = await native.auth.loader(...args)
        if (typeof loaded?.fetch !== "function") return loaded
        return {
          ...loaded,
          async fetch(request, init) {
            const url = new URL(typeof request === "string" || request instanceof URL ? request : request.url)
            const match = url.hostname === "generativelanguage.googleapis.com"
              ? decodeURIComponent(url.pathname).match(/\/models\/(?:antigravity-)?(gemini-4-argon[^:]*):/)
              : null
            if (match && !/^gemini-4-argon-(low|medium|high)$/.test(match[1])) {
              return Response.json({ error: { code: 404, status: "NOT_FOUND", message: "Antigravity Argon requires an available low, medium or high native selector" } }, { status: 404 })
            }
            return loaded.fetch(request, init)
          },
        }
      },
      async usage(getAuth) {
        try {
          let current = await getAuth()
          if (current?.type !== "oauth") return { windows: [], error: "Antigravity is not signed in", signIn: "expired" }
          if (auth.accessTokenExpired(current)) {
            current = await tokens.refreshAccessToken(current, input.client, "google")
            if (!current) return { windows: [], error: "Antigravity sign-in needs renewal", signIn: "expired" }
          }
          const project = await projects.ensureProjectContext(current)
          if (project.auth.refresh !== current.refresh) {
            await input.client.auth.set({ path: { id: "google" }, body: project.auth })
          }
          // Use raw native responses, never the plugin's synthesized fallback windows.
          let windows = []
          const known = knownFor(current)
          try {
            const summary = await quota.fetchQuotaSummary(project.auth.access, project.effectiveProjectId)
            if (options.quotaDiagnostics) {
              console.info("Antigravity quota schema", JSON.stringify((summary.groups ?? []).map((group) => ({
                displayName: group.displayName,
                buckets: (group.buckets ?? []).map(({ window, bucketId, displayName }) => ({ window, bucketId, displayName })),
              }))))
            }
            windows = summaryWindows(summary, known)
          } catch {}
          if (!windows.length) {
            windows = modelWindows(await quota.fetchAvailableModels(project.auth.access, project.effectiveProjectId), known)
          }
          return windows.length
            ? { windows, signIn: "renewed" }
            : { windows: [], error: "Google returned no native quota readings", signIn: "kept" }
        } catch (error) {
          return quotaError(error)
        }
      },
    },
  }
}
