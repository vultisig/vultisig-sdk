---
'@vultisig/sdk': patch
'@vultisig/core-mpc': patch
---

Install `globalThis.Buffer` before the browser SDK module graph evaluates (`preamble.ts`), align browser `polyfills` with `globalThis`, add explicit `buffer` imports across MPC modules that use `Buffer`, and depend on `buffer` from `@vultisig/core-mpc`. Harden the browser/electron examples: seedphrase import batching/progress and adapter flags, clipboard helper with bounded timeouts, QR/address copy feedback, and send-form amount validation with trimmed recipients.
