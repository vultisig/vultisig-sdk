---
"@vultisig/mpc-types": patch
---

Add `EXPO_PUBLIC_VULTISIG_STRICT_SINGLETON` env-var fallback alongside `VULTISIG_STRICT_SINGLETON` so Expo / React Native consumers can bypass the dev-mode duplicate-MPC-engine guard via Metro-inlined env vars (Expo only inlines `EXPO_PUBLIC_*`). `VULTISIG_STRICT_SINGLETON` retains precedence; production builds (`NODE_ENV=production`) are unaffected.

Originally landed via vultisig/vultisig-sdk#306 R8 (commit 964df08), but the corresponding changeset was missed at release time — this republish ships the fix to npm.
