/**
 * RN-compatible replacement for @vultisig/core-mpc/getMessageHash
 *
 * The original uses Node.js crypto.createHash('md5').
 * This uses a minimal pure-JS MD5 from js-md5 package.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const jsMd5 = require('js-md5') as (input: string | Uint8Array) => string

export const getMessageHash = (message: string): string => {
  return jsMd5(message)
}
