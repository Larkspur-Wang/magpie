// Magpie provider plugin for Cohub (cohub.run), on the Cohub CLI's own
// sign-in: requests go through the installed @neta-art/cohub-cli's client,
// which reads and refreshes ~/.config/cohub/auth.json itself, so no token is
// copied into Magpie. The newest CLI found is used, so `npm i -g
// @neta-art/cohub-cli@latest` updates the plugin's client too.
//
// Options (plugins.json): root — the cohub-cli package folder, when it is
// not under a usual global node_modules; space — the Space completions are
// billed to (default: COHUB_SPACE_ID, else the account's home Space).

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { MODEL_SUFFIX, RequestError, balance, toChatCompletion, toCohubInput, streamChunks } from "./convert.mjs"

export const PROVIDER = "cohub"
const PACKAGE = path.join("@neta-art", "cohub-cli")
const API = "https://cohub.invalid/v1" // never dialed: the loader's fetch answers

function version(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version ?? "0"
  } catch {
    return "0"
  }
}

function newer(a, b) {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

// cliRoots are the global node_modules a Cohub CLI may be installed in:
// every nvm Node's, Homebrew's, the system's, npm's prefix.
function cliRoots(home = homedir(), env = process.env) {
  const roots = []
  const nvm = path.join(env.NVM_DIR || path.join(home, ".nvm"), "versions", "node")
  try {
    for (const v of readdirSync(nvm)) roots.push(path.join(nvm, v, "lib", "node_modules"))
  } catch {}
  if (env.npm_config_prefix) roots.push(path.join(env.npm_config_prefix, "lib", "node_modules"))
  roots.push(path.join(home, ".npm-global", "lib", "node_modules"), "/opt/homebrew/lib/node_modules", "/usr/local/lib/node_modules")
  return roots
}

// findCLI is the newest Cohub CLI package folder found, the configured one first.
export function findCLI(options = {}, home = homedir(), env = process.env) {
  const given = options.root || env.MAGPIE_COHUB_ROOT
  if (given) {
    if (!existsSync(path.join(given, "dist", "client.js"))) throw new Error(`no Cohub CLI at ${given}`)
    return given
  }
  let best = ""
  for (const r of cliRoots(home, env)) {
    const dir = path.join(r, PACKAGE)
    if (!existsSync(path.join(dir, "dist", "client.js"))) continue
    if (!best || newer(version(dir), version(best))) best = dir
  }
  if (!best) throw new Error("Cohub CLI not found: npm i -g @neta-art/cohub-cli, then cohub auth login")
  return best
}

function errorResponse(status, message, type = "invalid_request_error") {
  return new Response(JSON.stringify({ error: { message, type } }), {
    status,
    headers: { "content-type": "application/json" },
  })
}

// failure is what a Cohub client error answers: its HTTP status, 401 for a
// missing sign-in.
function failure(e) {
  if (e instanceof RequestError) return errorResponse(e.status, e.message, e.type)
  if (e?.name === "AuthRequiredError") return errorResponse(401, "Cohub CLI is not signed in: run cohub auth login", "authentication_error")
  const status = typeof e?.status === "number" && e.status >= 400 ? e.status : 502
  const body = e?.body && typeof e.body === "object" ? e.body : null
  const message = body?.message || body?.error?.message || e?.message || String(e)
  return errorResponse(status, `Cohub: ${message}`, status === 401 ? "authentication_error" : "upstream_error")
}

// modelsFrom is Cohub's model list as OpenCode's provider models, each
// under its id with MODEL_SUFFIX and spoken to on chat completions.
export function modelsFrom(list) {
  const out = {}
  for (const entry of list?.cohub ?? []) {
    const m = entry.model ?? {}
    const id = `${entry.id}${MODEL_SUFFIX}`
    const image = (m.input ?? []).includes("image")
    out[id] = {
      id,
      providerID: PROVIDER,
      name: `${m.name ?? entry.id} (Cohub, text)`,
      api: { id: entry.id, url: API, npm: "@ai-sdk/openai-compatible" },
      status: "active",
      headers: {},
      options: {},
      cost: { input: m.cost?.input ?? 0, output: m.cost?.output ?? 0, cache: { read: m.cost?.cacheRead ?? 0, write: m.cost?.cacheWrite ?? 0 } },
      limit: { context: m.contextWindow ?? 0, output: m.maxTokens ?? 0 },
      capabilities: {
        temperature: true,
        reasoning: !!m.reasoning,
        attachment: image,
        toolcall: false,
        input: { text: true, image, audio: false, video: false, pdf: false },
        output: { text: true, image: false, audio: false, video: false, pdf: false },
        interleaved: false,
      },
      release_date: "",
      variants: {},
    }
  }
  return out
}

// The CLI's client carries the billing API on some of its builds; where it
// doesn't, the transport underneath answers the same paths.
function billing(client) {
  return client.billing ?? {
    getCredits: () => client.transport.request("/api/billing/credits"),
    getSubscriptions: () => client.transport.request("/api/billing/subscriptions"),
  }
}

// subscriptionPlan is the name of the active subscription, for the card's
// plan line; "" when its reply holds none.
async function subscriptionPlan(client) {
  const items = (await billing(client).getSubscriptions())?.subscriptions?.items ?? []
  return items.find((s) => s.status === "active")?.productName ?? ""
}

export default async function cohub(input, options = {}) {
  let cli
  const load = async () => {
    if (cli) return cli
    const root = findCLI(options)
    const mod = (file) => import(pathToFileURL(path.join(root, "dist", file)).href)
    const [client, space] = await Promise.all([mod("client.js"), mod("space.js")])
    cli = { root, client: client.createClient(), space }
    return cli
  }
  let spaceId
  const space = async () => {
    if (spaceId) return spaceId
    const { space: s } = await load()
    spaceId = options.space || process.env.COHUB_SPACE_ID?.trim() || (await s.resolveDefaultSpace())
    if (!spaceId) throw new RequestError(409, "Cohub has no home Space for this account: set the plugin's space option", "upstream_error")
    return spaceId
  }

  async function complete(url, init = {}) {
    const ctl = new AbortController()
    init.signal?.addEventListener("abort", () => ctl.abort(init.signal.reason), { once: true })
    try {
      if (!String(url).endsWith("/chat/completions")) return errorResponse(404, `Cohub plugin serves chat completions only, not ${url}`)
      const body = JSON.parse(typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body ?? new Uint8Array()))
      const req = toCohubInput(body)
      const model = typeof body.model === "string" ? body.model : req.model
      const { client } = await load()
      const s = client.space(await space())
      if (!body.stream) {
        return new Response(JSON.stringify(toChatCompletion(await s.completion(req), model)), {
          headers: { "content-type": "application/json" },
        })
      }
      // the first event comes before the head, so a refused request answers
      // its own status instead of a 200 stream carrying an error
      const events = s.streamCompletion(req, { signal: ctl.signal })
      const first = await events.next()
      async function* replay() {
        if (!first.done) yield first.value
        while (true) {
          const step = await events.next()
          if (step.done) return
          yield step.value
        }
      }
      const enc = new TextEncoder()
      const lines = streamChunks(replay(), model)
      const stream = new ReadableStream({
        async pull(c) {
          try {
            const { done, value } = await lines.next()
            if (done) c.close()
            else c.enqueue(enc.encode(value))
          } catch (e) {
            const message = e?.message || String(e)
            c.enqueue(enc.encode(`data: ${JSON.stringify({ error: { message: `Cohub: ${message}`, type: "upstream_error" } })}\n\n`))
            c.close()
          }
        },
        cancel(reason) {
          ctl.abort(reason)
          lines.return?.()
        },
      })
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } })
    } catch (e) {
      if (ctl.signal.aborted) throw e
      return failure(e)
    }
  }

  return {
    async config(config) {
      config.provider ??= {}
      config.provider[PROVIDER] = {
        ...config.provider[PROVIDER],
        name: "Cohub",
        npm: "@ai-sdk/openai-compatible",
        api: API,
      }
    },
    provider: {
      id: PROVIDER,
      async models() {
        const { client } = await load()
        return modelsFrom(await client.models.list())
      },
    },
    auth: {
      provider: PROVIDER,
      methods: [{
        type: "oauth",
        label: "Use this computer's Cohub CLI sign-in (cohub auth login)",
        async authorize() {
          return {
            url: "",
            instructions: "Uses the account the Cohub CLI is signed in to; run `cohub auth login` first if it is not.",
            method: "auto",
            async callback() {
              try {
                const { client } = await load()
                const me = await client.user.getMe()
                return { type: "success", key: "cohub-cli", metadata: { email: me.email ?? me.profile?.username ?? "" } }
              } catch (e) {
                return { type: "failed", error: e?.name === "AuthRequiredError" ? "run cohub auth login first" : String(e?.message ?? e) }
              }
            },
          }
        },
      }],
      async loader() {
        return { apiKey: "cohub-cli", fetch: complete }
      },
      // Cohub's credits, as the billing API reports them: the spendable
      // total on the line, each credit pack a window.
      async usage() {
        try {
          const { client } = await load()
          const b = billing(client)
          const [me, credits, plan] = await Promise.all([
            client.user.getMe(),
            b.getCredits(),
            subscriptionPlan(client).catch(() => ""),
          ])
          return { ...balance(credits, plan || "Cohub"), user: me.email ?? me.profile?.username ?? "" }
        } catch (e) {
          const gone = e?.name === "AuthRequiredError" || e?.status === 401
          return {
            windows: [],
            plan: "Cohub",
            error: gone ? "Cohub CLI is not signed in: run cohub auth login" : String(e?.message ?? e),
            ...(gone ? { signIn: "expired" } : {}),
          }
        }
      },
    },
  }
}
