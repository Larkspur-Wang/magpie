const ID = "mirasim-gpt"
const NATIVE = "mirasim"

function gptModels(models = {}) {
  return Object.fromEntries(Object.entries(models)
    .filter(([id, model]) => id.startsWith("gpt-") && model.api?.npm === "@ai-sdk/openai")
    .map(([id, model]) => [id, { ...model, providerID: ID }]))
}

// Keep this plugin's login and models separate from the native Claude bridge.
export async function adapt(input, factory) {
  const client = Object.create(input.client)
  client.auth = Object.create(input.client.auth)
  client.auth.set = (value) => input.client.auth.set({
    ...value, path: { ...value.path, id: value.path.id === NATIVE ? ID : value.path.id },
  })
  const native = await factory({ ...input, client })
  return {
    auth: {
      ...native.auth,
      provider: ID,
      async loader(getAuth, ...args) {
        const loader = await native.auth.loader(getAuth, ...args)
        if (!loader.fetch) return loader
        return {
          ...loader,
          async fetch(input, init = {}) {
            const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
            if (url.pathname.endsWith("/responses") && typeof init.body === "string") {
              let body
              try { body = JSON.parse(init.body) } catch {}
              // The relay accepts message arrays, not Responses' string shorthand.
              // Normalize before the native plugin signs the outgoing bytes.
              if (typeof body?.input === "string") {
                body.input = [{ role: "user", content: [{ type: "input_text", text: body.input }] }]
                const headers = new Headers(init.headers)
                headers.delete("content-length")
                init = { ...init, headers, body: JSON.stringify(body) }
              }
            }
            return loader.fetch(input, init)
          },
        }
      },
      methods: native.auth.methods.map((method) => ({
        ...method,
        async authorize(inputs) {
          const authorization = await method.authorize(inputs)
          return {
            ...authorization,
            async callback(...args) {
              const result = await authorization.callback(...args)
              return result.type === "success" ? { ...result, provider: ID } : result
            },
          }
        },
      })),
      async usage(getAuth) {
        const result = await native.auth.usage(getAuth)
        // Native usage omits model scopes. Claude/Fable-specific windows
        // must not mark GPT unavailable, while unknown windows remain visible.
        return {
          ...result,
          windows: result.windows?.map((window) => ({
            ...window,
            ...(/claude|fable/i.test(window.name) ? { aside: true } : {}),
          })),
        }
      },
    },
    async config(config) {
      const isolated = { provider: { [NATIVE]: { ...(config.provider?.[ID] ?? {}) } } }
      await native.config(isolated)
      config.provider ??= {}
      config.provider[ID] = {
        ...isolated.provider[NATIVE], name: "Mirasim GPT", npm: "@ai-sdk/openai",
        models: gptModels(isolated.provider[NATIVE]?.models),
      }
    },
    provider: {
      id: ID,
      async models(provider, context) {
        return gptModels(await native.provider.models(provider, context))
      },
    },
  }
}
