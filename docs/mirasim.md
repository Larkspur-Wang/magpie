# Mirasim Edition

This fork keeps `origin` on Larkspur-Wang/magpie and `upstream` on
yetone/magpie. Development is on `feat/mirasim`; the Go module path stays
unchanged to keep upstream merges small.

## Native CLI Integration

```sh
magpie-mirasim mirasim on
magpie-mirasim launch claude
magpie-mirasim mirasim sync
magpie-mirasim quota mirasim --json
```

Settings also has **Claude launcher** (Native / mirasim claude) and
**Mirasim provider** (Off / On). The agent row becomes **Claude Code
(Mirasim)**, and its Sessions terminal button resumes through Mirasim.
No global `claude` executable, login or credential is replaced.

The provider runs the installed `mirasim claude` using Magpie's existing
stream-json and MCP tool bridge. The native CLI does all signing and
authentication. The desktop app's updated `state.json` runtime is supported,
even when `mirasim` is only a shell function. `MAGPIE_MIRASIM_BIN` can name
an executable wrapper; it does not accept shell command strings.

Model discovery uses `mirasim ui-cli catalog --agent claude`. Only that
CLI's models are exposed, not every model an unrelated relay endpoint lists.
The native runtime is resolved again for each new subprocess, so an app
update does not pin an obsolete version. Catalog refresh keeps the previous
list if the native command fails.

## Pool And Usage

Other agents can select `mirasim/<model>` or a routing group containing it.
The gateway records tokens, cache usage, actual served model, latency and
status, through the same ledger and routing machinery as other sources.

The Usage page reads Mirasim's platform plan, 5-hour and weekly percentages,
model-scoped Claude/Fable windows and plan expiry through the native
`mirasim ui-cli --port 4970 relay status` command. These windows also feed
Magpie's allowance-aware routing. Keep Mirasim's desktop host running for
quota reads; `MAGPIE_MIRASIM_PORT` selects another local host port. Magpie
does not read the host's access token itself. Native failures remain errors
or timestamped last readings, never fabricated zero usage. A local/own
Mirasim route is not presented as a usable platform allowance.

Percentages from different providers are not added into a fictitious shared
balance. Historical traffic that bypasses Magpie is not imported. The cost
displayed by Magpie is its model-price estimate, not a verified Mirasim
invoice. Mirasim controls its
own platform/native routing; `mirasim` as the selected provider alone is
not proof of which upstream paid for a request. Inspect Mirasim traffic
when that distinction matters. Magpie sees this CLI as one source, not
Mirasim's hidden internal account pool.

With the Mirasim launcher selected, Claude Code's upstream belongs to
Mirasim. Magpie rejects writing a gateway model into that Claude Code
configuration to avoid competing proxies. To use Claude Code itself on a
Magpie group, select **Native** first. Mirasim can remain a provider for the
group while the outer Claude Code runs normally.

The first version supports text, streaming and caller-supplied function
tools via MCP, plus the active native platform account's quota windows.
Image capabilities and monetary credit balances are not advertised without
verified native metadata. A missing Mirasim runtime is
an error, never a silent fallback to plain Claude Code.

## Local macOS Build

```sh
sh build/mirasim-app.sh
```

The build has its own bundle ID and a non-release version so the official
updater cannot replace it. It is locally ad-hoc signed, **not notarized**.
Keep the official app installed as a rollback. Both editions share the
Magpie settings directory; do not run their gateways on the same port.
Use `MAGPIE_ADDR=127.0.0.1:3426` for isolated gateway verification.

To return to native launch mode:

```sh
magpie-mirasim mirasim off
```

Switch consumers off Mirasim models/groups before disabling its provider.
This does not remove Mirasim or its own sign-in.

## Upstream Maintenance

See [FORK.md](../FORK.md): branch model, version tags, the upstream-watch
workflow and `scripts/sync-upstream.sh`. Other sources live in
[`plugins/`](../plugins) and leave upstream code alone: the
[Antigravity adapter](../plugins/antigravity/README.md) and the
[Cohub plugin](../plugins/cohub/README.md).

The official release-dispatch workflow is restricted to the upstream
repository. This fork cannot dispatch releases into yetone's release repo.
