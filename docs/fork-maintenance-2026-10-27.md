# Mirasim Fork Maintenance

## Ownership

Repository: https://github.com/Larkspur-Wang/magpie (existing public fork of
yetone/magpie). Product/default branch: `feat/mirasim`. `main` is reserved for
the upstream mirror. Keep the existing checkout; do not make a second unrelated
repository for the same product. The local physical path is
`/Users/lark/Dev/Playground/magpie`; `/Users/lark/Playground/magpie` resolves there.

Account configuration and credentials in `~/.config/magpie` are runtime state,
not source. They must never be committed. A workbench snapshot branch is a
source backup, not a tested release or a claim of reproducible installed bytes.

## Extension Boundaries

| Component | Current boundary | Maintenance |
| --- | --- | --- |
| Cohub | `plugins/cohub` OpenCode provider | Adapter tests plus real text/tool capability checks; do not claim tools from listing alone |
| Antigravity | `plugins/antigravity-discovery-20261024` wrapper | Native catalog/quota plus tools/SSE; upstream `JoshRob297/opencode-antigravity-auth` commit `3b90e46377cec612b2be169bfa2ba2e2dc8445de` |
| Mirasim GPT | `plugins/mirasim-gpt` | `opencode-mirasim-auth` 0.5.0; package and lock must agree |
| Mirasim Claude | Core launch/session/Go bridge integration | Still needs a small maintained patch; never replace signed native calls with copied bearer tokens |
| Native Mirasim allowance | `internal/mirasim`, provider usage/UI hooks | Preserve native scope/reset/credit semantics; a JS provider plugin does not automatically own core allowance UI |

The Antigravity dependency is installed at a durable local path outside this
checkout. Recreate the pinned commit, install its lock with scripts disabled,
and build it before setting the wrapper's `upstream` option. Never commit Google
credentials. Do not auto-update this dependency: it handles sign-ins. Its full
upstream test suite currently has a reproducible concurrent-session adapter
timeout; the scoped RK3588 tool round trip succeeded, not the whole suite.

Keep providers as plugins where possible. Separate npm packages/repositories can
follow when they have a reusable release contract; do not move active absolute
plugin paths merely to tidy folders. Plugin-first reduces core merge conflicts,
not protocol drift. Test both the pinned host and an upstream candidate in
isolated homes. Built-in Go plugins and OpenCode JS provider plugins are
different mechanisms (`docs/subsystems/plugin-runtime.md`).

## Upstream Gate

On 2026-10-27, local product HEAD `a6937170` versus upstream `8ab4fd61` has
526 upstream commits missing. `git merge-tree` reports one conflict in
`internal/provider/test.go`; this is a trial against committed source, not
against the additional uncommitted work. No upgrade or app replacement was
performed in this maintenance step.

The old watcher failed on workflow mirror permissions and Issue creation.
The replacement requires only read contents, always publishes a Summary and
artifact after a successful comparison, and treats the Issue as optional.
Unknown git errors fail the comparison rather than reporting a clean merge.
It never pushes refs or installs an app. Validate with:

```sh
python3 scripts/test-report-upstream.py
python3 scripts/report-upstream.py --output /tmp/magpie-upstream.md
```

For an upgrade: preserve the active source/config, branch an isolated worktree,
merge (never rebase/force push), resolve conflicts, run the documented full
tests/builds, then exact-client tools/SSE/effort/quota verification with isolated
credentials. Inspect routing `tries[].id`, served model, status and fallback.
Only after acceptance build/tag/install a new custom version; keep previous app
and Linux binary for rollback. The official auto-updater must not replace the
custom edition. Source archival does not satisfy the release gate.
