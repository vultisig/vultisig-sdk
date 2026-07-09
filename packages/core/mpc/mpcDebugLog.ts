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
 * Route tracing to STDERR, and only when `VULTISIG_DEBUG` is set, so STDOUT
 * stays a clean JSON-only stream while the debug output remains available to
 * humans on demand. This mirrors the existing `VULTISIG_DEBUG` convention used
 * by the CLI. Behavior is unchanged — only the log SINK moves off STDOUT.
 */
export const mpcDebugLog = (...args: unknown[]): void => {
  if (process.env.VULTISIG_DEBUG) {
    console.error(...args)
  }
}
