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
      async models(provider) {
        return Object.fromEntries(known.filter((id) => provider.models[id]).map((id) => [id, provider.models[id]]))
      },
    },
    auth: {
      ...native.auth,
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
