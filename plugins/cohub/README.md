# Cohub plugin

Serves [Cohub](https://cohub.run)'s models through Magpie on the account the
Cohub CLI is signed in to. Requests go through the installed
`@neta-art/cohub-cli` package's own client, which reads and refreshes
`~/.config/cohub/auth.json`; Magpie stores no Cohub token. The newest CLI found
under the usual global `node_modules` (every nvm Node, Homebrew, `/usr/local`)
is used, so updating the CLI updates the plugin's client.

## Text only

Cohub's completion endpoint (`POST /api/spaces/<id>/completions`) takes text,
reasoning and images, and silently drops tool definitions. So:

- a request with tools (and `tool_choice` other than `none`), or with tool
  calls or tool results in its history, is answered `400` here, never sent;
- every model is listed as `cohub/<model>:text`. The `:text` suffix keeps
  them out of Magpie's automatic same-model routing groups, which agents
  (Claude Code, Codex, …) route through and which need tools.

Use them from chat clients, scripts and other tool-free callers of the
gateway, on chat completions, Responses or Anthropic Messages.

## Install

```sh
npm i -g @neta-art/cohub-cli@latest
cohub auth login
magpie plugin add /absolute/path/magpie/plugins/cohub
magpie plugin login cohub
```

Optional `plugins.json` options on the entry:

- `root`: the `@neta-art/cohub-cli` package folder, when it isn't in a usual
  global `node_modules` (or set `MAGPIE_COHUB_ROOT`);
- `space`: the Cohub Space completions run in (or set `COHUB_SPACE_ID`);
  default is the account's home Space.

## Usage and quota

Magpie records each request's tokens, served model and latency like any
provider's. The plugin also reads Cohub's billing API: the card's line is what
the account can spend (Cohub's own net total), and every credit pack is a
window — used percent, left of what it granted, and when it expires. Packs
that can't be spent show as aside, one that overspent its own grant is named
as overage without an invented percentage.

## Tests

```sh
node --test plugins/cohub/*.test.mjs        # offline, against a fake CLI
node scripts/verify-cohub.mjs               # live, through a running gateway
```
