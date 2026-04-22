---
'@vultisig/mpc-types': patch
---

chore(mpc-types): guard MPC runtime singleton — duplicate-engine detector + ESLint rule

Preventive mechanism for the bug class captured in vultisig/vultisig-windows#3777 (MPC engine singleton broken across bundler chunks). The globalThis-backed `runtimeStore` already neutralises chunking; this change adds two independent guardrails so the footgun can't return quietly.

- `configureMpc` now detects when it is called with a *different* engine instance after an engine has already been registered. Same-reference second calls stay a no-op (expected when cross-chunk reloads share the `globalThis` store). Different-instance second calls log an actionable `console.error` with constructor names, stable non-enumerable instance IDs, and a stack-frame call-site hint, then throw in dev.
- New env var `VULTISIG_STRICT_SINGLETON` — set to `1` to force the throw in production, or `0` to suppress the throw in dev. Default is **strict** whenever `NODE_ENV` is not explicitly `'production'`, which fixes the plain-ESM browser case where `process` is undefined (previously went silent, hiding duplicates in exactly the environment the original bug surfaced in).
- ESLint `no-restricted-syntax` rule applied to `packages/mpc-types/src/**` and `packages/core/mpc/**`: bans module-level `let` and `export let`. The original bug had the exact shape `let engine: ... | null = null`. Opt-out with `// eslint-disable-next-line no-restricted-syntax -- vultisig-singleton-ok: <reason>`.

Behaviour in production (`NODE_ENV === 'production'`) is unchanged for single-engine consumers: still warns and overwrites on duplicates. The new throw path only engages in dev / test / unknown environments, or when explicitly opted into via `VULTISIG_STRICT_SINGLETON=1`.
