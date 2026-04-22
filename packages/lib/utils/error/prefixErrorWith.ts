import { extractErrorMsg } from './extractErrorMsg/index.js'

export const prefixErrorWith = (prefix: string) => (error: unknown) => {
  return new Error(`${prefix}: ${extractErrorMsg(error)}`)
}
