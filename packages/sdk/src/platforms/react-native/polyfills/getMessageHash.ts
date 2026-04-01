/**
 * RN-compatible replacement for @core/mpc/getMessageHash
 *
 * The original uses Node.js crypto.createHash('md5').
 * This uses a minimal pure-JS MD5 from js-md5 package.
 */
import jsMd5 from 'js-md5'

export const getMessageHash = (message: string): string => {
  return jsMd5(message)
}
