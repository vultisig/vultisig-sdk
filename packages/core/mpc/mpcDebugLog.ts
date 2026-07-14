/**
 * Gated tracing for the MPC keygen / reshare / key-import ceremonies.
 *
 * These paths previously wrote progress lines — session ids, raw wire messages,
 * "keygen complete", etc. — to STDOUT via `console.log`. STDOUT is the machine
 * channel for the CLI's `-o json` mode (the documented `create fast … -o json`
 * agent flow), so that spew corrupted the JSON envelope (`JSON.parse(stdout)`
 * failed on the leading garbage) AND leaked MPC internals into terminals/CI
 * logs.
 *
 * Route tracing to STDERR, and only when `VULTISIG_DEBUG === '1'`, so STDOUT
 * stays a clean JSON-only stream while the debug output remains available to
 * humans on demand. The `=== '1'` gate matches the CLI convention
 * (`clients/cli/src/lib/config.ts`) so `VULTISIG_DEBUG=0` disables it rather
 * than enabling it (any non-empty string is truthy in JS).
 *
 * The `typeof process` guard keeps this a no-op — never a throw — in runtimes
 * without a global `process` (e.g. some browser bundles). This helper runs
 * inside the keygen relay loop, so a throw here would change ceremony behavior;
 * it must only ever move the log SINK, never fail.
 */
export const mpcDebugLog = (...args: unknown[]): void => {
  if (typeof process !== 'undefined' && process.env?.VULTISIG_DEBUG === '1') {
    console.error(...args)
  }
}
