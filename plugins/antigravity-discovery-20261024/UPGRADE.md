# Isolated Antigravity Discovery Adapter

This deployment copy retains the original adapter for rollback.

- Upstream pinned to `3b90e46377cec612b2be169bfa2ba2e2dc8445de` (2.1.0).
- Its isolated upstream build includes a local patch: catalog requests use the existing CLI signature;
  generation extends that same signature to the Argon family. Four new regression tests failed before
  this patch and passed after it. Original upstream checkout is untouched.
- Enable this adapter's `modelDiscovery: true` option, not a global OpenCode setting.
- The Magpie models hook receives the account's OAuth context, uses the native refresh helper,
  and asks the native account catalog. No onboarding, tier change or project creation is performed by discovery.
- Only the pinned upstream's forward-only discovery filter can add models. Argon is never invented or aliased to Flash.
- Public IDs omit `antigravity-`; exact native IDs and capabilities are retained.
- Failed catalog reads throw a credential-safe error so the host can preserve its last known catalog.
- Account-specific quota model names are kept separate, and existing auth/fetch handling is forwarded.

Run `node --test plugins/antigravity-discovery-20261024/*.test.mjs` from the Magpie checkout.
The discovery tests failed against the original adapter before the change.
No original-checkout changes, remote commits or PR publication are part of this deployment.
The isolated upstream's `AGENTS.MD` has a macOS case-collision worktree difference, unrelated to this patch;
do not include it in a commit or revert unrelated instructions.

Live image verification requested `gemini-4-argon-high` and the native response reported
`gemini-4-argon-trial`. Treat the High selector as requested, not independently proven execution effort.
